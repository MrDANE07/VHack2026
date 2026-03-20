"""MCP Server for AEGIS Drone Command using FastMCP SDK.

This server exposes drone fleet management tools to an AI Command Agent,
with WebSocket broadcast integration for real-time state synchronization.

Improvements:
- Consistent battery safety checks across all dispatch tools
- Exposes uncovered sectors for deployment decisions
- Sector-based deployment with optimal drone selection
- Clear separation between discovery and verification tools
"""

import asyncio
import json
import logging
import math
import random
import sys
from typing import Dict, Any, Set, Optional, List

import fastmcp

# Import existing drone components
from drone import Drone
from drone_manager import DroneManager, GridCell, get_sector_id

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastMCP server
mcp = fastmcp.FastMCP("aegis-drone-command")

# Global instances
# drone_manager will be set by initialize_drone_manager()
active_connections: Set[Any] = set()

# Battery thresholds
MIN_BATTERY_DEPLOYMENT = 40  # Minimum battery % to deploy
MIN_BATTERY_SCAN = 20        # Minimum battery % to scan
LOW_BATTERY_THRESHOLD = 20   # Low battery warning
CRITICAL_BATTERY_THRESHOLD = 15  # Critical - must return

# Callback for real-time victim discovery notifications
# This will be sent via stdout in MCP protocol format
def victim_discovered_callback(victim_id: str, x: int, z: int) -> None:
    """Callback invoked when a drone discovers a victim.

    Sends a real-time notification to the Commander Agent via stdout.
    """
    message = {
        "type": "tool_result",
        "tool": "VICTIM_DISCOVERY_NOTIFICATION",
        "content": f"VICTIM_DETECTED: {victim_id} at coordinates ({x}, {z}). Thermal signature confirmed. Awaiting rescue dispatch.",
        "data": {
            "victim_id": victim_id,
            "position": {"x": x, "z": z},
            "alert": "Rescue team dispatch required"
        }
    }
    # Write to stdout in JSON format for MCP protocol
    print(json.dumps(message), flush=True)
    logger.info(f"MCP Notification sent: VICTIM_DETECTED {victim_id}")

# Simulated victims for thermal scanning (used for simulation)
SIMULATED_VICTIMS: Dict[str, Dict[str, Any]] = {
    "VICTIM-001": {"x": 15.0, "z": 18.0, "temp": 98.6, "confidence": 0.85},
    "VICTIM-002": {"x": 32.0, "z": 7.0, "temp": 97.8, "confidence": 0.72},
    "VICTIM-003": {"x": 8.0, "z": 35.0, "temp": 99.1, "confidence": 0.91},
    "VICTIM-004": {"x": 42.0, "z": 41.0, "temp": 98.2, "confidence": 0.68},
}


def initialize_drone_manager() -> DroneManager:
    """Initialize the drone manager with fleet."""
    global drone_manager
    drone_manager = DroneManager()
    drone_manager.initialize_fleet()

    # Add some initial victims to the grid (secret - not visible to agent until discovered)
    for victim_id, data in SIMULATED_VICTIMS.items():
        drone_manager.add_victim(data["x"], data["z"], victim_id)

    # Register callback for victim discovery notifications
    # This sends real-time notifications to the Commander Agent
    drone_manager.grid_manager.register_discovery_callback(victim_discovered_callback)
    logger.info("Registered victim discovery callback for MCP notifications")

    # Mark some cells as visited
    for x in range(5):
        for z in range(5):
            drone_manager.mark_cell_visited(float(x * 5), float(z * 5))

    logger.info("DroneManager initialized")
    return drone_manager


async def broadcast_drone_state() -> None:
    """Broadcast current drone states to all connected WebSocket clients."""
    if not active_connections:
        return

    drone_states = drone_manager.get_drone_states()

    message = json.dumps({
        "type": "drone_update",
        "drones": drone_states,
        "selectedDrone": drone_manager.selected_drone_id,
    })

    disconnected = set()
    for connection in active_connections:
        try:
            await connection.send_text(message)
        except Exception as e:
            logger.error(f"Error sending to client: {e}")
            disconnected.add(connection)

    for conn in disconnected:
        active_connections.discard(conn)


