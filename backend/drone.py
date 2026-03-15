"""Drone class for manual control simulation."""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List


@dataclass
class Drone:
    """Represents a drone with position, status, and control capabilities."""

    id: str
    position: List[float] = field(default_factory=lambda: [0, 2, 0])
    status: str = "IDLE"
    battery: float = 100.0
    connected: bool = True
    assigned_sector: Optional[str] = None
    tracking_victim_id: Optional[str] = None
    manual_mode: bool = False
    last_key_pressed: Optional[str] = None

    # Movement bounds
    MIN_X: float = 0
    MAX_X: float = 50
    MIN_Z: float = 0
    MAX_Z: float = 50
    MIN_Y: float = 2
    MAX_Y: float = 20
    MOVE_SPEED: float = 0.5

    def move(self, direction: str) -> None:
        """
        Move the drone in the specified direction.
        Direction: 'up' (north/-Z), 'down' (south/+Z), 'left' (west/-X), 'right' (east/+X),
                  'up_alt' (altitude+/W), 'down_alt' (altitude-/S)
        """
        x, y, z = self.position

        if direction == "up":
            z = max(self.MIN_Z, z - self.MOVE_SPEED)
        elif direction == "down":
            z = min(self.MAX_Z, z + self.MOVE_SPEED)
        elif direction == "left":
            x = max(self.MIN_X, x - self.MOVE_SPEED)
        elif direction == "right":
            x = min(self.MAX_X, x + self.MOVE_SPEED)
        elif direction == "up_alt":
            y = min(self.MAX_Y, y + self.MOVE_SPEED)
        elif direction == "down_alt":
            y = max(self.MIN_Y, y - self.MOVE_SPEED)

        self.position = [x, y, z]

    def enter_manual_mode(self) -> None:
        """Enter manual control mode."""
        if not self.manual_mode:
            self.manual_mode = True
            self.status = "MANUAL"
            self.last_key_pressed = None

    def exit_manual_mode(self) -> None:
        """Exit manual control mode and return to autonomous behavior."""
        self.manual_mode = False
        self.last_key_pressed = None
        # Default to IDLE if no sector assigned, will be overridden by main.py
        if self.assigned_sector:
            self.status = "SEARCHING"
        else:
            self.status = "IDLE"

    def get_state(self) -> Dict[str, Any]:
        """Return the current state of the drone."""
        return {
            "id": self.id,
            "position": self.position,
            "status": self.status,
            "battery": self.battery,
            "connected": self.connected,
            "assignedSector": self.assigned_sector,
            "trackingVictimId": self.tracking_victim_id,
            "manualMode": self.manual_mode,
            "lastKeyPressed": self.last_key_pressed,
        }

    def update_from_dict(self, data: Dict[str, Any]) -> None:
        """Update drone state from a dictionary (from frontend)."""
        if "position" in data:
            self.position = data["position"]
        if "status" in data:
            self.status = data["status"]
        if "battery" in data:
            self.battery = data["battery"]
        if "assignedSector" in data:
            self.assigned_sector = data["assignedSector"]
        if "trackingVictimId" in data:
            self.tracking_victim_id = data["trackingVictimId"]
        if "manualMode" in data:
            self.manual_mode = data["manualMode"]
        if "lastKeyPressed" in data:
            self.last_key_pressed = data["lastKeyPressed"]
