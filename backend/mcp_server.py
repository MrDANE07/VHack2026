"""MCP Server for AEGIS Drone Command using FastMCP SDK.

This server exposes drone fleet management tools to an AI Command Agent,
with WebSocket broadcast integration for real-time state synchronization.
"""

import asyncio
import json
import logging
import math
import random
from typing import Dict, Any, Set

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

# Simulated victims for thermal scanning
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

    # Add some initial victims to the grid
    for victim_id, data in SIMULATED_VICTIMS.items():
        drone_manager.add_victim(data["x"], data["z"], victim_id)

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


@mcp.tool()
async def discover_drones() -> str:
    """
    Return a list of all active drone IDs and basic vitals.

    This tool provides a quick overview of the fleet status,
    showing each drone's ID, current status, and battery level.
    """
    drones = drone_manager.get_all_drones()

    result = {
        "message": "Active drones in fleet",
        "count": len(drones),
        "drones": [
            {
                "id": drone.id,
                "status": drone.status,
                "battery": round(drone.battery, 1),
                "position": {
                    "x": round(drone.position[0], 1),
                    "y": round(drone.position[1], 1),
                    "z": round(drone.position[2], 1)
                }
            }
            for drone in drones.values()
        ]
    }

    return json.dumps(result, indent=2)


@mcp.tool()
async def get_fleet_status() -> str:
    """
    Provide full telemetry for the entire fleet.

    Returns detailed information including:
    - Location (x, y, z coordinates)
    - Battery level and charging state
    - Current operational status
    - Assigned sector and current task
    """
    drones = drone_manager.get_all_drones()

    result = {
        "message": "Full fleet telemetry",
        "count": len(drones),
        "drones": {
            drone_id: {
                "id": drone.id,
                "position": {
                    "x": round(drone.position[0], 2),
                    "y": round(drone.position[1], 2),
                    "z": round(drone.position[2], 2)
                },
                "battery": round(drone.battery, 2),
                "status": drone.status,
                "assigned_sector": drone.assigned_sector,
                "tracking_victim_id": drone.tracking_victim_id,
                "manual_mode": drone.manual_mode,
                "connected": drone.connected
            }
            for drone_id, drone in drones.items()
        }
    }

    return json.dumps(result, indent=2)


@mcp.tool()
async def move_drone(drone_id: str, x: float, y: float) -> str:
    """
    Move a drone to a specific position.

    Validates that the drone has sufficient battery for the journey.
    Sets status to 'moving' during transit.
    """
    drone = drone_manager.get_drone(drone_id)

    if not drone:
        return json.dumps({
            "error": f"Drone {drone_id} not found",
            "available_drones": list(drone_manager.get_all_drones().keys())
        }, indent=2)

    # Validate coordinates
    if not (0 <= x <= 50 and 0 <= y <= 50):
        return json.dumps({
            "error": "Coordinates out of bounds",
            "valid_range": "0-50 for both x and y"
        }, indent=2)

    # Calculate distance
    current_x, _, current_z = drone.position
    distance = calculate_distance(current_x, current_z, x, y)

    # Battery validation (approximate: 0.5% battery per unit of distance)
    battery_needed = distance * 0.5

    if drone.battery < battery_needed + 10:  # Need 10% buffer for safety
        # Initiate return to base instead
        drone.status = "RECALLING"
        await broadcast_drone_state()
        return json.dumps({
            "error": "Insufficient battery for movement",
            "drone_id": drone_id,
            "current_battery": round(drone.battery, 1),
            "battery_needed": round(battery_needed + 10, 1),
            "action": "Drone recalled to base for recharging"
        }, indent=2)

    # Move the drone
    drone.position = [x, 5, y]  # Maintain altitude at 5
    drone.status = "MOVING"

    # Consume battery for movement
    drone.battery = max(0, drone.battery - battery_needed)

    await broadcast_drone_state()

    return json.dumps({
        "success": True,
        "drone_id": drone_id,
        "new_position": {
            "x": round(x, 2),
            "y": 5,
            "z": round(y, 2)
        },
        "distance_traveled": round(distance, 2),
        "battery_consumed": round(battery_needed, 1),
        "remaining_battery": round(drone.battery, 1),
        "status": "MOVING"
    }, indent=2)