def calculate_distance(x1: float, z1: float, x2: float, z2: float) -> float:
    """Calculate Euclidean distance between two points."""
    return math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2)


def register_websocket_connection(connection: Any) -> None:
    """Register a WebSocket connection for broadcasts."""
    active_connections.add(connection)


def unregister_websocket_connection(connection: Any) -> None:
    """Unregister a WebSocket connection."""
    active_connections.discard(connection)


# ============== MCP TOOLS ==============

@mcp.tool()
async def get_fleet_overview() -> str:
    """
    Get a quick overview of all drones in the fleet.

    Returns: drone ID, status, battery, position, and assigned sector.
    Use this as the first tool to understand current fleet state.
    """
    drones = drone_manager.get_all_drones()
    available = drone_manager.get_available_drones()
    low_battery = drone_manager.get_low_battery_drones()

    result = {
        "message": "Fleet overview",
        "total_drones": len(drones),
        "available_count": len(available),
        "low_battery_count": len(low_battery),
        "drones": [
            {
                "id": drone.id,
                "status": drone.status,
                "battery": round(drone.battery, 1),
                "assigned_sector": drone.assigned_sector,
                "position": {
                    "x": round(drone.position[0], 1),
                    "z": round(drone.position[2], 1)
                }
            }
            for drone in drones.values()
        ],
        "low_battery_drones": [d.id for d in low_battery]
    }

    return json.dumps(result, indent=2)


@mcp.tool()
async def get_deployment_status() -> str:
    """
    Get sector coverage status and deployment recommendations.

    Returns:
    - Which sectors are covered by active drones
    - Which sectors are uncovered and need drones
    - Available drones for deployment
    - Recommended deployment strategy based on battery and distance
    """
    uncovered = drone_manager.get_uncovered_sectors()
    coverage = drone_manager.get_drone_sector_coverage_status()
    available = drone_manager.get_available_drones()
    sectors_by_distance = drone_manager.get_sectors_by_distance(reverse=False)

    # Calculate recommended deployments
    recommendations = []
    for drone in sorted(available, key=lambda d: -d.battery):
        if uncovered:
            # Recommend nearest uncovered sector
            for sector, dist in sectors_by_distance:
                if sector in uncovered and sector not in [r["sector"] for r in recommendations]:
                    recommendations.append({
                        "drone_id": drone.id,
                        "battery": round(drone.battery, 1),
                        "recommended_sector": sector,
                        "round_trip_distance": round(dist * 2, 1),
                        "feasible": drone.battery > MIN_BATTERY_DEPLOYMENT
                    })
                    break

    return json.dumps({
        "sector_coverage": coverage,
        "uncovered_sectors": uncovered,
        "available_drones": [d.id for d in available],
        "recommendations": recommendations,
        "strategy": "nearest_sectors" if len(available) < len(uncovered) else "furthest_sectors" if available else "none"
    }, indent=2)


