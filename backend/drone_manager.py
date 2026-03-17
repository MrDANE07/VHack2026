"""DroneManager class for coordinating fleet operations."""

import logging
from typing import Dict, Optional, List, Any, Tuple
from dataclasses import dataclass, field

from drone import Drone

logger = logging.getLogger(__name__)


@dataclass
class GridCell:
    """Represents a cell in the disaster zone grid."""
    x: int
    z: int
    visited: bool = False
    has_victim: bool = False
    victim_id: Optional[str] = None
    danger_level: float = 0.0  # 0.0 to 1.0


class DroneManager:
    """Manages a fleet of drones and the disaster zone grid."""

    GRID_SIZE: int = 50
    CELL_SIZE: int = 5  # Each cell is 5x5 units
    SECTOR_SIZE: int = 25  # Each sector is 25x25 units

    def __init__(self):
        """Initialize the DroneManager with an empty fleet and grid."""
        self.drones: Dict[str, Drone] = {}
        self.grid_map: Dict[Tuple[int, int], GridCell] = {}
        self.selected_drone_id: Optional[str] = None
        self._initialize_grid()

    def _initialize_grid(self) -> None:
        """Initialize the grid map for the disaster zone."""
        num_cells = self.GRID_SIZE // self.CELL_SIZE
        for x in range(num_cells):
            for z in range(num_cells):
                self.grid_map[(x, z)] = GridCell(x=x, z=z)
        logger.info(f"Initialized grid map: {num_cells}x{num_cells} cells")

    def initialize_fleet(self) -> Dict[str, Drone]:
        """
        Create and initialize the drone fleet.

        Returns:
            Dictionary of drone ID -> Drone instances
        """
        self.drones = {
            "DRONE-01": Drone(
                id="DRONE-01",
                position=[12.5, 5, 12.5],
                status="SEARCHING",
                battery=95,
                assigned_sector="A"
            ),
            "DRONE-02": Drone(
                id="DRONE-02",
                position=[37.5, 5, 12.5],
                status="SEARCHING",
                battery=88,
                assigned_sector="B"
            ),
            "DRONE-03": Drone(
                id="DRONE-03",
                position=[12.5, 5, 37.5],
                status="SEARCHING",
                battery=72,
                assigned_sector="C"
            ),
            "DRONE-04": Drone(
                id="DRONE-04",
                position=[37.5, 5, 37.5],
                status="SEARCHING",
                battery=65,
                assigned_sector="D"
            ),
        }
        logger.info(f"Initialized fleet with {len(self.drones)} drones")
        return self.drones

    def get_drone(self, drone_id: str) -> Optional[Drone]:
        """Get a drone by ID."""
        return self.drones.get(drone_id)

    def get_all_drones(self) -> Dict[str, Drone]:
        """Get all drones in the fleet."""
        return self.drones

    def get_drone_states(self) -> Dict[str, Dict[str, Any]]:
        """Get states of all drones."""
        return {
            drone_id: drone.get_state()
            for drone_id, drone in self.drones.items()
        }

    def select_drone(self, drone_id: str) -> bool:
        """Select a drone for manual control."""
        if drone_id in self.drones:
            self.selected_drone_id = drone_id
            logger.info(f"Selected drone: {drone_id}")
            return True
        return False

    def get_selected_drone(self) -> Optional[Drone]:
        """Get the currently selected drone."""
        if self.selected_drone_id:
            return self.drones.get(self.selected_drone_id)
        return None

    def get_sector_bounds(self, sector: str) -> Tuple[float, float, float, float]:
        """
        Get the bounds (min_x, max_x, min_z, max_z) for a sector.

        Sectors:
            A: NW quadrant (x: 0-25, z: 0-25)
            B: NE quadrant (x: 25-50, z: 0-25)
            C: SW quadrant (x: 0-25, z: 25-50)
            D: SE quadrant (x: 25-50, z: 25-50)
        """
        sector_bounds = {
            "A": (0, 25, 0, 25),
            "B": (25, 50, 0, 25),
            "C": (0, 25, 25, 50),
            "D": (25, 50, 25, 50),
        }
        return sector_bounds.get(sector, (0, 50, 0, 50))

    def get_drones_in_sector(self, sector: str) -> List[Drone]:
        """Get all drones assigned to a specific sector."""
        return [
            drone for drone in self.drones.values()
            if drone.assigned_sector == sector
        ]

    def get_drones_by_status(self, status: str) -> List[Drone]:
        """Get all drones with a specific status."""
        return [
            drone for drone in self.drones.values()
            if drone.status == status
        ]

    def get_available_drones(self) -> List[Drone]:
        """Get drones that are available for assignment (battery > 40%)."""
        return [
            drone for drone in self.drones.values()
            if drone.battery > 40 and drone.status not in ["CHARGING", "RECALLING"]
        ]

    def get_low_battery_drones(self) -> List[Drone]:
        """Get drones with low battery (< 20%)."""
        return [
            drone for drone in self.drones.values()
            if drone.battery < 20
        ]

    def get_cell_from_position(self, x: float, z: float) -> Optional[GridCell]:
        """Get the grid cell corresponding to a world position."""
        cell_x = int(x // self.CELL_SIZE)
        cell_z = int(z // self.CELL_SIZE)
        return self.grid_map.get((cell_x, cell_z))

    def mark_cell_visited(self, x: float, z: float) -> None:
        """Mark a grid cell as visited."""
        cell = self.get_cell_from_position(x, z)
        if cell:
            cell.visited = True

    def add_victim(self, x: float, z: float, victim_id: str) -> None:
        """Mark a cell as containing a victim."""
        cell = self.get_cell_from_position(x, z)
        if cell:
            cell.has_victim = True
            cell.victim_id = victim_id

    def remove_victim(self, victim_id: str) -> None:
        """Remove a victim from the grid."""
        for cell in self.grid_map.values():
            if cell.victim_id == victim_id:
                cell.has_victim = False
                cell.victim_id = None
                logger.info(f"Victim {victim_id} removed from grid")
                break

    def set_danger_level(self, x: float, z: float, level: float) -> None:
        """Set the danger level for a grid cell."""
        cell = self.get_cell_from_position(x, z)
        if cell:
            cell.danger_level = max(0.0, min(1.0, level))

    def get_visited_percentage(self) -> float:
        """Get the percentage of cells visited."""
        if not self.grid_map:
            return 0.0
        visited = sum(1 for cell in self.grid_map.values() if cell.visited)
        return (visited / len(self.grid_map)) * 100

    def get_grid_summary(self) -> Dict[str, Any]:
        """Get a summary of the grid state."""
        return {
            "total_cells": len(self.grid_map),
            "visited_cells": sum(1 for c in self.grid_map.values() if c.visited),
            "victim_count": sum(1 for c in self.grid_map.values() if c.has_victim),
            "visited_percentage": self.get_visited_percentage(),
        }

    def get_world_summary(self) -> Dict[str, Any]:
        """Get a comprehensive world state summary for the agent."""
        grid_summary = self.get_grid_summary()

        # Get sector assignments
        sectors = {}
        for drone_id, drone in self.drones.items():
            if drone.assigned_sector:
                if drone.assigned_sector not in sectors:
                    sectors[drone.assigned_sector] = []
                sectors[drone.assigned_sector].append({
                    "drone_id": drone_id,
                    "status": drone.status,
                    "battery": round(drone.battery, 1),
                    "position": {
                        "x": round(drone.position[0], 1),
                        "z": round(drone.position[2], 1)
                    }
                })

        return {
            "grid": {
                "size": self.GRID_SIZE,
                "cell_size": self.CELL_SIZE,
                "explored_percent": round(grid_summary["visited_percentage"], 1)
            },
            "sectors": sectors,
            "charging_base": {"x": 0, "z": 0},
            "drones": {
                drone_id: {
                    "id": drone.id,
                    "status": drone.status,
                    "battery": round(drone.battery, 1),
                    "position": {
                        "x": round(drone.position[0], 1),
                        "y": round(drone.position[1], 1),
                        "z": round(drone.position[2], 1)
                    },
                    "assigned_sector": drone.assigned_sector
                }
                for drone_id, drone in self.drones.items()
            }
        }

    def assign_sector(self, drone_id: str, sector: str) -> bool:
        """Assign a drone to a sector."""
        drone = self.get_drone(drone_id)
        if drone and sector in ["A", "B", "C", "D"]:
            drone.assigned_sector = sector
            logger.info(f"Drone {drone_id} assigned to sector {sector}")
            return True
        return False

    def update_battery(self, drone_id: str, amount: float) -> None:
        """Update a drone's battery level."""
        drone = self.get_drone(drone_id)
        if drone:
            drone.battery = max(0, min(100, drone.battery + amount))

    def update_drone_status(self, drone_id: str, status: str) -> None:
        """Update a drone's status."""
        drone = self.get_drone(drone_id)
        if drone:
            drone.status = status
            logger.info(f"Drone {drone_id} status updated to {status}")

    def calculate_round_trip_distance(self, sector: str) -> float:
        """
        Calculate round-trip distance from home base (0,0) to a sector center and back.

        Args:
            sector: Sector identifier (A, B, C, or D)

        Returns:
            Round-trip distance in world units
        """
        # Sector center positions from main.py
        sector_centers = {
            "A": [12.5, 12.5],
            "B": [37.5, 12.5],
            "C": [12.5, 37.5],
            "D": [37.5, 37.5],
        }

        if sector not in sector_centers:
            logger.warning(f"Unknown sector: {sector}")
            return float('inf')

        center = sector_centers[sector]
        # Distance from home base (0,0) to sector center
        distance_to_sector = (center[0] ** 2 + center[1] ** 2) ** 0.5
        # Round-trip = to sector + back to base
        round_trip = distance_to_sector * 2

        logger.info(f"Sector {sector}: one-way={distance_to_sector:.1f}, round-trip={round_trip:.1f}")
        return round_trip

    def get_fleet_status(self) -> Dict[str, Dict[str, Any]]:
        """
        Get the battery status of all drones in the fleet.

        Returns:
            Dictionary mapping drone_id to battery and status info
        """
        return {
            drone_id: {
                "id": drone.id,
                "battery": round(drone.battery, 1),
                "status": drone.status,
                "assigned_sector": drone.assigned_sector,
                "position": {
                    "x": round(drone.position[0], 1),
                    "z": round(drone.position[2], 1)
                }
            }
            for drone_id, drone in self.drones.items()
        }

    def get_sectors_by_distance(self) -> List[Tuple[str, float]]:
        """
        Get all sectors sorted by distance from home base (furthest first).

        Returns:
            List of (sector, distance) tuples sorted by distance (descending)
        """
        sectors_with_distance = []
        for sector in ["A", "B", "C", "D"]:
            distance = self.calculate_round_trip_distance(sector)
            sectors_with_distance.append((sector, distance))

        # Sort by distance descending (furthest first)
        sectors_with_distance.sort(key=lambda x: -x[1])
        return sectors_with_distance

    def optimize_fleet_deployment(self) -> Dict[str, Any]:
        """
        Optimize fleet deployment using greedy matching with safety checks.

        Algorithm:
        1. Analyze fleet - get drone battery levels
        2. Calculate distance - find sectors furthest from home base
        3. Greedy matching - sort drones by battery (highest), sectors by distance (furthest)
        4. Safety check - if round-trip > 80% of battery capacity, do NOT dispatch

        Returns:
            Dictionary with deployment plan and any safety warnings
        """
        # Step 1: Get available drones (battery > 40% and not charging/recalling)
        available_drones = self.get_available_drones()

        if not available_drones:
            return {
                "success": False,
                "message": "No drones available for deployment",
                "deployments": [],
                "warnings": ["All drones are charging or have insufficient battery"]
            }

        # Step 2: Sort drones by battery (highest first)
        sorted_drones = sorted(available_drones, key=lambda d: -d.battery)

        # Step 3: Get sectors sorted by distance (furthest first)
        sectors_by_distance = self.get_sectors_by_distance()

        # Step 4: Greedy matching with safety check
        deployments = []
        warnings = []

        for drone in sorted_drones:
            # Calculate available battery capacity (80% of current battery)
            battery_capacity = drone.battery * 0.8

            # Find a suitable sector
            assigned = False
            for sector, distance in sectors_by_distance:
                # Check if this sector is already assigned
                if any(d["sector"] == sector for d in deployments):
                    continue

                # Safety check: can drone make round trip?
                if distance <= battery_capacity:
                    deployments.append({
                        "drone_id": drone.id,
                        "sector": sector,
                        "round_trip_distance": round(distance, 1),
                        "battery": round(drone.battery, 1),
                        "battery_capacity_80": round(battery_capacity, 1),
                        "safe": True
                    })
                    assigned = True
                    break
                else:
                    # Sector too far for this drone
                    warnings.append(
                        f"{drone.id}: Cannot deploy to Sector {sector} - "
                        f"round-trip {distance:.1f} exceeds 80% battery capacity ({battery_capacity:.1f})"
                    )

            if not assigned:
                warnings.append(
                    f"{drone.id}: No suitable sector available - remaining sectors too far"
                )

        # Determine if deployment was successful
        successful_deployments = [d for d in deployments if d["safe"]]

        return {
            "success": len(successful_deployments) > 0,
            "message": f"Deployed {len(successful_deployments)} drones successfully",
            "deployments": successful_deployments,
            "warnings": warnings,
            "fleet_status": self.get_fleet_status()
        }

    def command_return_to_base(self, drone_id: str) -> bool:
        """
        Command a drone to return to base for charging.

        Args:
            drone_id: The ID of the drone to recall

        Returns:
            True if command was successful, False otherwise
        """
        drone = self.get_drone(drone_id)
        if drone:
            drone.status = "RECALLING"
            drone.assigned_sector = None
            logger.info(f"Commanded {drone_id} to return to base")
            return True
        return False
