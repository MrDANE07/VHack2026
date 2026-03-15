# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**VHack2026 - AEGIS SWARM Mission Control** is a Next.js 16 application that simulates an agentic AI swarm intelligence system for autonomous drone search-and-rescue operations. The application features a real-time 3D visualization using Three.js/react-three-fiber and demonstrates sophisticated state management for drone fleet coordination, thermal victim detection, and rescue operations.

**Tech Stack:**
- Next.js 16.1.6 (App Router)
- React 19.2.4
- TypeScript 5.7.3
- Tailwind CSS 4.2.0
- shadcn/ui components (custom UI library)
- Three.js 0.183.2 + @react-three/fiber 9.5.0 + @react-three/drei 10.7.7
- Zod 3.24.1 (validation)
- React Hook Form 7.54.1
- Vercel Analytics

## Architecture

### High-Level Structure

```
frontend/
├── app/                    # Next.js App Router
│   ├── layout.tsx         # Root layout with fonts and analytics
│   ├── page.tsx           # Main dashboard page with state orchestration
│   └── globals.css        # Global styles with tactical theme
├── components/            # React components
│   ├── ui/               # shadcn/ui primitive components
│   ├── drone-simulation.tsx  # 3D scene (Three.js/Canvas)
│   ├── dashboard-header.tsx  # Top navigation/status bar
│   ├── fleet-status.tsx      # Right sidebar - drone list
│   ├── mission-log.tsx       # Left sidebar - event log
│   ├── victim-alerts.tsx     # Bottom-left alert panel
│   └── theme-provider.tsx    # Dark/light theme context
├── hooks/                 # Custom React hooks
│   ├── use-mobile.ts     # Responsive breakpoint detection
│   └── use-toast.ts      # Toast notification system
├── lib/
│   └── utils.ts          # cn() utility for className merging
├── public/               # Static assets
├── styles/               # Additional CSS (empty, uses globals.css)
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── next.config.mjs       # Next.js config (ignores TS errors, unoptimized images)
└── components.json       # shadcn/ui configuration
```

### Core Application Flow

The main simulation lives in `frontend/app/page.tsx` (`DashboardPage` component):
- **State Management**: Single source of truth for drones, victims, logs, alerts
- **Simulation Loop**: Multiple `useEffect` intervals drive the autonomous behavior:
  - Drone movement and battery management (500ms interval)
  - Victim thermal detection (1000ms interval)
  - Rescue countdown timer (1000ms interval)
- **Sector System**: Area 7 is divided into 4 sectors (A-D) for search coverage
- **MCP Integration**: Simulated Model Context Protocol for agent reasoning logs

### 3D Visualization (`drone-simulation.tsx`)

- Uses `@react-three/fiber` for React integration with Three.js
- `Canvas` with `OrbitControls` for camera manipulation
- Custom components:
  - `Drone`: Animated quadcopter with status-based coloring, propeller rotation, scan cones
  - `VictimMarker`: Pulsing sphere with ring for detected victims
  - `ChargingHub`: Base station at origin with glowing ring
  - `TacticalGrid`: Infinite grid with sector labels
- Visual indicators:
  - SEARCHING: Blue with green thermal scan cone
  - TRACKING: Red with tracking beacon
  - RECALLING: Amber
  - IDLE: Gray
  - CHARGING: Green
  - Battery displayed as colored bar on drone

## Development Commands

### Frontend (Next.js)

**From `frontend/` directory:**

```bash
# Development server with hot reload
npm run dev
# or
next dev

# Production build
npm run build
# or
next build

# Start production server
npm start
# or
next start

# Run ESLint
npm run lint
```

**Important Notes:**
- TypeScript errors are ignored during build (`ignoreBuildErrors: true` in `next.config.mjs`)
- Images are unoptimized (needed for Three.js/canvas compatibility)
- Project uses App Router (pages in `app/` directory)
- Client components use `"use client"` directive

### Combined Project

Since this is a monorepo-like structure (frontend at root-level):

```bash
# Always run frontend commands from the frontend directory
cd frontend
npm run dev

# Or use npx with explicit cwd
npx --prefix frontend next dev
```
backend
cd backend
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

## Component Patterns

### State Management

- Local component state with `useState`/`useCallback`
- Complex state lives in `page.tsx` and flows down via props
- Callbacks passed up for user interactions (alert dispatch, drone selection)
- No external state library (React Context only for theme)

### UI Components

- shadcn/ui components used throughout (Button, Badge, ScrollArea, etc.)
- All UI components are client components with `"use client"`
- Custom CSS in `globals.css` with tactical dark theme
- Tailwind utility classes primary styling method
- `cn()` utility for conditional className merging

### 3D Scene

- Pure client-side rendered (dynamic import with `ssr: false`)
- Props: `drones`, `victims`, `selectedDrone`, `onSelectDrone`
- Uses `useFrame` for per-frame animations
- Coordinates: X (east-west), Y (up-down), Z (north-south)
- Grid is 100x100 units, charging hub at [0, 0, 0]

## File Conventions

### TypeScript

- Strict mode enabled (`strict: true`)
- Interfaces defined alongside components or in separate files
- Props interfaces typically named `ComponentNameProps` or inferred
- Type imports use `import type { Foo } from '...'`
- Path aliases: `@/*` maps to project root
- DefinitelyTyped types included for Node/React

### Naming