@mcp.tool()
async def deploy_to_sector(drone_id: str, sector: str) -> str:
    """
    Deploy a drone to a specific sector for search operations.

    Validates:
    - Drone exists and is available
    - Battery is sufficient (>40%)
    - Sector is within bounds (A, B, C, D)

    Returns deployment confirmation or error with reason.
    """
    # Validate drone
    drone = drone_manager.get_drone(drone_id)
    if not drone:
        return json.dumps({
            "error": f"Drone {drone_id} not found",
            "available_drones": list(drone_manager.get_all_drones().keys())
        }, indent=2)

    # Validate sector
    valid_sectors = ["A", "B", "C", "D"]
    if sector not in valid_sectors:
        return json.dumps({
            "error": f"Invalid sector {sector}",
            "valid_sectors": valid_sectors
        }, indent=2)

    # Check battery
    if drone.battery < MIN_BATTERY_DEPLOYMENT:
        return json.dumps({
            "error": f"Insufficient battery to deploy",
            "drone_id": drone_id,
            "current_battery": round(drone.battery, 1),
            "minimum_required": MIN_BATTERY_DEPLOYMENT,
            "action": f"Return to base for charging (battery < {MIN_BATTERY_DEPLOYMENT}%)"
        }, indent=2)

    # Check if already deployed to this sector
    if drone.assigned_sector == sector and drone.status in ["SEARCHING", "DEPLOYING"]:
        return json.dumps({
            "error": f"Drone already deployed to sector {sector}",
            "drone_id": drone_id,
            "current_status": drone.status
        }, indent=2)

    # Calculate round-trip distance for battery check
    round_trip = drone_manager.calculate_round_trip_distance(sector)
    battery_needed = round_trip * 0.5

    if drone.battery < battery_needed + 15:  # 15% safety margin
        return json.dumps({
            "error": "Insufficient battery for round trip",
            "drone_id": drone_id,
            "current_battery": round(drone.battery, 1),
            "battery_needed": round(battery_needed + 15, 1),
            "action": "Charge at base before deployment"
        }, indent=2)

    # Deploy drone
    drone.assigned_sector = sector
    drone.status = "DEPLOYING"

    # Set initial position to sector entry point
    sector_entries = {"A": [2, 2], "B": [48, 2], "C": [2, 48], "D": [48, 48]}
    drone.position = [sector_entries[sector][0], 5, sector_entries[sector][1]]

    await broadcast_drone_state()

    return json.dumps({
        "success": True,
        "drone_id": drone_id,
        "sector": sector,
        "status": "DEPLOYING",
        "position": {
            "x": round(drone.position[0], 1),
            "z": round(drone.position[2], 1)
        },
        "battery": round(drone.battery, 1),
        "message": f"Deployed to sector {sector}"
    }, indent=2)


@mcp.tool()
async def return_to_base(drone_id: str) -> str:
    """
    Command a drone to return to the charging base at (0,0).

    Used for:
    - Low battery recall
    - Manual recall
    - End of mission

    Returns confirmation or error if drone can't make it back.
    """
    drone = drone_manager.get_drone(drone_id)

    if not drone:
        return json.dumps({
            "error": f"Drone {drone_id} not found",
            "available_drones": list(drone_manager.get_all_drones().keys())
        }, indent=2)

    # Calculate distance to base
    current_x, _, current_z = drone.position
    distance_to_base = calculate_distance(current_x, current_z, 0, 0)
    battery_needed = distance_to_base * 0.5

    # Check if enough battery
    if drone.battery < battery_needed + 5:
        return json.dumps({
            "error": "Insufficient battery to return to base",
            "drone_id": drone_id,
            "current_battery": round(drone.battery, 1),
            "battery_needed": round(battery_needed + 5, 1),
            "action": "Wait for charging or dispatch rescue drone"
        }, indent=2)

    # Update drone state
    drone.position = [0, 2, 0]
    drone.status = "RECALLING"
    drone.assigned_sector = None

    await broadcast_drone_state()

    return json.dumps({
        "success": True,
        "drone_id": drone_id,
        "action": "Returning to base",
        "new_position": {"x": 0, "y": 2, "z": 0},
        "status": "RECALLING",
        "distance_traveled": round(distance_to_base, 2),
        "remaining_battery": round(drone.battery, 1)
    }, indent=2)