@mcp.tool()
async def start_thermal_scan(drone_id: str) -> str:
    """
    Set drone status to scanning and return simulated heat signatures.

    This tool simulates a thermal scan from the drone's current position,
    detecting heat signatures in the surrounding area with confidence scores.
    """
    drone = drone_manager.get_drone(drone_id)

    if not drone:
        return json.dumps({
            "error": f"Drone {drone_id} not found"
        }, indent=2)

    # Set status to scanning
    drone.status = "SCANNING"
    await broadcast_drone_state()

    # Get drone position
    drone_x = drone.position[0]
    drone_z = drone.position[2]

    # Simulate thermal detections based on distance to known victims
    detections = []
    for victim_id, victim_data in SIMULATED_VICTIMS.items():
        distance = calculate_distance(drone_x, drone_z, victim_data["x"], victim_data["z"])

        # Only detect if within range (15 units)
        if distance <= 15:
            # Confidence decreases with distance
            base_confidence = victim_data["confidence"]
            distance_factor = max(0.3, 1 - (distance / 15) * 0.7)
            confidence = base_confidence * distance_factor

            detections.append({
                "victim_id": victim_id,
                "position": {
                    "x": victim_data["x"],
                    "z": victim_data["z"]
                },
                "temperature_f": victim_data["temp"],
                "confidence": round(confidence, 2),
                "distance": round(distance, 2)
            })

    # Sort by confidence
    detections.sort(key=lambda d: d["confidence"], reverse=True)

    return json.dumps({
        "success": True,
        "drone_id": drone_id,
        "scan_position": {
            "x": round(drone_x, 2),
            "z": round(drone_z, 2)
        },
        "detections": detections,
        "total_found": len(detections)
    }, indent=2)


@mcp.tool()
async def verify_target(drone_id: str, target_id: str) -> str:
    """
    Execute a high-accuracy verification scan at a specific location.

    This confirms a survivor's presence with detailed thermal data.
    Returns verified victim information if confirmed.
    """
    drone = drone_manager.get_drone(drone_id)

    if not drone:
        return json.dumps({
            "error": f"Drone {drone_id} not found"
        }, indent=2)

    # Check if target exists
    if target_id not in SIMULATED_VICTIMS:
        return json.dumps({
            "error": f"Target {target_id} not found",
            "available_targets": list(SIMULATED_VICTIMS.keys())
        }, indent=2)

    victim_data = SIMULATED_VICTIMS[target_id]

    # Move drone to verify position (with some random offset for realism)
    drone.position = [victim_data["x"] + random.uniform(-1, 1), 3, victim_data["z"] + random.uniform(-1, 1)]
    drone.status = "TRACKING"
    drone.tracking_victim_id = target_id

    await broadcast_drone_state()

    # Calculate distance
    drone_x, _, drone_z = drone.position
    distance = calculate_distance(drone_x, drone_z, victim_data["x"], victim_data["z"])

    # High accuracy verification (90%+ confidence)
    verification = {
        "verified": True,
        "target_id": target_id,
        "drone_id": drone_id,
        "position": {
            "x": victim_data["x"],
            "z": victim_data["z"]
        },
        "thermal_data": {
            "temperature_f": victim_data["temp"],
            "confidence": round(min(0.99, victim_data["confidence"] + 0.1), 2),
            "verification_status": "CONFIRMED"
        },
        "drone_position": {
            "x": round(drone.position[0], 2),
            "y": round(drone.position[1], 2),
            "z": round(drone.position[2], 2)
        },
        "distance_to_target": round(distance, 2),
        "status": "TRACKING"
    }

    return json.dumps(verification, indent=2)


