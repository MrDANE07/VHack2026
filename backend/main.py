"""FastAPI server with WebSocket for drone control."""

import asyncio
import json
import logging
from typing import Dict, Set, Optional, Any, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from drone import Drone
from drone_manager import DroneManager
from commander_agent import get_actionable_recommendation, DroneDeps, AgentResult

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global state
drone_manager: DroneManager = None  # type: ignore
drones: Dict[str, Drone] = {}
victims: Dict[str, Dict[str, Any]] = {}  # victim_id -> {position, detected}
active_connections: Set[WebSocket] = set()
selected_drone_id: Optional[str] = None

# Sector assignments for drones
SECTOR_POSITIONS = {
    "A": [12.5, 5, 12.5],
    "B": [37.5, 5, 12.5],
    "C": [12.5, 5, 37.5],
    "D": [37.5, 5, 37.5],
}

SECTOR_ASSIGNMENTS = ["A", "B", "C", "D"]

# Simulation constants
SECTOR_ASSIGN_THRESHOLD = 40  # Battery % required to assign sector
LOW_BATTERY_THRESHOLD = 20  # Initiate RTB
CRITICAL_BATTERY_THRESHOLD = 15  # Request handoff
DETECTION_RANGE = 4  # Thermal detection radius
SEARCH_SPEED = 1.2
DEPLOY_SPEED = 2.0
RECALL_SPEED = 1.5
CHARGING_RATE = 0.5  # Battery gain per tick
SEARCH_BATTERY_DRAIN = 0.05
TRACKING_BATTERY_DRAIN = 0.08
RECALL_BATTERY_DRAIN = 0.05

# Logs and alerts for frontend
logs: list = []  # [{"type", "message", "droneId", "timestamp"}]
alerts: list = []  # [{"id", "victimId", "position", "status", "droneId"}]


def add_log(log_type: str, message: str, drone_id: str = None):
    """Add a log entry (module-level function)."""
    import asyncio
    logs.append({
        "type": log_type,
        "message": message,
        "droneId": drone_id,
        "timestamp": asyncio.get_event_loop().time() if asyncio.get_event_loop().is_running() else 0
    })
    # Keep only last 100 logs
    if len(logs) > 100:
        logs.pop(0)

# Agent trigger flag - set to True when user dispatches rescue to trigger agent response
agent_trigger_event: asyncio.Event = None  # type: ignore


