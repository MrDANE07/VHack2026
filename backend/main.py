"""FastAPI server with WebSocket for drone control."""

import asyncio
import json
import logging
from typing import Dict, Set, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from drone import Drone

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global state
drones: Dict[str, Drone] = {}
active_connections: Set[WebSocket] = set()
selected_drone_id: Optional[str] = None
pressed_keys: Dict[str, str] = {}  # connection_id -> key
movement_task: Optional[asyncio.Task] = None


def create_initial_drones() -> Dict[str, Drone]:
    """Create the initial drone fleet."""
    return {
        "DRONE-01": Drone(id="DRONE-01", position=[12.5, 5, 12.5], status="SEARCHING", battery=95, assigned_sector="A"),
        "DRONE-02": Drone(id="DRONE-02", position=[37.5, 5, 12.5], status="SEARCHING", battery=88, assigned_sector="B"),
        "DRONE-03": Drone(id="DRONE-03", position=[12.5, 5, 37.5], status="SEARCHING", battery=72, assigned_sector="C"),
        "DRONE-04": Drone(id="DRONE-04", position=[37.5, 5, 37.5], status="SEARCHING", battery=65, assigned_sector="D"),
        "DRONE-05": Drone(id="DRONE-05", position=[0, 2, 0], status="CHARGING", battery=30),
        "DRONE-06": Drone(id="DRONE-06", position=[0, 2, 0], status="CHARGING", battery=15),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown."""
    global drones, movement_task

    logger.info("=" * 50)
    logger.info("Starting AEGIS Drone Control API")
    logger.info("=" * 50)

    # Start empty — frontend sends setup config via sync_config message
    drones = {}
    logger.info("Waiting for frontend configuration...")

    movement_task = asyncio.create_task(movement_loop())

    yield

    if movement_task:
        movement_task.cancel()
        try:
            await movement_task
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


async def movement_loop():
    """
    Game loop that runs continuously to apply movement
    while keys are pressed. Broadcasts positions at ~30fps.
    """
    global pressed_keys

    while True:
        try:
            await asyncio.sleep(1 / 30)  # 30fps

            # Find the drone that should move based on pressed keys
            for conn_id, key in list(pressed_keys.items()):
                if key and selected_drone_id and selected_drone_id in drones:
                    drone = drones[selected_drone_id]
                    drone.move(key)

                    # Drain battery while in manual mode
                    drone.battery = max(0, drone.battery - 0.005)

                    # Broadcast position update to all clients
                    await broadcast_drone_state()

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in movement loop: {e}")


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
        conn_id = str(id(conn))
        if conn_id in pressed_keys:
            del pressed_keys[conn_id]


async def broadcast_initial_state(websocket: WebSocket):
    """Send initial state to a newly connected client."""
    drone_states = {
        drone_id: drone.get_state()
        for drone_id, drone in drones.items()
    }

    message = json.dumps({
        "type": "initial_state",
        "drones": drone_states,
        "selectedDrone": selected_drone_id,
    })

    await websocket.send_text(message)


@app.websocket("/ws/drone-control")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for drone control."""
    global selected_drone_id

    conn_id = str(id(websocket))

    await websocket.accept()
    active_connections.add(websocket)
    pressed_keys[conn_id] = None

    logger.info(f"Client connected: {conn_id}")

    # Send initial state to the newly connected client
    await broadcast_initial_state(websocket)

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)

            msg_type = message.get("type")

            if msg_type == "keydown":
                key = message.get("key")
                drone_id = message.get("droneId")

                logger.info(f"Key down: {key} from {drone_id}")

                if drone_id and drone_id in drones:
                    selected_drone_id = drone_id
                    drone = drones[drone_id]
                    drone.enter_manual_mode()

                    # Map arrow keys to direction names
                    key_map = {
                        "ArrowUp": "up",
                        "ArrowDown": "down",
                        "ArrowLeft": "left",
                        "ArrowRight": "right",
                        "w": "up_alt",
                        "W": "up_alt",
                        "s": "down_alt",
                        "S": "down_alt",
                    }

                    direction = key_map.get(key)
                    if direction:
                        pressed_keys[conn_id] = direction
                        drone.last_key_pressed = direction

            elif msg_type == "keyup":
                key = message.get("key")
                drone_id = message.get("droneId")

                logger.info(f"Key up: {key} from {drone_id}")

                pressed_keys[conn_id] = None

                if drone_id and drone_id in drones:
                    drone = drones[drone_id]

                    # Check if any other connection is still pressing a key
                    still_pressed = any(k is not None for k in pressed_keys.values())
                    if not still_pressed:
                        drone.exit_manual_mode()
                        # Return to searching if battery sufficient, else RTB
                        if drone.battery > 20:
                            if drone.assigned_sector:
                                drone.status = "SEARCHING"
                        else:
                            drone.status = "RECALLING"

            elif msg_type == "select_drone":
                drone_id = message.get("droneId")
                if drone_id and drone_id in drones:
                    selected_drone_id = drone_id
                    logger.info(f"Selected drone: {drone_id}")

            elif msg_type == "sync_config":
                config = message.get("config", {})
                logger.info(f"Received setup config with {len(config.get('drones', []))} drones")

                drones = {}
                for d in config.get("drones", []):
                    if d.get("online"):
                        drones[d["id"]] = Drone(
                            id=d["id"],
                            battery=d["battery"],
                            position=[0, 2, 0],
                            status="IDLE",
                        )
                        logger.info(f"  Created {d['id']} with battery {d['battery']}%")

                await websocket.send_text(json.dumps({
                    "type": "config_ack",
                    "status": "success",
                    "drone_count": len(drones),
                }))

            elif msg_type == "get_state":
                # Client requesting full state
                await broadcast_initial_state(websocket)

    except WebSocketDisconnect:
        logger.info(f"Client disconnected: {conn_id}")
        active_connections.discard(websocket)
        if conn_id in pressed_keys:
            del pressed_keys[conn_id]

        # If this was the selected connection, clear selection
        if not pressed_keys:
            selected_drone_id = None
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
        "connections": len(active_connections)
    }