@mcp.tool()
async def move_drone(drone_id: str, x: float, z: float) -> str:
    """
    Move a drone to a specific position.

    Used for:
    - Directing drone to a specific location
    - Repositioning during search
    - Moving to investigate areas

    Returns confirmation or error if movement is not possible.
    """
    drone = drone_manager.get_drone(drone_id)

    if not drone:
        return json.dumps({
            "error": f"Drone {drone_id} not found",
            "available_drones": list(drone_manager.get_all_drones().keys())
        }, indent=2)

    # Validate coordinates
    if not (0 <= x <= 50 and 0 <= z <= 50):
        return json.dumps({
            "error": f"Coordinates out of bounds. Must be 0-50.",
            "requested": {"x": x, "z": z}
        }, indent=2)

    # Calculate distance and battery needed
    current_x, _, current_z = drone.position
    distance = calculate_distance(current_x, current_z, x, z)
    battery_needed = distance * 0.5

    # Check battery (need enough for movement + 15% safety margin)
    if drone.battery < battery_needed + 15:
        return json.dumps({
            "error": "Insufficient battery for movement",
            "drone_id": drone_id,
            "current_battery": round(drone.battery, 1),
            "battery_needed": round(battery_needed + 15, 1),
            "action": "return_to_base or wait for charging"
        }, indent=2)

    # Set target position (will be moved toward in simulation loop)
    drone.target_position = [x, 5, z]
    drone.status = "MOVING"

    # Consume battery
    drone.battery = max(0, drone.battery - battery_needed)

    await broadcast_drone_state()

    return json.dumps({
        "success": True,
        "drone_id": drone_id,
        "action": "moving_to_target",
        "target_position": {"x": x, "y": 5, "z": z},
        "status": "MOVING",
        "distance": round(distance, 2),
        "battery_used": round(battery_needed, 1),
        "remaining_battery": round(drone.battery, 1)
    }, indent=2)


@mcp.tool()
async def set_drone_status(drone_id: str, status: str) -> str:
    """
    Set a drone's status directly.

    Valid statuses:
    - IDLE: At charging base
    - CHARGING: Recharging at base
    - SEARCHING: Lawnmower pattern search
    - TRACKING: Stationary over victim
    - RECALLING: Returning to base

    Returns confirmation or error.
    """
    valid_statuses = ["IDLE", "CHARGING", "SEARCHING", "TRACKING", "RECALLING", "DEPLOYING", "MOVING"]

    drone = drone_manager.get_drone(drone_id)

    if not drone:
        return json.dumps({
            "error": f"Drone {drone_id} not found",
            "available_drones": list(drone_manager.get_all_drones().keys())
        }, indent=2)

    if status not in valid_statuses:
        return json.dumps({
            "error": f"Invalid status {status}",
            "valid_statuses": valid_statuses,
            "current_status": drone.status
        }, indent=2)

    old_status = drone.status
    drone.status = status

    await broadcast_drone_state()

    return json.dumps({
        "success": True,
        "drone_id": drone_id,
        "old_status": old_status,
        "new_status": status,
        "battery": round(drone.battery, 1),
        "position": {
            "x": round(drone.position[0], 1),
            "y": round(drone.position[1], 1),
            "z": round(drone.position[2], 1)
        }
    }, indent=2)


@mcp.tool()
async def set_search_pattern(drone_id: str, sector: str) -> str:
    """
    Start a lawnmower search pattern in a sector.

    The drone will systematically search the sector grid in a boustrophedon pattern.

    Returns confirmation or error.
    """
    valid_sectors = ["A", "B", "C", "D"]

    drone = drone_manager.get_drone(drone_id)

    if not drone:
        return json.dumps({
            "error": f"Drone {drone_id} not found",
            "available_drones": list(drone_manager.get_all_drones().keys())
        }, indent=2)

    if sector not in valid_sectors:
        return json.dumps({
            "error": f"Invalid sector {sector}",
            "valid_sectors": valid_sectors
        }, indent=2)

    # Check battery (need at least 40% for search mission)
    if drone.battery < 40:
        return json.dumps({
            "error": "Insufficient battery for search mission",
            "drone_id": drone_id,
            "current_battery": round(drone.battery, 1),
            "required_battery": 40,
            "action": "return_to_base or wait for charging"
        }, indent=2)

    # Set drone to search mode in sector
    drone.assigned_sector = sector
    drone.status = "SEARCHING"

    # Get sector bounds and set initial waypoint
    sector_bounds = drone_manager.get_sector_bounds(sector)
    min_x, max_x, min_z, max_z = sector_bounds

    # Start at sector entry point
    drone.target_position = [min_x, 5, min_z]
    drone.search_waypoint_index = 0
    drone.search_direction = 1  # 1 = positive X, -1 = negative X

    await broadcast_drone_state()

    return json.dumps({
        "success": True,
        "drone_id": drone_id,
        "action": "searching",
        "sector": sector,
        "status": "SEARCHING",
        "sector_bounds": {
            "min_x": min_x, "max_x": max_x,
            "min_z": min_z, "max_z": max_z
        },
        "start_position": {"x": min_x, "y": 5, "z": min_z},
        "battery": round(drone.battery, 1)
    }, indent=2)


