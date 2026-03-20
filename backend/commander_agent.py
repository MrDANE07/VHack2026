"""Commander Agent using PydanticAI for structured drone mission control."""

import os
import sys
import json
import logging
import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# Ensure API key is available in environment for pydantic_ai
os.environ.setdefault('OPENROUTER_API_KEY', os.getenv('OPENROUTER_API_KEY', ''))

from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.mcp import MCPServerStdio
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse

from drone_manager import DroneManager

logger = logging.getLogger(__name__)

# OpenRouter configuration - use openrouter: prefix for pydantic_ai
_raw_model = os.getenv("OPENROUTER_MODEL", "anthropic/claude-3.5-sonnet")
OPENROUTER_MODEL = f"openrouter:{_raw_model}" if not _raw_model.startswith("openrouter:") else _raw_model


class MissionThought(BaseModel):
    """Structured output for the Commander Agent's decision-making process."""

    internal_monologue: str = Field(
        description="Chain-of-thought reasoning about the current mission state and options"
    )
    battery_analysis: str = Field(
        description="Analysis of battery constraints and feasibility of proposed actions"
    )
    chosen_action: str = Field(
        description="The specific action to take: move_drone, thermal_scan, verify_target, "
        "return_to_base, deploy_to_sector, evaluate_fleet, or wait"
    )
    target_drone_id: Optional[str] = Field(
        description="The ID of the drone to control (e.g., 'drone-1', 'drone-2')"
    )
    target_x: Optional[float] = Field(
        description="Target X coordinate for move_drone action (0-50)"
    )
    target_z: Optional[float] = Field(
        description="Target Z coordinate for move_drone action (0-50)"
    )
    target_sector: Optional[str] = Field(
        description="Target sector for deploy_to_sector (A, B, C, or D)"
    )
    risk_score: float = Field(
        description="Risk assessment from 0.0 (safe) to 1.0 (critical), considering battery, "
        "victims, and mission urgency",
        ge=0.0,
        le=1.0
    )


@dataclass
class DroneDeps:
    """Dependency injection class for the Commander Agent.

    Holds the DroneManager instance and any other dependencies
    needed for the agent to interact with the drone fleet.
    """

    drone_manager: DroneManager


@dataclass
class AgentResult:
    """Result from the agent including output and tool calls."""
    output: MissionThought
    tool_calls: list = field(default_factory=list)


# Base system prompt that emphasizes battery analysis
BASE_SYSTEM_PROMPT = """You are the AEGIS Swarm Commander Agent, responsible for coordinating
autonomous drone search-and-rescue operations in a disaster zone.

CRITICAL RULE: You MUST always analyze battery constraints BEFORE issuing any tool calls.

Before every action, you must:
1. Check the battery level of any drone you intend to use
2. Calculate if there's sufficient battery for the action plus a 15% safety margin
3. If battery is insufficient (< 20%), prioritize returning the drone to base

When a victim is detected:
1. Acknowledge the detection in your reasoning
2. Note that human approval is required for rescue dispatch
3. Coordinate other drones to continue searching remaining sectors while waiting
4. Monitor battery levels of tracking drones

IMPORTANT: Every tool call result is automatically broadcasted to the frontend in real-time.
You don't need to explicitly notify the frontend - the system handles that. Your focus should
be on making good tactical decisions.

Your goal is to maximize victim detection while ensuring no drone is stranded
due to battery depletion. Coordinate the fleet strategically.

OUTPUT FORMAT - When you respond, you MUST provide:
- chosen_action: The action to take (move_drone, thermal_scan, return_to_base, deploy_to_sector, evaluate_fleet, or wait)
- target_drone_id: The drone ID to control (e.g., "drone-1", "drone-2")
- target_x: X coordinate (0-50) for move_drone action
- target_z: Z coordinate (0-50) for move_drone action
- target_sector: Sector (A, B, C, or D) for deploy_to_sector action
- internal_monologue: Your reasoning
- battery_analysis: Battery feasibility analysis
- risk_score: Risk from 0.0 to 1.0

Available drone IDs: drone-1, drone-2, drone-3, drone-4 (check actual available drones from fleet status)"""


# Configure MCP server to connect to backend/mcp_server.py
mcp_server = MCPServerStdio(
    command=sys.executable,
    args=["mcp_server.py"],
    cwd=os.path.dirname(os.path.abspath(__file__)),
)


