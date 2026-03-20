# VHack2026 - AEGIS SWARM Mission Control

A full-stack application demonstrating **autonomous agentic drone swarm operations** with thermal victim detection, featuring a real-time 3D visualization and AI-powered mission commander with chain-of-thought reasoning.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AEGIS SWARM SYSTEM                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    WebSocket     ┌──────────────────────────┐   │
│  │   Frontend   │◄────────────────►│       Backend            │   │
│  │  (Next.js)   │                  │    (FastAPI + Agent)     │   │
│  │              │   drone_update   │                          │   │
│  │  - 3D Scene  │◄────────────────►│  ┌────────────────────┐  │   │
│  │  - Dashboard │                  │  │   Agent Loop       │  │   │
│  │  - Mission   │    state_sync    │  │   (every 5s)       │  │   │
│  └──────────────┘◄────────────────►│  └─────────┬──────────┘  │   │
│                                          │                    │   │
│                                          ▼                    │   │
│  ┌─────────────────────────────────────────────────────────┐    │   │
│  │              Commander Agent (PydanticAI)               │    │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │    │   │
│  │  │ System      │  │ Mission      │  │ MCP Tools     │  │    │   │
│  │  │ Prompt      │─►│ Thought      │─►│ (8 tools)     │  │    │   │
│  │  │ (battery    │  │ (structured  │  │ - move_drone  │  │    │   │
│  │  │  safety)    │  │  output)     │  │ - thermal_scan│  │    │   │
│  │  └─────────────┘  └──────────────┘  │ - return_base │  │    │   │
│  │                                    │ - evaluate     │  │    │   │
│  │                                    └───────────────┘  │    │   │
│  └─────────────────────────────────────────────────────────┘    │   │
│                              │                                   │   │
│                              ▼                                   │   │
│  ┌─────────────────────────────────────────────────────────┐    │   │
│  │              Drone Manager (Fleet Intelligence)         │    │   │
│  │  - Fleet status    - Sector assignment                   │    │   │
│  │  - Battery analysis - Deployment optimization            │    │   │
│  └─────────────────────────────────────────────────────────┘    │   │
│                              │                                   │   │
│                              ▼                                   │   │
│  ┌─────────────────────────────────────────────────────────┐    │   │
│  │              Fleet: 6 Autonomous Drones                  │    │   │
│  │  States: IDLE │ SEARCHING │ TRACKING │ RECALLING │ CHARGING │   │
│  └─────────────────────────────────────────────────────────┘    │   │
└─────────────────────────────────────────────────────────────────────┘
```

## Agentic Reasoning & Thinking Model

### The Thinking Process

The AEGIS Commander Agent implements a **chain-of-thought reasoning model** that mimics human tactical decision-making. Every decision passes through a structured thinking pipeline:

```
User Input / Trigger
        │
        ▼
┌───────────────────┐
│ 1. STATE CAPTURE  │ ← Gather current world state
│ - Fleet status    │   (battery, positions, victims)
│ - Victim locations│
│ - Sector coverage │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ 2. BATTERY SAFETY │ ← CRITICAL: Always check first
│ - Check drone     │   - 15% safety margin required
│   battery levels  │   - <20% triggers RTB priority
│ - Calculate       │   - Must have >40% for deployment
│   round-trip      │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ 3. RISK ASSESSMENT│ ← Evaluate action feasibility
│ - Distance to     │   - Battery vs energy needed
│   target          │   - Priority of victims
│ - Urgency vs      │   - Fleet coordination needs
│   safety          │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ 4. ACTION SELECT  │ ← Choose optimal action
│ - move_drone      │
│ - thermal_scan    │   Output: MissionThought
│ - return_to_base  │   (structured JSON)
│ - evaluate_fleet  │
└────────┬──────────┘
         │
         ▼
    MissionThought
    {
      internal_monologue: "...",
      battery_analysis: "...",
      chosen_action: "move_drone",
      risk_score: 0.35
    }
```

### Structured Output: MissionThought

The agent outputs a `MissionThought` Pydantic model that enforces structured reasoning:

```python
class MissionThought(BaseModel):
    internal_monologue: str  # Chain-of-thought reasoning
    battery_analysis: str    # Battery constraints & feasibility
    chosen_action: str       # move_drone | thermal_scan |
                             # verify_target | return_to_base |
                             # evaluate_fleet | wait
    risk_score: float        # 0.0 (safe) to 1.0 (critical)
```

This structure ensures the agent always:
1. **Articulates reasoning** - Makes thinking visible
2. **Analyzes battery** - Safety-first approach
3. **Selects explicit action** - No ambiguity
4. **Quantifies risk** - Measurable risk assessment

### Agent Loop (Continuous Intelligence)

The agent runs in a continuous loop in `backend/main.py`:

```python
async def agent_loop():
    while True:
        # Wait for trigger (5s interval OR user action)
        await asyncio.sleep(5)
        # OR: agent_trigger_event.wait()

        # 1. Build context from current state
        context = build_situation_context()

        # 2. Get agent recommendation
        result = await get_actionable_recommendation(deps, context)

        # 3. Log reasoning to frontend
        add_log("REASONING", result.internal_monologue)
        add_log("BATTERY", result.battery_analysis)
        add_log("ACTION", result.chosen_action)

        # 4. Execute recommended actions via MCP tools
        for tool_call in result.tool_calls:
            execute_mcp_tool(tool_call)
```

**Loop Characteristics:**
- **Interval**: Every 5 seconds (or on trigger)
- **Trigger Types**: Periodic | Rescue dispatch | Low battery alert
- **Output**: Real-time reasoning logs sent to frontend via WebSocket
- **Persistence**: All decisions logged to `mission_history.json`

### MCP Tools (Model Context Protocol)

The agent has 8 tools available for drone control:

| Tool | Purpose |
|------|---------|
| `move_drone()` | Navigate drone to target position |
| `thermal_scan()` | Scan area for thermal signatures |
| `verify_target()` | Confirm victim detection |
| `return_to_base()` | Command RTB for charging |
| `evaluate_fleet()` | Get full fleet status |
| `get_drone_status()` | Query single drone state |
| `assign_sector()` | Deploy drone to search sector |
| `abort_mission()` | Emergency stop all operations |

### Battery Safety Logic

The agent enforces strict battery constraints:

```
┌─────────────────────────────────────────────────────┐
│                 BATTERY SAFETY MATRIX               │
├──────────────┬──────────────────────────────────────┤
│ Battery      │ Action                               │
├──────────────┼──────────────────────────────────────┤
│ > 40%        │ Deployable for new sectors          │
│ 20-40%       │ Continue current mission            │
│ < 20%        │ ⚠ LOW: Initiate RTB                │
│ < 15%        │ 🔴 CRITICAL: Force return           │
│ +0.5%/500ms  │ Charging rate at base               │
└──────────────┴──────────────────────────────────────┘
```

**Before ANY action, the agent calculates:**
1. Distance to target (0.5% battery per unit)
2. Round-trip requirement (×2)
3. Safety margin (+15%)
4. If `battery < total_needed`: refuse action, recommend RTB

---

## Quick Start

### Frontend (Next.js + Three.js)

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:3000
```

### Backend (FastAPI + AI Agent)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# Set OpenRouter API key
# Create .env with OPENROUTER_API_KEY=your_key

# Run WebSocket server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# OR run Commander Agent (interactive)
python commander_agent.py
```

---