@mcp.tool()
async def start_thermal_scan(drone_id: str) -> str:
    """
    Trigger a thermal scan at the drone's current position.

    The drone will scan for heat signatures (victims) in its vicinity.

    Returns scan results or confirmation.
    """
    drone = drone_manager.get_drone(drone_id)

    if not drone:
        return json.dumps({
            "error": f"Drone {drone_id} not found",
            "available_drones": list(drone_manager.get_all_drones().keys())
        }, indent=2)

    # Consume battery for scan
    scan_battery_cost = 3.0
    if drone.battery < scan_battery_cost:
        return json.dumps({
            "error": "Insufficient battery for thermal scan",
            "drone_id": drone_id,
            "current_battery": round(drone.battery, 1),
            "required_battery": scan_battery_cost
        }, indent=2)

    drone.battery = max(0, drone.battery - scan_battery_cost)

    # Check for victims at current position
    current_x = int(drone.position[0])
    current_z = int(drone.position[2])

    grid_manager = drone_manager.grid_manager
    discovered = grid_manager.check_and_discover_victims(current_x, current_z)

    victims_found = []
    for v in discovered:
        victims_found.append({
            "id": v.get("id"),
            "x": v.get("x"),
            "z": v.get("z")
        })

    await broadcast_drone_state()

    return json.dumps({
        "success": True,
        "drone_id": drone_id,
        "action": "thermal_scan",
        "scan_position": {
            "x": round(drone.position[0], 1),
            "z": round(drone.position[2], 1)
        },
        "battery_used": scan_battery_cost,
        "remaining_battery": round(drone.battery, 1),
        "victims_found": victims_found,
        "victim_count": len(victims_found)
    }, indent=2)


@mcp.tool()
async def get_sector_status(sector: str) -> str:
    """
    Get detailed status of a specific sector.

    Returns:
    - Exploration percentage
    - Number of explored/unexplored cells
    - Drones currently assigned
    - Nearest unexplored point
    """
    valid_sectors = ["A", "B", "C", "D"]
    if sector not in valid_sectors:
        return json.dumps({"error": f"Invalid sector {sector}", "valid_sectors": valid_sectors}, indent=2)

    grid_manager = drone_manager.grid_manager
    sector_summary = grid_manager.get_sector_summary()
    sector_data = sector_summary[sector]

    # Get nearest unexplored
    sector_centers = {"A": [12.5, 12.5], "B": [37.5, 12.5], "C": [12.5, 37.5], "D": [37.5, 37.5]}
    center = sector_centers[sector]
    nearest = grid_manager.get_nearest_unexplored(sector, center[0], center[1])

    # Get drones in sector
    drones_in_sector = drone_manager.get_drones_in_sector(sector)
    active_drones = [d for d in drones_in_sector if d.status in ["SEARCHING", "DEPLOYING", "TRACKING"]]

    # Check if sector is covered
    coverage = drone_manager.get_drone_sector_coverage_status()
    is_covered = coverage.get(sector, False)

    return json.dumps({
        "sector": sector,
        "explored": sector_data["explored"],
        "total": sector_data["total"],
        "exploration_percentage": sector_data["percentage"],
        "is_covered": is_covered,
        "active_drones": [
            {
                "id": d.id,
                "status": d.status,
                "battery": round(d.battery, 1)
            }
            for d in active_drones
        ],
        "nearest_unexplored": {
            "x": nearest["x"] if nearest else None,
            "z": nearest["z"] if nearest else None,
            "distance": round(nearest["distance"], 1) if nearest else None
        } if nearest else {"fully_explored": True}
    }, indent=2)