def create_initial_drones() -> Dict[str, Drone]:
    """Create the initial drone fleet at charging base (0, 0)."""
    base_position: List[float] = [0, 2, 0]  # Charging hub at origin
    return {
        "DRONE-01": Drone(id="DRONE-01", position=base_position.copy(), battery=95),
        "DRONE-02": Drone(id="DRONE-02", position=base_position.copy(), battery=88),
        "DRONE-03": Drone(id="DRONE-03", position=base_position.copy(), battery=72),
        "DRONE-04": Drone(id="DRONE-04", position=base_position.copy(), battery=65),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown."""
    global drones, drone_manager, agent_trigger_event

    logger.info("=" * 50)
    logger.info("Starting AEGIS Drone Control API")
    logger.info("=" * 50)

    # Initialize agent trigger event
    agent_trigger_event = asyncio.Event()

    # Initialize DroneManager
    drone_manager = DroneManager()
    logger.info("DroneManager initialized")

    # Register callback for victim discovery notifications to stdout
    # This sends real-time events that MCP clients can receive
    def victim_discovered_notification(victim_id: str, x: int, z: int) -> None:
        """Send victim discovery notification to stdout for agent consumption."""
        import sys
        notification = {
            "type": "VICTIM_DISCOVERY_NOTIFICATION",
            "victim_id": victim_id,
            "position": {"x": x, "z": z},
            "message": f"VICTIM_DETECTED: {victim_id} at ({x}, {z})"
        }
        # Write to stdout - can be captured by MCP clients
        print(f"MCP_NOTIFICATION: {json.dumps(notification)}", flush=True, file=sys.stdout)
        logger.info(f"VICTIM DISCOVERY NOTIFICATION: {victim_id} at ({x}, {z})")

    drone_manager.grid_manager.register_discovery_callback(victim_discovered_notification)
    logger.info("Registered victim discovery callback for real-time notifications")

    # Start empty — frontend sends setup config via sync_config message
    drones = {}
    logger.info("Waiting for frontend configuration...")

    simulation_task = asyncio.create_task(simulation_loop())
    agent_task = asyncio.create_task(agent_loop())

    yield

    if simulation_task:
        simulation_task.cancel()
        try:
            await simulation_task
        except asyncio.CancelledError:
            pass

    if agent_task:
        agent_task.cancel()
        try:
            await agent_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="AEGIS Drone Control API", lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def simulation_loop():
    """
    Main simulation loop running at 2Hz (500ms interval).
    Handles drone movement, battery, state transitions, and detection.
    """
    global drones, victims, logs, alerts, drone_manager

    # Waypoint tracking per drone
    waypoints: Dict[str, list] = {}
    waypoint_index: Dict[str, int] = {}

    def generate_lawnmower_waypoints(sector: str) -> list:
        """Generate lawnmower pattern waypoints for a sector."""
        bounds = {
            "A": (0, 25, 0, 25),
            "B": (25, 50, 0, 25),
            "C": (0, 25, 25, 50),
            "D": (25, 50, 25, 50),
        }
        min_x, max_x, min_z, max_z = bounds.get(sector, (0, 50, 0, 50))

        pts = []
        padding = 2
        spacing = 4
        z = min_z + padding
        going_right = True

        while z < max_z - padding:
            if going_right:
                pts.append([max_x - padding, 5, z])
                pts.append([min_x + padding, 5, z])
            else:
                pts.append([min_x + padding, 5, z])
                pts.append([max_x - padding, 5, z])
            going_right = not going_right
            z += spacing

        return pts

    def get_covered_sectors() -> set:
        """Get sectors that have active drones."""
        return {
            d.assigned_sector for d in drones.values()
            if d.assigned_sector and d.status in ["SEARCHING", "TRACKING", "DEPLOYING"]
        }

    def find_best_replacement(exclude_drone_id: str, target_pos: list) -> Optional[Drone]:
        """Find best replacement drone for handoff."""
        candidates = [
            d for d in drones.values()
            if d.id != exclude_drone_id
            and d.battery > 40
            and d.status in ["IDLE", "SEARCHING"]
        ]

        if not candidates:
            return None

        # Sort by: status (IDLE first), battery (highest), distance (nearest)
        def sort_key(d):
            dx = d.position[0] - target_pos[0]
            dz = d.position[2] - target_pos[2]
            dist = (dx * dx + dz * dz) ** 0.5
            status_prio = 0 if d.status == "IDLE" else 1
            return (status_prio, -d.battery, dist)

        candidates.sort(key=sort_key)
        return candidates[0]

    while True:
        try:
            await asyncio.sleep(0.5)  # 2Hz

            if not drones:
                continue

            # Update each drone
            for drone_id, drone in list(drones.items()):
                # CHARGING - gain battery
                if drone.status == "CHARGING":
                    drone.battery = min(100, drone.battery + CHARGING_RATE)

                    # At 100%, find uncovered sector and deploy
                    if drone.battery >= 100:
                        covered = get_covered_sectors()
                        stored_sector = drone.assigned_sector

                        # Try original sector first
                        target = stored_sector if stored_sector and stored_sector not in covered else None
                        if not target:
                            for s in SECTOR_ASSIGNMENTS:
                                if s not in covered:
                                    target = s
                                    break

                        if target:
                            drone.status = "DEPLOYING"
                            drone.assigned_sector = target
                            waypoints[drone_id] = generate_lawnmower_waypoints(target)
                            waypoint_index[drone_id] = 0
                            add_log("SUCCESS", f"Fully charged. Deploying to Sector {target}.", drone_id)
                        else:
                            drone.status = "IDLE"
                            add_log("SUCCESS", "Fully charged. All sectors covered.", drone_id)

                    drone.position = [0, 2, 0]
                    continue

                # IDLE - stay at base
                if drone.status == "IDLE":
                    drone.position = [0, 2, 0]
                    continue

                # RECALLING - return to base
                if drone.status == "RECALLING":
                    dx = 0 - drone.position[0]
                    dz = 0 - drone.position[2]
                    dist = (dx * dx + dz * dz) ** 0.5

                    if dist < 2:
                        drone.position = [0, 2, 0]
                        drone.status = "CHARGING"
                        drone.assigned_sector = None
                        add_log("SUCCESS", "Arrived at charging base. Beginning charge cycle.", drone_id)
                    else:
                        speed = RECALL_SPEED
                        drone.position = [
                            drone.position[0] + (dx / dist) * speed,
                            2,
                            drone.position[2] + (dz / dist) * speed,
                        ]
                    drone.battery = max(0, drone.battery - RECALL_BATTERY_DRAIN)
                    continue

                # DEPLOYING - move to first waypoint
                if drone.status == "DEPLOYING" and drone.assigned_sector:
                    if drone_id not in waypoints or not waypoints[drone_id]:
                        waypoints[drone_id] = generate_lawnmower_waypoints(drone.assigned_sector)
                        waypoint_index[drone_id] = 0

                    target = waypoints[drone_id][waypoint_index[drone_id]]
                    dx = target[0] - drone.position[0]
                    dz = target[2] - drone.position[2]
                    dist = (dx * dx + dz * dz) ** 0.5

                    if dist < 2:
                        drone.status = "SEARCHING"
                        add_log("ACTION", f"Arrived at Sector {drone.assigned_sector}. Initiating thermal scan.", drone_id)
                    else:
                        speed = DEPLOY_SPEED
                        drone.position = [
                            drone.position[0] + (dx / dist) * speed,
                            5,
                            drone.position[2] + (dz / dist) * speed,
                        ]
                    drone.battery = max(0, drone.battery - SEARCH_BATTERY_DRAIN)
                    continue

                # SEARCHING - follow waypoints
                if drone.status == "SEARCHING" and drone.assigned_sector:
                    if drone_id not in waypoints or not waypoints[drone_id]:
                        waypoints[drone_id] = generate_lawnmower_waypoints(drone.assigned_sector)
                        waypoint_index[drone_id] = 0

                    wp_list = waypoints[drone_id]
                    idx = waypoint_index[drone_id]

                    if idx >= len(wp_list):
                        waypoint_index[drone_id] = 0
                        idx = 0

                    target = wp_list[idx]
                    dx = target[0] - drone.position[0]
                    dz = target[2] - drone.position[2]
                    dist = (dx * dx + dz * dz) ** 0.5

                    if dist < 2:
                        waypoint_index[drone_id] = idx + 1
                    else:
                        speed = SEARCH_SPEED
                        drone.position = [
                            drone.position[0] + (dx / dist) * speed,
                            5,
                            drone.position[2] + (dz / dist) * speed,
                        ]

                    drone.battery = max(0, drone.battery - SEARCH_BATTERY_DRAIN)

                    # Low battery - initiate RTB
                    if drone.battery <= LOW_BATTERY_THRESHOLD:
                        drone.status = "RECALLING"
                        add_log("ALERT", f"Low battery ({drone.battery:.0f}%). Returning to base.", drone_id)

                        # Find replacement
                        replacement = find_best_replacement(drone_id, drone.position)
                        if replacement:
                            asyncio.create_task(trigger_replacement(drone.assigned_sector, replacement.id))
                    continue

                # TRACKING - stay on victim, drain battery
                if drone.status == "TRACKING":
                    drone.battery = max(0, drone.battery - TRACKING_BATTERY_DRAIN)

                    # Critical battery - request handoff
                    if drone.battery <= CRITICAL_BATTERY_THRESHOLD:
                        add_log("ALERT", f"Battery critical ({drone.battery:.0f}%) while tracking! Requesting handoff.", drone_id)

                        replacement = find_best_replacement(drone_id, drone.position)
                        if replacement:
                            victim_id = drone.tracking_victim_id
                            add_log("REASONING", f"Handoff: {replacement.id} taking over for {drone_id}", "COMMAND")

                            # Trigger replacement
                            replacement.status = "DEPLOYING"
                            replacement.assigned_sector = drone.assigned_sector
                            waypoints[replacement.id] = generate_lawnmower_waypoints(drone.assigned_sector)
                            waypoint_index[replacement.id] = 0

                            # Update victim tracking
                            for alert in alerts:
                                if alert.get("victimId") == victim_id:
                                    alert["droneId"] = replacement.id
                                    break

                            # Original drone returns
                            drone.status = "RECALLING"
                            drone.tracking_victim_id = None

            # Thermal detection check
            for victim_id, victim in list(victims.items()):
                # Use GridManager's secret victim discovery system
                # Check each searching drone for nearby undiscovered victims
                for drone in drones.values():
                    if drone.status not in ["SEARCHING", "DEPLOYING"]:
                        continue

                    # Check GridManager for secret victims near this drone
                    discovered = drone_manager.grid_manager.check_and_discover_victims(
                        drone.position[0], drone.position[2]
                    )

                    for victim_data in discovered:
                        victim_id = victim_data["id"]
                        vx = victim_data["position"]["x"]
                        vz = victim_data["position"]["z"]

                        # Update the local victims dict for frontend
                        if victim_id in victims:
                            victims[victim_id]["detected"] = True

                        # Update drone to tracking
                        drone.status = "TRACKING"
                        drone.position = [vx, 3, vz]
                        drone.tracking_victim_id = victim_id

                        add_log("REASONING", f"{drone.id} thermal scan positive! Discovered {victim_id} at ({vx}, {vz}). Tracking. Awaiting dispatch.", "COMMAND")

                        # Create alert for frontend
                        alerts.append({
                            "id": f"alert-{len(alerts)}",
                            "victimId": victim_id,
                            "position": {"x": vx, "y": 0, "z": vz},
                            "status": "AWAITING_DISPATCH",
                            "droneId": drone.id,
                        })

                        # Trigger agent to analyze detection and coordinate response
                        if agent_trigger_event:
                            agent_trigger_event.set()
                            add_log("SYSTEM", f"VICTIM DISCOVERED: {victim_id} at ({vx}, {vz}). Agent analyzing. Awaiting rescue dispatch approval.", "AGENT")

            # Broadcast state
            await broadcast_drone_state()

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in simulation loop: {e}")


async def trigger_replacement(sector: str, replacement_id: str):
    """Schedule replacement drone deployment after delay."""
    await asyncio.sleep(0.5)
    if replacement_id in drones:
        drones[replacement_id].status = "DEPLOYING"
        drones[replacement_id].assigned_sector = sector


async def complete_rescue(victim_id: str, drone_id: str):
    """Complete rescue after 10 second countdown."""
    await asyncio.sleep(10)

    if drone_id not in drones:
        return

    drone = drones[drone_id]

    # Mark victim as rescued
    if victim_id in victims:
        victims[victim_id]["rescued"] = True
        add_log("SUCCESS", f"Victim {victim_id} rescued!", drone_id)

    # Update alert
    for alert in alerts:
        if alert.get("victimId") == victim_id:
            alert["status"] = "RESCUED"
            break

    # Post-rescue: find new sector for drone
    covered = {
        d.assigned_sector for d in drones.values()
        if d.assigned_sector and d.status in ["SEARCHING", "TRACKING", "DEPLOYING"]
    }

    new_sector = None
    for s in SECTOR_ASSIGNMENTS:
        if s not in covered:
            new_sector = s
            break

    if new_sector:
        drone.status = "DEPLOYING"
        drone.assigned_sector = new_sector
        add_log("ACTION", f"Deploying to Sector {new_sector} after rescue.", drone_id)
    else:
        # All sectors covered, return to base
        drone.status = "IDLE"
        drone.assigned_sector = None
        drone.position = [0, 2, 0]
        add_log("SUCCESS", "All sectors covered. Returning to base.", drone_id)

    # Clear tracking
    drone.tracking_victim_id = None


async def agent_loop():
    """
    Commander Agent loop that runs periodically to analyze mission state
    and provide recommendations. Also responds immediately to user triggers
    (e.g., rescue dispatch). Logs are printed to terminal and sent to frontend.
    """
    global agent_trigger_event
    agent_running = False

    while True:
        try:
            # Wait for either regular interval (5s) or trigger event
            if agent_trigger_event:
                # Wait for trigger with timeout
                try:
                    await asyncio.wait_for(agent_trigger_event.wait(), timeout=5.0)
                    # Event was triggered - clear it
                    agent_trigger_event.clear()
                    trigger_reason = "User dispatched rescue. "
                except asyncio.TimeoutError:
                    trigger_reason = ""
            else:
                await asyncio.sleep(5)
                trigger_reason = ""

            # Only run if we have drones and mission is active
            if not drones or not drone_manager:
                continue

            # Check if this is the first run - print startup message
            if not agent_running:
                agent_running = True
                startup_msg = "AEGIS COMMANDER AGENT: Online. Monitoring fleet status..."
                print(f"\n[AGENT] {startup_msg}")
                add_log("SYSTEM", startup_msg, "AGENT")

            # Create deps with current drone_manager
            deps = DroneDeps(drone_manager=drone_manager)

            # Analyze current situation
            try:
                # Build context based on current state
                detected_victims = [v for v in victims.values() if v.get("detected")]
                low_battery = [d for d in drones.values() if d.battery < 20]
                searching = [d for d in drones.values() if d.status == "SEARCHING"]
                tracking = [d for d in drones.values() if d.status == "TRACKING"]

                if tracking:
                    context = f"TRACKING: {len(tracking)} drone(s) tracking victim(s). "
                elif searching:
                    context = f"SEARCHING: {len(searching)} drone(s) searching. "
                else:
                    context = "No active search in progress. "

                if low_battery:
                    context += f"LOW BATTERY: {', '.join([d.id for d in low_battery])}. "

                if detected_victims:
                    context += f"DETECTED: {len(detected_victims)} victim(s) awaiting rescue. "

                # Add pending dispatch info
                awaiting_dispatch = [a for a in alerts if a.get("status") == "AWAITING_DISPATCH"]
                if awaiting_dispatch:
                    context += f"PENDING APPROVAL: {len(awaiting_dispatch)} victim(s) awaiting rescue dispatch approval. "
                    for a in awaiting_dispatch:
                        context += f"Victim {a['victimId']} detected by {a['droneId']}. "

                # Add trigger reason if this was a user-triggered run
                if trigger_reason:
                    context = trigger_reason + context

                # Get agent recommendation
                agent_result = await get_actionable_recommendation(deps, context)
                result = agent_result.output

                # Print to terminal
                print(f"\n\n{'='*50}")
                print(f"AGENT ANALYSIS - {asyncio.get_event_loop().time():.1f}s")
                if trigger_reason:
                    print(f"TRIGGERED: {trigger_reason}")
                print(f"{'='*50}\n")
                print(f"Risk Score: {result.risk_score:.2f}\n")
                print(f"Action: {result.chosen_action}\n")
                print(f"Battery: {result.battery_analysis}\n")
                print(f"Reasoning: {result.internal_monologue}")

                # Log tool calls to frontend
                if agent_result.tool_calls:
                    print("\n[TOOL CALLS]")
                    for tc in agent_result.tool_calls:
                        tool_name = tc.get("tool", "unknown")
                        tool_args = tc.get("args", "")
                        print(f"  - {tool_name}({tool_args})")
                        add_log("REASONING", f"[TOOL CALL] {tool_name}({tool_args})", "AGENT")

                # Send logs to frontend (full reasoning, not truncated)
                add_log("REASONING", f"[AGENT REASONING] {result.internal_monologue}", "AGENT")
                add_log("REASONING", f"[BATTERY] {result.battery_analysis}", "AGENT")
                add_log("ACTION", f"Recommended: {result.chosen_action.upper()} (risk: {result.risk_score:.2f})", "AGENT")

                # Broadcast updated state (includes new logs)
                await broadcast_drone_state()

            except Exception as e:
                logger.error(f"Agent loop error: {e}")

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in agent loop: {e}")


async def broadcast_drone_state():
    """Broadcast current drone states to all connected clients."""
    if not active_connections:
        return

    # Get all drone states
    drone_states = {
        drone_id: drone.get_state()
        for drone_id, drone in drones.items()
    }

    message = json.dumps({
        "type": "drone_update",
        "drones": drone_states,
        "victims": victims,
        "logs": logs,
        "alerts": alerts,
        "selectedDrone": selected_drone_id,
    })

    # Send to all connections
    disconnected = set()
    for connection in active_connections:
        try:
            await connection.send_text(message)
        except Exception as e:
            logger.error(f"Error sending to client: {e}")
            disconnected.add(connection)

    # Remove disconnected clients
    for conn in disconnected:
        active_connections.discard(conn)


async def broadcast_initial_state(websocket: WebSocket):
    """Send initial state to a newly connected client."""
    drone_states = {
        drone_id: drone.get_state()
        for drone_id, drone in drones.items()
    }

    message = json.dumps({
        "type": "initial_state",
        "drones": drone_states,
        "victims": victims,
        "logs": logs,
        "alerts": alerts,
        "selectedDrone": selected_drone_id,
    })

    await websocket.send_text(message)


@app.websocket("/ws/drone-control")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for drone control."""
    global selected_drone_id, drones, victims

    conn_id = str(id(websocket))

    await websocket.accept()
    active_connections.add(websocket)

    logger.info(f"Client connected: {conn_id}")

    # Send initial state to the newly connected client
    await broadcast_initial_state(websocket)

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)

            msg_type = message.get("type")

            if msg_type == "select_drone":
                drone_id = message.get("droneId")
                if drone_id and drone_id in drones:
                    selected_drone_id = drone_id
                    logger.info(f"Selected drone: {drone_id}")

            elif msg_type == "sync_config":
                config = message.get("config", {})
                drone_count = len(config.get('drones', []))
                victim_count = len(config.get('victims', []))
                logger.info(f">>> Received sync_config: {drone_count} drones, {victim_count} victims")
                logger.info(f"Drones: {[d.get('id') for d in config.get('drones', [])]}")

                # Reinitialize drones and victims from config
                drones = {}
                victims = {}

                # Clear any previous state from DroneManager
                drone_manager.clear_victims()
                drone_manager.clear_drones()

                # Process victims first and register in DroneManager grid
                for v in config.get("victims", []):
                    victim_id = v.get("id", f"VIC-{len(victims)+1:03d}")
                    position = v.get("position", [0, 0, 0])
                    victims[victim_id] = {
                        "id": victim_id,
                        "position": position,
                        "detected": False,
                    }
                    # Register victim in DroneManager grid
                    drone_manager.add_victim(position[0], position[2], victim_id)

                # Process drones and create them via DroneManager
                # Drones start in IDLE - deployment happens via start_mission using optimize_fleet_deployment
                online_drones = [d for d in config.get("drones", []) if d.get("online")]
                for d in online_drones:
                    battery = d.get("battery", 100)

                    # Create drone at base, waiting for mission start
                    drone = Drone(
                        id=d["id"],
                        battery=battery,
                        position=[0, 2, 0],  # At charging hub
                        status="IDLE",
                        assigned_sector=None,
                    )
                    drone_manager.drones[d["id"]] = drone
                    drones[d["id"]] = drone
                    logger.info(f"  Drone {d['id']} (battery: {battery}%) -> IDLE at base")

                await websocket.send_text(json.dumps({
                    "type": "config_ack",
                    "status": "success",
                    "drone_count": len(drones),
                    "victim_count": len(victims),
                }))
                logger.info(f">>> Sent config_ack to client")

            elif msg_type == "start_mission":
                # Assign sectors to drones and start mission
                logger.info(">>> Received start_mission message")
                logger.info("Starting mission - assigning sectors")

                # Use drone_manager's optimize_fleet_deployment for assignment
                # Assigns highest battery drones to furthest sectors
                deployment_result = drone_manager.optimize_fleet_deployment()
                logger.info(f"Fleet optimization result: {deployment_result['message']}")

                # Apply deployments from optimization result
                for deployment in deployment_result.get("deployments", []):
                    drone_id = deployment["drone_id"]
                    sector = deployment["sector"]
                    if drone_id in drones:
                        drones[drone_id].assigned_sector = sector
                        drones[drone_id].status = "DEPLOYING"
                        logger.info(f"  {drone_id} ({deployment['battery']}%) -> Sector {sector} (round-trip: {deployment['round_trip_distance']})")

                # Log any warnings
                for warning in deployment_result.get("warnings", []):
                    logger.warning(f"Deployment warning: {warning}")

                # Log deployment
                deployed_count = 0
                for deployment in deployment_result.get("deployments", []):
                    drone_id = deployment["drone_id"]
                    sector = deployment["sector"]
                    add_log("ACTION", f"Dispatched to Sector {sector}. Initiating thermal scan.", drone_id)
                    deployed_count += 1

                await websocket.send_text(json.dumps({
                    "type": "mission_started",
                    "status": "success",
                    "deployed_count": deployed_count,
                }))

            elif msg_type == "rescue_dispatch":
                # User clicks "Dispatch Rescue" on an alert
                victim_id = message.get("victimId")
                logger.info(f"Rescue dispatch for {victim_id}")

                # Find the alert and drone
                for alert in alerts:
                    if alert.get("victimId") == victim_id:
                        drone_id = alert.get("droneId")
                        if drone_id and drone_id in drones:
                            drone = drones[drone_id]

                            # Start rescue countdown (10 seconds)
                            alert["status"] = "RESCUE_OTW"
                            alert["rescueStartTime"] = asyncio.get_event_loop().time()

                            # After 10 seconds, complete rescue
                            asyncio.create_task(complete_rescue(victim_id, drone_id))

                            add_log("ACTION", f"Rescue team dispatched for {victim_id}. ETA 10s.", drone_id)
                        break

                # Trigger agent to continue searching for other victims
                if agent_trigger_event:
                    agent_trigger_event.set()
                    add_log("SYSTEM", "Rescue dispatched. Agent prompted to continue search for additional victims.", "AGENT")

                await websocket.send_text(json.dumps({
                    "type": "rescue_dispatch_ack",
                    "status": "success",
                    "victimId": victim_id,
                }))

            elif msg_type == "get_state":
                # Client requesting full state
                await broadcast_initial_state(websocket)

    except WebSocketDisconnect:
        logger.info(f"Client disconnected: {conn_id}")
        active_connections.discard(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        active_connections.discard(websocket)


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "AEGIS Drone Control API",
        "version": "1.0.0",
        "endpoints": {
            "websocket": "/ws/drone-control",
            "docs": "/docs"
        }
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "drones": len(drones),
        "victims": len(victims),
        "connections": len(active_connections),
        "grid_summary": drone_manager.get_grid_summary() if drone_manager else {}
    }
