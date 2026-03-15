// ─── Shared types, constants, and utilities for all 3D sub-components ────────

export interface DroneData {
  id: string
  position: [number, number, number]
  status: "SEARCHING" | "SCANNING" | "RECALLING" | "IDLE" | "CHARGING" | "TRACKING" | "DEPLOYING" | "MANUAL"
  battery: number
  target?: [number, number, number]
  searchPattern: [number, number, number][]
  manualMode?: boolean
}

export interface VictimData {
  id: string
  position: [number, number, number]
  rescued: boolean
  trackingDroneId?: string
  status?: "HIDDEN" | "DETECTED" | "RESCUE_OTW" | "RESCUED"
}

export const STATUS_COLORS: Record<string, string> = {
  SEARCHING: "#3b82f6",
  SCANNING:  "#22c55e",
  TRACKING:  "#ef4444",
  RECALLING: "#f59e0b",
  IDLE:      "#4b5563",
  CHARGING:  "#10b981",
  DEPLOYING: "#06b6d4",
  MANUAL:    "#a855f7",
}

export const SECTOR_DEFS = [
  { id: "A", ox: 0,  oz: 0,  color: "#3b82f6" },
  { id: "B", ox: 25, oz: 0,  color: "#22c55e" },
  { id: "C", ox: 0,  oz: 25, color: "#a78bfa" },
  { id: "D", ox: 25, oz: 25, color: "#f59e0b" },
]

export const COVERAGE_CELLS = 20
export const CELL_SIZE = 50 / COVERAGE_CELLS // 2.5 world-units per cell

/** Deterministic LCG seeded random number generator. */
export function seededRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0x100000000
  }
}