@mcp.tool()
async def get_grid_exploration() -> str:
    """
    Get grid exploration status.

    Returns:
    - Total exploration percentage
    - Per-sector exploration details
    - Which sectors are fully explored
    """
    grid_manager = drone_manager.grid_manager
    sector_summary = grid_manager.get_sector_summary()
    grid_summary = drone_manager.get_grid_summary()

    fully_explored = [s for s, data in sector_summary.items() if data["percentage"] >= 99.0]

    return json.dumps({
        "total_exploration": round(grid_summary["visited_percentage"], 1),
        "sectors": {
            sector: {
                "explored": data["explored"],
                "total": data["total"],
                "percentage": data["percentage"]
            }
            for sector, data in sector_summary.items()
        },
        "fully_explored_sectors": fully_explored,
        "needs_coverage": [s for s in ["A", "B", "C", "D"] if s not in fully_explored]
    }, indent=2)


@mcp.tool()
async def get_battery_status(drone_id: str) -> str:
    """
    Get detailed battery status for a specific drone.

    Returns:
    - Current battery level
    - Estimated range (max distance can travel)
    - Whether can deploy, scan, or return to base
    - Recommendations based on current status
    """
    drone = drone_manager.get_drone(drone_id)
    if not drone:
        return json.dumps({"error": f"Drone {drone_id} not found"}, indent=2)

    # Calculate max range (0.5% per unit, with safety margin)
    safety_margin = 15
    available_battery = drone.battery - safety_margin
    max_range = available_battery / 0.5 if available_battery > 0 else 0

    # Determine capabilities
    can_deploy = drone.battery >= MIN_BATTERY_DEPLOYMENT
    can_scan = drone.battery >= MIN_BATTERY_SCAN
    can_return = True  # Assume base is always reachable if not critically low

    # Status-specific recommendations
    recommendations = []
    if drone.battery < LOW_BATTERY_THRESHOLD:
        recommendations.append("CRITICAL: Return to base immediately")
    elif drone.battery < 30:
        recommendations.append("Low battery - consider returning to base")
    elif drone.status == "IDLE" and can_deploy:
        recommendations.append("Ready for deployment")
    elif drone.status == "CHARGING":
        recommendations.append("Charging - wait for >40% to deploy")
    elif drone.status == "SEARCHING":
        recommendations.append("Continue search - monitor battery")

    return json.dumps({
        "drone_id": drone_id,
        "battery": round(drone.battery, 1),
        "status": drone.status,
        "max_range_units": round(max_range, 1),
        "capabilities": {
            "can_deploy": can_deploy,
            "can_scan": can_scan,
            "can_return": can_return
        },
        "thresholds": {
            "deployment": MIN_BATTERY_DEPLOYMENT,
            "scan": MIN_BATTERY_SCAN,
            "low_battery": LOW_BATTERY_THRESHOLD
        },
        "recommendations": recommendations
    }, indent=2)


async def main():
    """Main entry point for the MCP server."""
    global drone_manager

    # Initialize drone manager
    drone_manager = initialize_drone_manager()

    logger.info("Starting AEGIS Drone MCP Server...")
    logger.info("Available tools: get_fleet_overview, get_deployment_status, deploy_to_sector, return_to_base, get_sector_status, get_grid_exploration, get_battery_status")

    # Run the server
    await mcp.run(transport="stdio")


if __name__ == "__main__":
    # Initialize drone manager
    global drone_manager
    drone_manager = initialize_drone_manager()

    logger.info("Starting AEGIS Drone MCP Server...")
    logger.info("Available tools: get_fleet_overview, get_deployment_status, deploy_to_sector, return_to_base, get_sector_status, get_grid_exploration, get_battery_status")

    # Run MCP server directly (not inside asyncio.run since mcp.run manages its own loop)
    mcp.run(transport="stdio")