"""DroneManager class for coordinating fleet operations."""

import logging
from typing import Dict, Optional, List, Any, Tuple, Callable
from dataclasses import dataclass, field

from drone import Drone

logger = logging.getLogger(__name__)

# Type alias for victim discovery callbacks
VictimDiscoveryCallback = Callable[[str, int, int], None]


# Grid state constants
class GridState:
    UNEXPLORED = "UNEXPLORED"
    EXPLORED = "EXPLORED"
    RESERVED = "RESERVED"
    VICTIM = "VICTIM"


def get_sector_id(x: float, z: float) -> str:
    """
    Map coordinates to one of 4 sectors based on 25×25 quadrant layout.

    Sectors:
        A: NW quadrant (x: 0-25, z: 0-25)
        B: NE quadrant (x: 25-50, z: 0-25)
        C: SW quadrant (x: 0-25, z: 25-50)
        D: SE quadrant (x: 25-50, z: 25-50)

    Args:
        x: X coordinate (east-west)
        z: Z coordinate (north-south)

    Returns:
        Sector identifier (A, B, C, or D)
    """
    if x < 25:
        if z < 25:
            return "A"
        else:
            return "C"
    else:
        if z < 25:
            return "B"
        else:
            return "D"


class GridManager:
    """
    Manages the 50×50 disaster zone grid with 2,500 points.
    Tracks exploration state per coordinate and provides sector summaries.
    """

    GRID_SIZE: int = 50  # 50×50 = 2,500 points
    DETECTION_RADIUS: float = 4.0  # Distance at which a drone discovers a victim (matches main.py DETECTION_RANGE)

    def __init__(self):
        """Initialize the grid with all points set to UNEXPLORED."""
        # 2D array: grid[x][z] = state
        self.grid: Dict[Tuple[int, int], str] = {}
        # Secret victims - unknown to the agent until discovered
        self._secret_victims: Dict[Tuple[int, int], str] = {}
        # Discovered victims - visible to the agent
        self._discovered_victims: Dict[Tuple[int, int], str] = {}
        # Callbacks for victim discovery notifications
        self._discovery_callbacks: List[VictimDiscoveryCallback] = []
        self._initialize_grid()

    def _initialize_grid(self) -> None:
        """Initialize all 2,500 grid points to UNEXPLORED."""
        for x in range(self.GRID_SIZE):
            for z in range(self.GRID_SIZE):
                self.grid[(x, z)] = GridState.UNEXPLORED
        logger.info(f"Initialized GridManager with {len(self.grid)} points")

    def get_state(self, x: int, z: int) -> Optional[str]:
        """Get the state of a grid point."""
        if 0 <= x < self.GRID_SIZE and 0 <= z < self.GRID_SIZE:
            return self.grid.get((x, z))
        return None

    def set_state(self, x: int, z: int, state: str) -> bool:
        """Set the state of a grid point."""
        if 0 <= x < self.GRID_SIZE and 0 <= z < self.GRID_SIZE:
            self.grid[(x, z)] = state
            return True
        return False

    def mark_explored(self, x: int, z: int) -> bool:
        """Mark a grid point as EXPLORED."""
        return self.set_state(x, z, GridState.EXPLORED)

    def reserve(self, x: int, z: int, drone_id: str) -> bool:
        """Reserve a grid point for a specific drone."""
        # Store drone_id in a separate reservation map
        if not hasattr(self, '_reservations'):
            self._reservations: Dict[Tuple[int, int], str] = {}
        if self.get_state(x, z) == GridState.UNEXPLORED:
            self._reservations[(x, z)] = drone_id
            return self.set_state(x, z, GridState.RESERVED)
        return False

    def get_reservations(self, drone_id: str) -> List[Tuple[int, int]]:
        """Get all coordinates reserved by a specific drone."""
        if not hasattr(self, '_reservations'):
            return []
        return [
            coord for coord, d_id in self._reservations.items()
            if d_id == drone_id
        ]

    def clear_reservations(self, drone_id: str) -> int:
        """
        Clear all reservations for a drone and reset to UNEXPLORED.

        Args:
            drone_id: The drone ID whose reservations to clear

        Returns:
            Number of reservations cleared
        """
        if not hasattr(self, '_reservations'):
            return 0

        cleared = 0
        to_remove = []
        for coord, d_id in self._reservations.items():
            if d_id == drone_id:
                x, z = coord
                self.set_state(x, z, GridState.UNEXPLORED)
                to_remove.append(coord)
                cleared += 1

        for coord in to_remove:
            del self._reservations[coord]

        if cleared > 0:
            logger.info(f"Cleared {cleared} reservations for {drone_id}")
        return cleared

    def get_sector_summary(self) -> Dict[str, Dict[str, Any]]:
        """
        Get the exploration percentage for each of the 4 sectors.

        Returns:
            Dictionary mapping sector ID to exploration stats
        """
        sector_stats = {
            "A": {"total": 0, "explored": 0, "reserved": 0},
            "B": {"total": 0, "explored": 0, "reserved": 0},
            "C": {"total": 0, "explored": 0, "reserved": 0},
            "D": {"total": 0, "explored": 0, "reserved": 0},
        }

        for (x, z), state in self.grid.items():
            sector = get_sector_id(float(x), float(z))
            sector_stats[sector]["total"] += 1
            if state == GridState.EXPLORED:
                sector_stats[sector]["explored"] += 1
            elif state == GridState.RESERVED:
                sector_stats[sector]["reserved"] += 1

        # Calculate percentages
        summary = {}
        for sector, stats in sector_stats.items():
            total = stats["total"]
            explored = stats["explored"]
            percentage = (explored / total * 100) if total > 0 else 0.0
            summary[sector] = {
                "total": total,
                "explored": explored,
                "reserved": stats["reserved"],
                "percentage": round(percentage, 1)
            }

        return summary

    def add_victim(self, x: float, z: float, victim_id: str) -> bool:
        """Mark a grid point as containing a secret victim (not discovered yet)."""
        cell_x, cell_z = int(x), int(z)
        if 0 <= cell_x < self.GRID_SIZE and 0 <= cell_z < self.GRID_SIZE:
            # Add to secret victims - agent has no knowledge of this
            self._secret_victims[(cell_x, cell_z)] = victim_id
            self.grid[(cell_x, cell_z)] = GridState.VICTIM
            logger.info(f"Secret victim {victim_id} placed at ({cell_x}, {cell_z})")
            return True
        return False

    def remove_victim(self, victim_id: str) -> bool:
        """Remove a victim from the grid (both secret and discovered)."""
        # Check discovered first
        for coord, v_id in list(self._discovered_victims.items()):
            if v_id == victim_id:
                x, z = coord
                del self._discovered_victims[(x, z)]
                self._secret_victims.pop((x, z), None)
                self.set_state(x, z, GridState.EXPLORED)
                logger.info(f"Victim {victim_id} removed from grid (rescued)")
                return True
        # Check secret
        for coord, v_id in list(self._secret_victims.items()):
            if v_id == victim_id:
                x, z = coord
                del self._secret_victims[(x, z)]
                self.set_state(x, z, GridState.UNEXPLORED)
                logger.info(f"Victim {victim_id} removed from grid")
                return True
        return False

    def get_victims(self) -> Dict[str, Dict[str, Any]]:
        """Get all victims in the grid (DEPRECATED - use get_discovered_victims)."""
        # For backward compatibility, return discovered victims
        return self.get_discovered_victims()

    def get_discovered_victims(self) -> Dict[str, Dict[str, Any]]:
        """Get only discovered victims - visible to the agent."""
        victims = {}
        for (x, z), victim_id in self._discovered_victims.items():
            victims[victim_id] = {
                "id": victim_id,
                "position": {"x": x, "z": z},
                "world_x": float(x),
                "world_z": float(z),
                "discovered": True,
            }
        return victims

    def get_secret_victims_count(self) -> int:
        """Get count of undiscovered victims."""
        return len(self._secret_victims)

    def check_and_discover_victims(self, drone_x: float, drone_z: float) -> list:
        """Check if drone is near any secret victims and discover them.

        Returns list of newly discovered victim dicts with id and position.
        Calls all registered discovery callbacks for real-time notifications.
        """
        discovered = []
        drone_cell_x, drone_cell_z = int(drone_x), int(drone_z)

        for (vx, vz), victim_id in list(self._secret_victims.items()):
            # Check if within detection radius (including diagonal cells)
            distance = ((drone_cell_x - vx) ** 2 + (drone_cell_z - vz) ** 2) ** 0.5
            if distance <= self.DETECTION_RADIUS:
                # Move from secret to discovered
                del self._secret_victims[(vx, vz)]
                self._discovered_victims[(vx, vz)] = victim_id
                victim_data = {
                    "id": victim_id,
                    "position": {"x": vx, "z": vz},
                    "world_x": float(vx),
                    "world_z": float(vz),
                    "discovered": True,
                }
                discovered.append(victim_data)
                logger.info(f"DRONE discovered victim {victim_id} at ({vx}, {vz})")

                # Notify all registered callbacks (MCP server can register these)
                for callback in self._discovery_callbacks:
                    try:
                        callback(victim_id, vx, vz)
                    except Exception as e:
                        logger.error(f"Error in victim discovery callback: {e}")

        return discovered

    def register_discovery_callback(self, callback: VictimDiscoveryCallback) -> None:
        """Register a callback to be notified when victims are discovered.

        The callback receives: (victim_id: str, x: int, z: int)
        """
        self._discovery_callbacks.append(callback)
        logger.info(f"Registered victim discovery callback: {callback}")

    def unregister_discovery_callback(self, callback: VictimDiscoveryCallback) -> None:
        """Unregister a discovery callback."""
        if callback in self._discovery_callbacks:
            self._discovery_callbacks.remove(callback)
            logger.info(f"Unregistered victim discovery callback: {callback}")

    def clear_victims(self) -> None:
        """Remove all victims from the grid."""
        self._secret_victims.clear()
        self._discovered_victims.clear()
        # Reset all VICTIM cells to UNEXPLORED
        for (x, z), state in self.grid.items():
            if state == GridState.VICTIM:
                self.grid[(x, z)] = GridState.UNEXPLORED

    def get_nearest_unexplored(self, sector: str, from_x: float = 0, from_z: float = 0) -> Optional[Dict[str, float]]:
        """
        Find the nearest unexplored grid point in a sector.

        Args:
            sector: Sector identifier (A, B, C, or D)
            from_x: Starting X coordinate for distance calculation
            from_z: Starting Z coordinate for distance calculation

        Returns:
            Dict with 'x', 'z', 'distance' or None if sector is fully explored
        """
        # Get sector bounds
        sector_bounds = {
            "A": (0, 25, 0, 25),
            "B": (25, 50, 0, 25),
            "C": (0, 25, 25, 50),
            "D": (25, 50, 25, 50),
        }
        if sector not in sector_bounds:
            return None

        min_x, max_x, min_z, max_z = sector_bounds[sector]

        # Find all unexplored points in sector
        unexplored = []
        for (x, z), state in self.grid.items():
            if state == GridState.UNEXPLORED and min_x <= x < max_x and min_z <= z < max_z:
                # Calculate distance from starting point
                distance = ((x - from_x) ** 2 + (z - from_z) ** 2) ** 0.5
                unexplored.append({"x": x, "z": z, "distance": distance})

        if not unexplored:
            return None

        # Return nearest
        nearest = min(unexplored, key=lambda p: p["distance"])
        return {"x": float(nearest["x"]), "z": float(nearest["z"]), "distance": nearest["distance"]}

    def get_all_unexplored_in_sector(self, sector: str) -> List[Dict[str, int]]:
        """Get all unexplored coordinates in a sector."""
        sector_bounds = {
            "A": (0, 25, 0, 25),
            "B": (25, 50, 0, 25),
            "C": (0, 25, 25, 50),
            "D": (25, 50, 25, 50),
        }
        if sector not in sector_bounds:
            return []

        min_x, max_x, min_z, max_z = sector_bounds[sector]
        unexplored = []
        for (x, z), state in self.grid.items():
            if state == GridState.UNEXPLORED and min_x <= x < max_x and min_z <= z < max_z:
                unexplored.append({"x": x, "z": z})
        return unexplored


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
        self.grid_manager: GridManager = GridManager()  # 2,500 point grid
        self.selected_drone_id: Optional[str] = None
        # Track last searched position per sector (for resuming interrupted searches)
        # Format: {sector_id: {"z": last_z_row, "waypoint_index": last_index, "x_direction": 1 or -1}}
        self._sector_resume_points: Dict[str, Dict[str, Any]] = {}
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
        Create and initialize the drone fleet at charging base (0, 0).

        Returns:
            Dictionary of drone ID -> Drone instances
        """
        base_position: List[float] = [0, 2, 0]  # Charging hub at origin
        self.drones = {
            "DRONE-01": Drone(id="DRONE-01", position=base_position.copy(), battery=95),
            "DRONE-02": Drone(id="DRONE-02", position=base_position.copy(), battery=88),
            "DRONE-03": Drone(id="DRONE-03", position=base_position.copy(), battery=72),
            "DRONE-04": Drone(id="DRONE-04", position=base_position.copy(), battery=65),
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
        """Get the grid cell corresponding to a world position (legacy compatibility)."""
        # Convert to cell coordinates (5x5 unit cells for backward compatibility)
        cell_x = int(x // self.CELL_SIZE)
        cell_z = int(z // self.CELL_SIZE)
        return self.grid_map.get((cell_x, cell_z))

    def mark_cell_visited(self, x: float, z: float) -> None:
        """Mark a grid cell as visited. Now uses GridManager (50x50)."""
        # Use GridManager for 50x50 grid
        cell_x, cell_z = int(x), int(z)
        self.grid_manager.mark_explored(cell_x, cell_z)

    def add_victim(self, x: float, z: float, victim_id: str) -> None:
        """Mark a cell as containing a victim. Now uses GridManager (50x50)."""
        # Use GridManager for 50x50 grid
        self.grid_manager.add_victim(x, z, victim_id)

    def clear_victims(self) -> None:
        """Remove all victims from the grid. Now uses GridManager (50x50)."""
        self.grid_manager.clear_victims()

    def clear_drones(self) -> None:
        """Clear all drones from the fleet."""
        self.drones.clear()

    def remove_victim(self, victim_id: str) -> None:
        """Remove a victim from the grid. Now uses GridManager (50x50)."""
        self.grid_manager.remove_victim(victim_id)

    def set_danger_level(self, x: float, z: float, level: float) -> None:
        """Set the danger level for a grid cell (not implemented in GridManager)."""
        # Danger level not yet implemented in GridManager
        pass

    def get_visited_percentage(self) -> float:
        """Get the percentage of cells visited. Now uses GridManager (50x50)."""
        summary = self.grid_manager.get_sector_summary()
        total_explored = sum(s["explored"] for s in summary.values())
        total_points = sum(s["total"] for s in summary.values())
        return (total_explored / total_points * 100) if total_points > 0 else 0.0

    def get_grid_summary(self) -> Dict[str, Any]:
        """Get a summary of the grid state. Now uses GridManager (50x50)."""
        summary = self.grid_manager.get_sector_summary()
        total_explored = sum(s["explored"] for s in summary.values())
        total_points = sum(s["total"] for s in summary.values())
        total_victims = len(self.grid_manager.get_victims())
        return {
            "total_cells": total_points,  # 2,500 for 50x50
            "visited_cells": total_explored,
            "victim_count": total_victims,
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

        # Get ONLY discovered victims from GridManager (agent has no knowledge of secret ones)
        grid_victims = {}
        discovered_victims = self.grid_manager.get_discovered_victims()
        for victim_id, victim_data in discovered_victims.items():
            grid_victims[victim_id] = {
                "id": victim_id,
                "position": victim_data["position"],
                "danger_level": 0.0  # Not implemented in GridManager yet
            }

        # Note: Agent has NO knowledge of undiscovered victims - they must find them through searching

        # Get sector coverage status
        sector_coverage = self.get_drone_sector_coverage_status()
        uncovered_sectors = self.get_uncovered_sectors()
        fully_searched = self.get_fully_searched_sectors()

        return {
            "grid": {
                "size": self.GRID_SIZE,
                "cell_size": self.CELL_SIZE,
                "explored_percent": round(grid_summary["visited_percentage"], 1)
            },
            "sectors": sectors,
            "sector_coverage": sector_coverage,
            "uncovered_sectors": uncovered_sectors,
            "fully_searched_sectors": list(fully_searched),
            "charging_base": {"x": 0, "z": 0},
            "victims": grid_victims,
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

    def get_sectors_by_distance(self, reverse: bool = True) -> List[Tuple[str, float]]:
        """
        Get all sectors sorted by distance from home base.

        Args:
            reverse: If True (default), sort by distance descending (furthest first).
                    If False, sort by distance ascending (nearest first).

        Returns:
            List of (sector, distance) tuples sorted by distance
        """
        sectors_with_distance = []
        for sector in ["A", "B", "C", "D"]:
            distance = self.calculate_round_trip_distance(sector)
            sectors_with_distance.append((sector, distance))

        # Sort by distance
        sectors_with_distance.sort(key=lambda x: x[1], reverse=reverse)
        return sectors_with_distance

    def get_uncovered_sectors(self) -> List[str]:
        """
        Get list of sectors that:
        1. Have no drone currently assigned/ searching AND
        2. Are not fully searched (explored)

        Returns:
            List of sector IDs that are not covered and not fully searched
        """
        covered_sectors = set()
        for drone in self.drones.values():
            if drone.assigned_sector and drone.status in ["DEPLOYING", "SEARCHING", "TRACKING"]:
                covered_sectors.add(drone.assigned_sector)

        # Get sectors that are fully explored (searched)
        fully_searched = self.get_fully_searched_sectors()

        all_sectors = {"A", "B", "C", "D"}
        # Exclude both covered and fully searched sectors
        uncovered = list(all_sectors - covered_sectors - fully_searched)
        return uncovered

    def get_fully_searched_sectors(self, threshold: float = 95.0) -> set:
        """
        Get sectors that have been fully searched (explored).

        Args:
            threshold: Percentage of grid points that must be explored (default 95%)

        Returns:
            Set of sector IDs that are fully searched
        """
        sector_summary = self.grid_manager.get_sector_summary()
        fully_searched = set()

        for sector, stats in sector_summary.items():
            if stats["percentage"] >= threshold:
                fully_searched.add(sector)

        return fully_searched

    def update_sector_resume_point(self, sector: str, z_row: float, waypoint_index: int = 0, x_direction: int = 1) -> None:
        """
        Store the last search position for a sector when a drone returns early.

        Args:
            sector: Sector ID (A, B, C, or D)
            z_row: The last Z row the drone was searching
            waypoint_index: The last waypoint index
            x_direction: 1 if moving right, -1 if moving left (for next drone)
        """
        self._sector_resume_points[sector] = {
            "z_row": z_row,
            "waypoint_index": waypoint_index,
            "x_direction": x_direction,
            "last_drone_id": None  # Will be set by caller
        }
        logger.info(f"Stored resume point for sector {sector}: z_row={z_row}, waypoint_index={waypoint_index}, direction={x_direction}")

    def get_sector_resume_point(self, sector: str) -> Optional[Dict[str, Any]]:
        """
        Get the resume point for a sector.

        Args:
            sector: Sector ID (A, B, C, or D)

        Returns:
            Dict with z_row, waypoint_index, x_direction or None if no resume point
        """
        return self._sector_resume_points.get(sector)

    def clear_sector_resume_point(self, sector: str) -> None:
        """Clear the resume point for a sector (when search is complete)."""
        if sector in self._sector_resume_points:
            del self._sector_resume_points[sector]
            logger.info(f"Cleared resume point for sector {sector}")

    def get_sector_progress(self) -> Dict[str, Dict[str, Any]]:
        """
        Get progress information for all sectors including exploration percentage and resume points.

        Returns:
            Dict mapping sector ID to progress info (explored %, resume point, etc.)
        """
        sector_summary = self.grid_manager.get_sector_summary()
        progress = {}

        for sector in ["A", "B", "C", "D"]:
            stats = sector_summary.get(sector, {"explored": 0, "total": 625, "percentage": 0.0})
            resume_point = self._sector_resume_points.get(sector)

            progress[sector] = {
                "explored": stats["explored"],
                "total": stats["total"],
                "percentage": stats["percentage"],
                "is_fully_searched": stats["percentage"] >= 95.0,
                "has_resume_point": resume_point is not None,
                "resume_point": resume_point
            }

        return progress

    def get_drone_sector_coverage_status(self) -> Dict[str, bool]:
        """
        Get coverage status for each sector.

        Returns:
            Dict mapping sector ID to bool (True if covered, False otherwise)
        """
        coverage = {sector: False for sector in ["A", "B", "C", "D"]}
        for drone in self.drones.values():
            if drone.assigned_sector and drone.status in ["DEPLOYING", "SEARCHING", "TRACKING"]:
                coverage[drone.assigned_sector] = True
        return coverage

    def optimize_fleet_deployment(self) -> Dict[str, Any]:
        """
        Optimize fleet deployment using greedy matching with safety checks.

        Algorithm:
        1. Analyze fleet - get drone battery levels
        2. Get uncovered sectors
        3. If drones < uncovered sectors: prioritize NEAREST sectors, assign highest
           battery drone to furthest among those nearest sectors
        4. If drones >= uncovered sectors: assign highest battery drones to furthest sectors
        5. Safety check - must have > 40% battery to deploy

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

        # Step 2: Get uncovered sectors (no drone currently searching)
        uncovered_sectors = self.get_uncovered_sectors()

        if not uncovered_sectors:
            return {
                "success": False,
                "message": "All sectors already covered",
                "deployments": [],
                "warnings": ["No uncovered sectors available"],
                "fleet_status": self.get_fleet_status()
            }

        # Step 3: Sort drones by battery (highest first)
        sorted_drones = sorted(available_drones, key=lambda d: -d.battery)

        # Step 4: Determine sector prioritization strategy
        num_drones = len(sorted_drones)
        num_sectors = len(uncovered_sectors)

        if num_drones < num_sectors:
            # When drones < sectors: prioritize NEAREST sectors
            # Get sectors sorted by distance ascending (nearest first)
            sectors_by_distance = self.get_sectors_by_distance(reverse=False)
            # Filter to only uncovered sectors and take nearest ones
            sector_candidates = [s for s in sectors_by_distance if s[0] in uncovered_sectors][:num_drones]
            # Among nearest sectors, assign highest battery drone to furthest of those nearest
            sector_candidates.sort(key=lambda x: -x[1])  # Furthest of nearest first
        else:
            # When drones >= sectors: assign to furthest sectors
            sectors_by_distance = self.get_sectors_by_distance(reverse=True)
            sector_candidates = [s for s in sectors_by_distance if s[0] in uncovered_sectors]

        # Step 5: Greedy matching - highest battery drone to selected sector
        deployments = []
        warnings = []

        for drone in sorted_drones:
            # Find an available sector from candidates
            assigned = False
            for sector, distance in sector_candidates:
                # Check if this sector is already assigned in our deployment plan
                if any(d["sector"] == sector for d in deployments):
                    continue

                # Battery check - must have > 40% to deploy
                if drone.battery > 40:
                    deployments.append({
                        "drone_id": drone.id,
                        "sector": sector,
                        "round_trip_distance": round(distance, 1),
                        "battery": round(drone.battery, 1),
                        "safe": True,
                        "strategy": "nearest_first" if num_drones < num_sectors else "furthest_first"
                    })
                    assigned = True
                    break

            if not assigned:
                warnings.append(
                    f"{drone.id}: No suitable sector available - battery too low"
                )

        # Determine if deployment was successful
        successful_deployments = [d for d in deployments if d["safe"]]

        strategy_note = "nearest sectors (drones < sectors)" if num_drones < num_sectors else "furthest sectors"

        return {
            "success": len(successful_deployments) > 0,
            "message": f"Deployed {len(successful_deployments)} drones to {strategy_note}",
            "deployments": successful_deployments,
            "warnings": warnings,
            "fleet_status": self.get_fleet_status(),
            "strategy": strategy_note
        }

    def check_and_dispatch_to_uncovered(self, completed_drone_id: str) -> Optional[Dict[str, Any]]:
        """
        Check if a drone has completed its sector and dispatch to uncovered sector if available.

        Called when a drone finishes covering its assigned sector and returns to base.

        Args:
            completed_drone_id: The ID of the drone that completed its sector

        Returns:
            Deployment dict if dispatched, None if no action taken
        """
        drone = self.get_drone(completed_drone_id)
        if not drone:
            return None

        # Check if drone has enough battery (> 40% required for new deployment)
        if drone.battery <= 40:
            logger.info(f"{completed_drone_id} has insufficient battery ({drone.battery}%) for new deployment")
            return None

        # Get uncovered sectors
        uncovered = self.get_uncovered_sectors()
        if not uncovered:
            logger.info(f"No uncovered sectors available for {completed_drone_id}")
            return None

        # Sort uncovered sectors by distance
        sectors_by_distance = self.get_sectors_by_distance(reverse=False)
        sector_candidates = [s for s in sectors_by_distance if s[0] in uncovered]

        if not sector_candidates:
            return None

        # Pick the nearest uncovered sector
        sector, distance = sector_candidates[0]

        # Deploy the drone to the nearest uncovered sector
        drone.assigned_sector = sector
        drone.status = "DEPLOYING"

        deployment = {
            "drone_id": drone.id,
            "sector": sector,
            "round_trip_distance": round(distance, 1),
            "battery": round(drone.battery, 1),
            "safe": True,
            "reason": "completed_sector"
        }

        logger.info(f"Dispatched {completed_drone_id} to nearest uncovered sector {sector}")
        return deployment

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
            # Hand-off hook: Clear any RESERVED coordinates for this drone
            cleared_count = self.grid_manager.clear_reservations(drone_id)
            if cleared_count > 0:
                logger.info(
                    f"Hand-off: Cleared {cleared_count} RESERVED points for {drone_id}"
                )

            drone.status = "RECALLING"
            drone.assigned_sector = None
            logger.info(f"Commanded {drone_id} to return to base")
            return True
        return False
