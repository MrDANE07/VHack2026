# AEGIS Swarm Backend

FastAPI-based backend for the AEGIS Drone Swarm search-and-rescue simulation.

## Project Structure

```
backend/
├── main.py              # FastAPI server with WebSocket endpoints
├── drone.py             # Drone dataclass with movement logic
├── drone_manager.py     # Fleet coordination and grid management
├── mcp_server.py        # MCP server exposing drone tools to AI agents
├── commander_agent.py   # AI-powered commander using PydanticAI + OpenRouter
├── requirements.txt     # Python dependencies
└── .env.example         # Environment variables template
```

## Components

### 1. FastAPI Server (`main.py`)

WebSocket-based real-time server for the drone simulation:

| Endpoint | Description |
|----------|-------------|
| `GET /ws/drone-control` | WebSocket for real-time drone control |
| `GET /health` | Health check |

**Message Types:**
- `keydown` / `keyup` - Manual drone control via arrow keys/WASD
- `select_drone` - Choose active drone
- `get_state` - Request full state
- `drone_update` - Server broadcasts position/state at 30fps

### 2. Drone Model (`drone.py`)

Dataclass representing a single drone with:
- `id`: Unique identifier (e.g., "DRONE-01")
- `position`: [x, y, z] coordinates
- `status`: IDLE, SEARCHING, TRACKING, RECALLING, CHARGING, MANUAL
- `battery`: 0-100%
- `assigned_sector`: A, B, C, or D
- `tracking_victim_id`: Victim being tracked
- `manual_mode`: Boolean for manual control

### 3. DroneManager (`drone_manager.py`)

Fleet coordinator managing:

- **Grid System**: 50x50 unit disaster zone divided into 10x10 cells (5 units each)
- **Sectors**: 4 quadrants (A-D) for distributed search
- **Victim Tracking**: Grid cells can contain victims with danger levels

**Key Methods:**
- `initialize_fleet()` - Creates 6 drones
- `get_available_drones()` - Drones with >40% battery
- `get_low_battery_drones()` - Drones with <20% battery
- `get_world_summary()` - Full state for AI agents

### 4. MCP Server (`mcp_server.py`)

Model Context Protocol server exposing drone tools to AI agents via FastMCP.

**Available Tools:**

| Tool | Description |
|------|-------------|
| `discover_drones` | List all drones with basic vitals |
| `get_fleet_status` | Full telemetry (position, battery, status) |
| `move_drone` | Move drone to X,Y coordinates |
| `start_thermal_scan` | Detect thermal signatures within 15 units |
| `verify_target` | Confirm victim presence with high accuracy |
| `evaluate_fleet_for_task` | Recommend best drone for a location |
| `get_world_state` | Grid exploration %, victims, sectors |
| `return_to_base` | Recall drone to charging station |

**Simulated Victims:**
- VICTIM-001: (15, 18) - 98.6F - 85% confidence
- VICTIM-002: (32, 7) - 97.8F - 72% confidence
- VICTIM-003: (8, 35) - 99.1F - 91% confidence
- VICTIM-004: (42, 41) - 98.2F - 68% confidence

### 5. Commander Agent (`commander_agent.py`)

AI-powered autonomous mission coordinator using PydanticAI with OpenRouter.

#### Architecture

```
User Input → Commander Agent → MCP Tools → DroneManager
                ↓
         MissionThought (Structured Output)
         ├── internal_monologue: str
         ├── battery_analysis: str
         ├── chosen_action: str
         └── risk_score: float (0.0-1.0)
```

#### Battery Safety Rules

The agent enforces strict battery constraints:

1. **Pre-action check**: Always verify battery before issuing commands
2. **Safety margin**: Require 15% buffer beyond calculated needs
3. **Low battery (< 20%)**: Prioritize return-to-base (RTB)
4. **Task assignment**: Only assign to drones with >40% battery (unless rescue)

#### Available Actions

- `move_drone` - Navigate to target position
- `thermal_scan` - Search for thermal signatures
- `verify_target` - Confirm victim detection
- `return_to_base` - Recall for recharging
- `evaluate_fleet` - Select optimal drone for task
- `wait` - Hold position

#### Interactive Mission Loop

Run the agent interactively:

```bash
cd backend
python commander_agent.py
```

The loop:
1. Initializes DroneManager and DroneDeps
2. Maintains `message_history` across turns (last 20)
3. Accepts natural language mission goals
4. Exits on "quit" / "exit" / "q"

Example session:
```
[Mission Command] > Search sector A for victims
[Mission Command] > Send a drone to verify the thermal signature at position 15, 18
[Mission Command] > Check battery status of all drones
[Mission Command] > Recall the low battery drone to base
[Mission Command] > quit
```

#### Programmatic Usage

```python
import asyncio
from commander_agent import DroneManager, DroneDeps, run_mission_loop

# Run interactive loop
asyncio.run(run_mission_loop())

# Or get single recommendation
from commander_agent import get_actionable_recommendation

async def main():
    dm = DroneManager()
    dm.initialize_fleet()
    deps = DroneDeps(drone_manager=dm)

    result = await get_actionable_recommendation(
        deps,
        "Multiple thermal signatures detected in sector A"
    )
    print(result.chosen_action)
    print(result.risk_score)

asyncio.run(main())
```

## Environment Variables

Create `.env` from `.env.example`:

```bash
OPENROUTER_API_KEY=your_api_key_here
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet  # optional
```

Get an OpenRouter API key at https://openrouter.ai/

## Installation

```bash
# Create virtual environment
python -m venv .venv

# Activate (Linux/macOS)
source .venv/bin/activate

# Activate (Windows)
.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Running the Backend

### WebSocket Server (for frontend)

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### MCP Server (standalone)

```bash
python mcp_server.py
```

### Commander Agent (interactive)

```bash
python commander_agent.py
```

## Drone States

| State | Description |
|-------|-------------|
| `IDLE` | At charging base, no task |
| `SEARCHING` | Random movement in assigned sector |
| `TRACKING` | Stationary over detected victim |
| `RECALLING` | Returning to base (low battery) |
| `CHARGING` | Recharging at base |
| `MANUAL` | Human-controlled via WebSocket |
| `MOVING` | En route to target |
| `SCANNING` | Performing thermal scan |

## Battery Thresholds

| Level | Action |
|-------|--------|
| > 40% | Available for new assignments |
| < 40% | Warning, limited assignments |
| < 20% | Low battery, initiate RTB |
| < 15% | Critical, trigger handoff protocol |
| Charging | +0.5% per 500ms |

## Grid System

- **World size**: 50x50 units
- **Cell size**: 5x5 units (100 cells total)
- **Sectors**: 4 quadrants (A-D), each 25x25 units
- **Charging base**: (0, 0) - origin
- **Search altitude**: Y = 5
- **Charging altitude**: Y = 2

## Tech Stack

- **Server**: FastAPI + Uvicorn
- **Real-time**: WebSockets
- **AI Agent**: PydanticAI + OpenRouter
- **MCP**: FastMCP
- **Async I/O**: asyncio + aioconsole