@mcp.tool()
async def evaluate_fleet_for_task(task_x: float, task_y: float) -> str:
    """
    Evaluate all drones and recommend the most suitable one for a task.

    This helper offloads the math from the LLM by computing:
    - Distance from each drone to the target
    - Battery feasibility (with safety margin)
    - Current availability
    """
    drones = drone_manager.get_all_drones()

    candidates = []

    for drone_id, drone in drones.items():
        # Skip drones that are busy or unavailable
        if drone.status in ["CHARGING", "RECALLING", "TRACKING"]:
            continue

        if drone.battery < 20:
            continue

        # Calculate distance to task
        drone_x, _, drone_z = drone.position
        distance = calculate_distance(drone_x, drone_z, task_x, task_y)
        battery_needed = distance * 0.5

        # Score: higher is better
        # Penalize low battery, reward low distance
        battery_score = drone.battery / 100
        distance_score = max(0, 1 - (distance / 70))  # Max grid diagonal is ~70

        # Only consider if battery is sufficient
        if drone.battery >= battery_needed + 15:
            total_score = (battery_score * 0.4) + (distance_score * 0.6)

            candidates.append({
                "drone_id": drone_id,
                "distance": round(distance, 2),
                "battery_needed": round(battery_needed, 1),
                "current_battery": round(drone.battery, 1),
                "battery_score": round(battery_score, 2),
                "distance_score": round(distance_score, 2),
                "total_score": round(total_score, 2),
                "current_status": drone.status
            })

    if not candidates:
        return json.dumps({
            "error": "No available drones for task",
            "reason": "All drones are either busy, low battery, or too far",
            "task_location": {"x": task_x, "y": task_y}
        }, indent=2)

    # Sort by total score
    candidates.sort(key=lambda c: c["total_score"], reverse=True)
    best = candidates[0]

    return json.dumps({
        "recommended_drone": best["drone_id"],
        "task_location": {"x": task_x, "y": task_y},
        "reasoning": f"Best balance of battery ({best['current_battery']}%) and distance ({best['distance']} units)",
        "evaluation": candidates[:3],  # Top 3 candidates
        "all_candidates": len(candidates)
    }, indent=2)


@mcp.tool()
async def get_world_state() -> str:
    """
    Return a global view of the 2D disaster zone grid.

    Provides:
    - Grid dimensions and cell count
    - Exploration percentage per sector
    - Nearest unexplored grid in each sector
    - Abandoned Sectors (sectors that were being searched but are now unassigned)
    - Known victim/target locations
    - Sector assignments
    """
    grid_summary = drone_manager.get_grid_summary()
    grid_manager = drone_manager.grid_manager

    # Get sector exploration summary
    sector_exploration = grid_manager.get_sector_summary()

    # Get nearest unexplored for each sector
    nearest_unexplored = {}
    for sector in ["A", "B", "C", "D"]:
        # Start search from sector center
        sector_centers = {"A": [12.5, 12.5], "B": [37.5, 12.5], "C": [12.5, 37.5], "D": [37.5, 37.5]}
        center = sector_centers[sector]
        nearest = grid_manager.get_nearest_unexplored(sector, center[0], center[1])
        if nearest:
            nearest_unexplored[sector] = {"x": nearest["x"], "z": nearest["z"], "distance": round(nearest["distance"], 1)}
        else:
            nearest_unexplored[sector] = {"x": None, "z": None, "distance": None, "fully_explored": True}

    # Get currently assigned sectors
    currently_assigned = set()
    for drone in drone_manager.get_all_drones().values():
        if drone.assigned_sector and drone.status == "SEARCHING":
            currently_assigned.add(drone.assigned_sector)

    # Find abandoned sectors (were SEARCHING but now unassigned)
    # We track sectors that were previously assigned but are now without active searchers
    abandoned_sectors = []

    # Check if there are any sectors that had exploration but no current searchers
    all_sectors = {"A", "B", "C", "D"}
    for sector in all_sectors:
        # A sector is considered "abandoned" if:
        # 1. It was previously assigned to a drone that is now RECALLING or IDLE
        # 2. It still has unexplored areas
        for drone in drone_manager.get_all_drones().values():
            if drone.assigned_sector == sector and drone.status in ["RECALLING", "IDLE"]:
                # Check if sector still has unexplored areas
                unexplored = grid_manager.get_all_unexplored_in_sector(sector)
                if len(unexplored) > 0 and sector not in currently_assigned:
                    abandoned_sectors.append(sector)
                    break

    # Get all known victims from GridManager (50x50)
    victims = []
    grid_victims = grid_manager.get_victims()
    for victim_id, victim_data in grid_victims.items():
        victims.append({
            "victim_id": victim_id,
            "grid_position": victim_data["position"],
            "world_position": {
                "x": victim_data["world_x"],
                "z": victim_data["world_z"]
            },
            "danger_level": 0.0  # Not implemented in GridManager yet
        })

    # Get sector assignments
    sector_assignments = {}
    for drone_id, drone in drone_manager.get_all_drones().items():
        if drone.assigned_sector:
            if drone.assigned_sector not in sector_assignments:
                sector_assignments[drone.assigned_sector] = []
            sector_assignments[drone.assigned_sector].append({
                "drone_id": drone_id,
                "status": drone.status,
                "battery": round(drone.battery, 1)
            })

    return json.dumps({
        "grid": {
            "size": drone_manager.GRID_SIZE,
            "cell_size": drone_manager.CELL_SIZE,
            "total_cells": grid_summary["total_cells"],
            "visited_cells": grid_summary["visited_cells"],
            "exploration_percentage": round(grid_summary["visited_percentage"], 1)
        },
        "sector_exploration": {
            sector: {
                "percentage": data["percentage"],
                "explored": data["explored"],
                "total": data["total"]
            }
            for sector, data in sector_exploration.items()
        },
        "nearest_unexplored": nearest_unexplored,
        "abandoned_sectors": abandoned_sectors,
        "victims": victims,
        "sectors": sector_assignments,
        "charging_base": {"x": 0, "z": 0}
    }, indent=2)