- Components: PascalCase (e.g., `DroneSimulation`)
- Files: kebab-case for components (e.g., `drone-simulation.tsx`)
- Hooks: `use-*.ts` (e.g., `use-mobile.ts`)
- Utilities: camelCase (e.g., `cn`, `formatTimeAgo`)
- Constants: UPPER_SNAKE_CASE (e.g., `CHARGING_BASE`, `LOW_BATTERY_THRESHOLD`)
- Types/Interfaces: PascalCase

### Styling

- Tailwind CSS for all styling
- Custom colors defined in CSS variables in `globals.css`
- Primary palette: Cyan/amber/green on dark carbon backgrounds
- Status colors mapped via `--chart-*` CSS variables
- Custom animations: `animate-pulse-glow`, `animate-typewriter`, `animate-beacon`

## Testing

**No formal test suite configured yet.** The project uses:
- TypeScript for compile-time safety
- Manual testing via dev server
- No Jest/Vitest configuration
- No unit or integration tests present

To add tests, consider:
- Jest + React Testing Library for unit tests
- Playwright for E2E tests
- Vitest for faster unit/integration

## Environment & Configuration

- **Node**: Use Node 18+ (Next.js 16 requires Node 18+)
- **Package Manager**: npm (lockfile present) - pnpm-lock.yaml also exists
- **Env**: `.env` file in frontend/ (gitignored) for any future secrets
- **OS**: Windows (developed on win32) - uses Unix shell commands

### Next.js Config (`next.config.mjs`)

```javascript
{
  typescript: { ignoreBuildErrors: true },
  images: { unoptimized: true }
}
```

## Important Implementation Details

### Drone States

- `IDLE`: At charging base, awaiting assignment
- `SEARCHING`: Moving randomly within assigned sector, scanning for victims
- `TRACKING`: Stationary over detected victim, maintaining lock
- `RECALLING`: Returning to charging base (low battery/critical)
- `CHARGING`: At base, battery replenishing (+0.5%/500ms)
- `SCANNING`: Not currently used in simulation

### Mission Logic (in `page.tsx`)

- **Autonomous dispatch**: 4 drones sent to sectors A-D on boot
- **Thermal detection**: Range 8 units, triggers TRACKING mode
- **Battery thresholds**:
  - `< 20%`: Low battery warning, RTB initiated
  - `< 15%`: Critical, triggers handoff protocol via MCP
  - `> 40%` required for replacement assignments
- **Handoff**: When tracking victim and battery critical, system finds replacement drone to maintain victim tracking
- **Rescue flow**: Human operator clicks "ACKNOWLEDGE AND DISPATCH", 10s countdown, victim marked RESCUED
- **Search resumption**: After rescue, tracking drone either returns to search (battery > 20%) or RTB

### Sector System

- Grid: 50x50 units divided into 4 quadrants
- Sector A: (0-25, 0-25) center [12.5, 5, 12.5]
- Sector B: (25-50, 0-25) center [37.5, 5, 12.5]
- Sector C: (0-25, 25-50) center [12.5, 5, 37.5]
- Sector D: (25-50, 25-50) center [37.5, 5, 37.5]
- Drones fly at altitude Y=5, victims at Y=0

### MCP Simulation

The `MissionLog` displays chain-of-thought reasoning from a simulated "command agent":
- Log entries with types: REASONING, ACTION, ALERT, SYSTEM, SUCCESS
- Each log has timestamp, message, optional droneId
- Auto-scrolling with typewriter animation effect
- Shows simulated MCP tool discovery: `move_to()`, `thermal_scan()`, `return_home()`, `get_status()`

## Common Tasks

### Adding a New Drone Status

1. Add to union type in component interfaces
2. Add color mapping in `drone-simulation.tsx` (`statusColors`)
3. Add status config in `fleet-status.tsx` (`statusConfig`)
4. Handle state transitions in `page.tsx` simulation loop

### Modifying Simulation Speed

- Adjust interval durations in `useEffect` hooks (currently 500ms, 1000ms)
- Battery drain/recharge rates are hardcoded per status

### Adding New UI Components

- Place in `components/` or `components/ui/`
- For shadcn components: Use `npx shadcn@latest add <component>` (if CLI installed)
- Register path alias in `tsconfig.json` if using new directories

### Styling Changes

- Update `globals.css` for CSS variables/theme colors
- Use Tailwind classes inline in components
- Custom animations in `globals.css`

## Performance Considerations

- 3D scene renders at potentially 60fps; drone count is small (6)
- State updates every 500ms for all drones - could be optimized with refs
- No memoization on top-level component; re-renders on every state change
- Canvas is dynamically imported to avoid SSR issues

## Known Issues

- TypeScript errors ignored in build (intentional)
- No error boundaries for runtime errors in simulation
- Hardcoded victim positions and drone initial states
- No persistence or server communication (fully client-side simulation)
- Battery math may produce rounding errors (floating point)

## Git Workflow

- Main branch: `main`
- Frontend files in `/frontend` directory
- Backend directory exists but empty (`.gitkeep` only)
- Commit messages: Follow existing patterns or use descriptive sentences

## Related Resources

- Next.js 16 App Router: https://nextjs.org/docs/app
- React Three Fiber: https://docs.pmnd.rs/react-three-fiber/getting-started/introduction
- shadcn/ui: https://ui.shadcn.com/
- Tailwind CSS: https://tailwindcss.com/docs