# Create the PydanticAI agent with OpenRouter and MCP server
# Uses openrouter: prefix for model and reads API key from environment
commander_agent: Agent[DroneDeps, MissionThought] = Agent(
    model=OPENROUTER_MODEL,
    system_prompt="",  # Will be set dynamically via decorator
    output_type=MissionThought,
    toolsets=[mcp_server],
)


@commander_agent.system_prompt
async def get_dynamic_system_prompt(ctx: RunContext[DroneDeps]) -> str:
    """Dynamic system prompt that includes current world state."""
    world_state = ctx.deps.drone_manager.get_world_summary()

    # Get victim info - only discovered victims are visible (agent has no knowledge of undiscovered ones)
    victims = world_state.get('victims', {})
    discovered_count = len(victims)

    world_summary = f"""Current World State:
- Grid: {world_state['grid']['size']}x{world_state['grid']['size']}, {world_state['grid']['explored_percent']}% explored
- Discovered victims: {discovered_count}
  {json.dumps(victims, indent=2) if discovered_count > 0 else 'None detected - keep searching!'}
- Charging base: ({world_state['charging_base']['x']}, {world_state['charging_base']['z']})

Fleet Status:
{json.dumps({k: v for k, v in world_state['drones'].items()}, indent=2)}

Sectors:
{json.dumps(world_state['sectors'], indent=2) if world_state['sectors'] else 'Not assigned'}"""

    return f"{BASE_SYSTEM_PROMPT}\n\n{world_summary}"


async def get_fleet_overview(deps: DroneDeps) -> str:
    """Helper to get a summary of the drone fleet."""
    drones = deps.drone_manager.get_all_drones()

    available = deps.drone_manager.get_available_drones()
    low_battery = deps.drone_manager.get_low_battery_drones()

    overview = {
        "total_drones": len(drones),
        "available": len(available),
        "low_battery": len(low_battery),
        "drones": [
            {
                "id": d.id,
                "status": d.status,
                "battery": round(d.battery, 1),
                "position": {
                    "x": round(d.position[0], 1),
                    "z": round(d.position[2], 1)
                },
                "assigned_sector": d.assigned_sector
            }
            for d in drones.values()
        ]
    }

    return json.dumps(overview, indent=2)


async def analyze_battery_for_task(
    deps: DroneDeps,
    drone_id: str,
    target_x: float,
    target_z: float
) -> dict:
    """Analyze battery feasibility for a task.

    Returns a dict with analysis results.
    """
    drone = deps.drone_manager.get_drone(drone_id)

    if not drone:
        return {
            "feasible": False,
            "reason": f"Drone {drone_id} not found"
        }

    # Calculate distance
    current_x, _, current_z = drone.position
    distance = ((target_x - current_x) ** 2 + (target_z - current_z) ** 2) ** 0.5

    # Battery needed (0.5% per unit)
    battery_needed = distance * 0.5
    safety_margin = 15.0
    total_needed = battery_needed + safety_margin

    return {
        "feasible": drone.battery >= total_needed,
        "drone_id": drone_id,
        "current_battery": round(drone.battery, 1),
        "battery_needed": round(battery_needed, 1),
        "safety_margin": safety_margin,
        "total_needed": round(total_needed, 1),
        "distance": round(distance, 1),
        "recommendation": "safe to proceed" if drone.battery >= total_needed else "return to base"
    }


async def get_actionable_recommendation(deps: DroneDeps, context: str) -> AgentResult:
    """Get a mission recommendation from the agent.

    Args:
        deps: The drone dependencies
        context: Current mission context/situation

    Returns:
        AgentResult with the agent's reasoning, action, and tool calls
    """
    fleet_info = await get_fleet_overview(deps)

    prompt = f"""Current situation: {context}

Fleet status:
{fleet_info}

Analyze the situation and provide your recommendation. Always prioritize battery safety."""

    result = await commander_agent.run(prompt, deps=deps)

    # Extract tool calls from the message history
    tool_calls = []
    try:
        for msg in result.new_messages():
            # Check for tool request messages
            if hasattr(msg, 'parts'):
                for part in msg.parts:
                    if hasattr(part, 'tool_name') and part.tool_name:
                        tool_calls.append({
                            "tool": part.tool_name,
                            "args": str(part.args) if hasattr(part, 'args') else "",
                            "result": str(part.result) if hasattr(part, 'result') else ""
                        })
    except Exception as e:
        logger.warning(f"Could not extract tool calls: {e}")

    return AgentResult(output=result.output, tool_calls=tool_calls)


# Persistent message history for the agent
message_history: list = []

# Mission history file for auditing
MISSION_HISTORY_FILE = Path(__file__).parent / "mission_history.json"