@mcp.tool()
async def return_to_base(drone_id: str) -> str:
    """
    Command a drone to return to the charging base at (0,0).

    Sets the drone status to 'recharging' and updates its position.
    Used for low battery recall or end-of-mission procedures.
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

    # Check if enough battery
    battery_needed = distance_to_base * 0.5

    if drone.battery < battery_needed + 5:
        return json.dumps({
            "error": "Insufficient battery to return to base",
            "drone_id": drone_id,
            "current_battery": round(drone.battery, 1),
            "battery_needed": round(battery_needed + 5, 1)
        }, indent=2)

    # Update drone state
    drone.position = [0, 2, 0]  # Lower altitude for charging
    drone.status = "CHARGING"
    drone.tracking_victim_id = None
    drone.battery = max(0, drone.battery - battery_needed)

    await broadcast_drone_state()

    return json.dumps({
        "success": True,
        "drone_id": drone_id,
        "action": "Returning to base",
        "new_position": {"x": 0, "y": 2, "z": 0},
        "status": "CHARGING",
        "distance_traveled": round(distance_to_base, 2),
        "remaining_battery": round(drone.battery, 1)
    }, indent=2)


async def main():
    """Main entry point for the MCP server."""
    global drone_manager

    # Initialize drone manager
    drone_manager = initialize_drone_manager()

    logger.info("Starting AEGIS Drone MCP Server...")
    logger.info("Available tools: discover_drones, get_fleet_status, move_drone, start_thermal_scan, verify_target, evaluate_fleet_for_task, get_world_state, return_to_base")

    # Run the server
    await mcp.run(transport="stdio")


if __name__ == "__main__":
    # Initialize drone manager
    global drone_manager
    drone_manager = initialize_drone_manager()

    logger.info("Starting AEGIS Drone MCP Server...")
    logger.info("Available tools: discover_drones, get_fleet_status, move_drone, start_thermal_scan, verify_target, evaluate_fleet_for_task, get_world_state, return_to_base")

    # Run MCP server directly (not inside asyncio.run since mcp.run manages its own loop)
    mcp.run(transport="stdio")