def load_mission_history() -> list:
    """Load existing mission history from JSON file."""
    if MISSION_HISTORY_FILE.exists():
        try:
            with open(MISSION_HISTORY_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return []
    return []


def save_mission_history(history: list) -> None:
    """Save mission history to JSON file."""
    with open(MISSION_HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)


def append_to_mission_log(mission_thought: MissionThought, user_input: str) -> None:
    """Append a MissionThought entry to the mission history JSON file."""
    history = load_mission_history()

    entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "user_input": user_input,
        "internal_monologue": mission_thought.internal_monologue,
        "battery_analysis": mission_thought.battery_analysis,
        "chosen_action": mission_thought.chosen_action,
        "risk_score": mission_thought.risk_score,
    }

    history.append(entry)
    save_mission_history(history)
    print(f"\n[+] Mission log entry saved to {MISSION_HISTORY_FILE}")


async def run_mission_loop():
    """Stateful asynchronous execution loop for continuous search-and-rescue missions.

    This loop:
    - Initializes DroneManager and wraps it in DroneDeps
    - Maintains persistent message_history across all turns
    - Accepts natural language mission goals from the user
    - Exits gracefully on 'quit' command
    """
    # Initialize DroneManager and wrap in DroneDeps
    dm = DroneManager()
    dm.initialize_fleet()

    deps = DroneDeps(drone_manager=dm)

    # Persistent message history - updated after every agent turn
    message_history.clear()

    print("=" * 60)
    print("AEGIS SWARM COMMANDER - Search & Rescue Mission Control")
    print("=" * 60)
    print("Enter natural language mission goals.")
    print("Available commands: quit - exit the mission loop")
    print("-" * 60)

    while True:
        try:
            # Capture natural language mission goal from user
            try:
                import aioconsole
                user_input = await aioconsole.ainput("\n[Mission Command] > ")
            except ImportError:
                # Fallback to standard input
                user_input = input("\n[Mission Command] > ")

            user_input = user_input.strip()

            # Check for quit command
            if user_input.lower() in ["quit", "exit", "q"]:
                print("\n[!] Ending mission. Saving state...")
                print(f"[+] Total conversation turns: {len(message_history) // 2}")
                print("Mission ended.")
                break

            if not user_input:
                continue

            # Get fleet overview for context
            fleet_info = await get_fleet_overview(deps)

            # Build prompt with conversation history
            prompt = f"""{user_input}

Fleet Status:
{fleet_info}

Analyze the current situation and provide your recommendation. Always prioritize battery safety.
Output your reasoning, battery analysis, chosen action, and risk score."""

            # Run the agent with message_history for context
            result = await commander_agent.run(
                prompt,
                deps=deps,
                message_history=message_history
            )

            # Update message_history with result.new_messages()
            message_history = list(result.new_messages())

            # Display formatted Mission Log
            print("\n" + "=" * 50)
            print(" MISSION LOG - " + datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S") + " UTC")
            print("=" * 50)
            print(f"\n>>> USER: {user_input}")
            print(f"\n--- INTERNAL MONOLOGUE ---\n{result.output.internal_monologue}")
            print(f"\n--- BATTERY ANALYSIS ---\n{result.output.battery_analysis}")
            print(f"\n>>> CHOSEN ACTION: {result.output.chosen_action}")
            print(f">>> RISK SCORE: {result.output.risk_score:.2f}")

            # Persist to mission_history.json
            append_to_mission_log(result.output, user_input)

        except KeyboardInterrupt:
            print("\n\n[!] Interrupted. Saving state...")
            print(f"[+] Total conversation turns: {len(message_history)}")
            break
        except Exception as e:
            print(f"\n[!] Error: {e}")
            logger.exception("Error in mission loop")
            continue


# Example usage and testing
if __name__ == "__main__":
    import asyncio

    async def test_agent():
        """Test the commander agent with a mock scenario."""
        # Initialize the drone manager
        dm = DroneManager()
        dm.initialize_fleet()

        deps = DroneDeps(drone_manager=dm)

        # Test getting a recommendation
        result = await get_actionable_recommendation(
            deps,
            "Multiple thermal signatures detected in sector A. Need to verify and track victims."
        )

        print("=== Commander Agent Recommendation ===")
        print(f"Internal Monologue:\n{result.internal_monologue}")
        print(f"\nBattery Analysis:\n{result.battery_analysis}")
        print(f"\nChosen Action: {result.chosen_action}")
        print(f"\nRisk Score: {result.risk_score}")

    asyncio.run(test_agent())