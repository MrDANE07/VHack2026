"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { ChevronLeft, ChevronRight, Crosshair } from "lucide-react"

export interface SetupConfig {
  drones: { id: string; online: boolean; battery: number }[]
  victims: { id: string; position: [number, number, number] }[]
}

function getBatteryColor(battery: number): string {
  if (battery > 50) return "#22c55e"
  if (battery > 20) return "#f59e0b"
  return "#ef4444"
}

// ─── Step Indicator ──────────────────────────────────────────────────────────

const STEPS = [
  { num: 1, label: "DRONE CONFIG" },
  { num: 2, label: "TERRAIN SETUP" },
  { num: 3, label: "LAUNCH" },
]

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {STEPS.map((s, i) => (
        <div key={s.num} className="flex items-center gap-2">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded font-mono text-xs transition-all ${
              current === s.num
                ? "bg-primary/20 text-primary border border-primary/50"
                : current > s.num
                ? "bg-chart-4/20 text-chart-4 border border-chart-4/50"
                : "bg-muted text-muted-foreground border border-border"
            }`}
          >
            <span className="font-bold">{s.num}</span>
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-8 h-px ${current > s.num ? "bg-chart-4" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Drone Card (Step 1) ─────────────────────────────────────────────────────

function DroneCard({
  drone,
  onChange,
}: {
  drone: { id: string; online: boolean; battery: number }
  onChange: (update: Partial<{ online: boolean; battery: number }>) => void
}) {
  const batColor = drone.online ? getBatteryColor(drone.battery) : "#6b7280"

  return (
    <div
      className={`p-4 rounded border transition-all ${
        drone.online ? "bg-card border-primary/30" : "bg-muted/30 border-border opacity-60"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-sm font-bold text-foreground">{drone.id}</span>
        <button
          onClick={() => onChange({ online: !drone.online })}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            drone.online ? "bg-chart-4" : "bg-muted"
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              drone.online ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-xs text-muted-foreground">BATTERY</span>
          <span className="font-mono text-sm font-bold" style={{ color: batColor }}>
            {drone.battery}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={drone.battery}
          disabled={!drone.online}
          onChange={(e) => onChange({ battery: parseInt(e.target.value) })}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ accentColor: batColor }}
        />
      </div>

      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${drone.battery}%`, backgroundColor: batColor }}
        />
      </div>

      <div className="mt-2 text-center">
        <span className={`font-mono text-xs ${drone.online ? "text-chart-4" : "text-muted-foreground"}`}>
          {drone.online ? "ONLINE" : "OFFLINE"}
        </span>
      </div>
    </div>
  )
}

// ─── Tactical Map (Step 2) ───────────────────────────────────────────────────

const SECTOR_MAP = [
  { id: "A", left: "0%", top: "0%", color: "#3b82f6" },
  { id: "B", left: "50%", top: "0%", color: "#22c55e" },
  { id: "C", left: "0%", top: "50%", color: "#a78bfa" },
  { id: "D", left: "50%", top: "50%", color: "#f59e0b" },
]

function TacticalMap({
  victims,
  victimCount,
  onPlace,
  onRemove,
}: {
  victims: { id: string; position: [number, number, number] }[]
  victimCount: number
  onPlace: (position: [number, number, number]) => void
  onRemove: (index: number) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (victims.length >= victimCount || !gridRef.current) return

      const rect = gridRef.current.getBoundingClientRect()
      const rawX = ((e.clientX - rect.left) / rect.width) * 50
      const rawZ = ((e.clientY - rect.top) / rect.height) * 50

      const cx = Math.round(Math.max(1, Math.min(49, rawX)))
      const cz = Math.round(Math.max(1, Math.min(49, rawZ)))

      const tooClose = victims.some((v) => {
        const dx = v.position[0] - cx
        const dz = v.position[2] - cz
        return Math.sqrt(dx * dx + dz * dz) < 3
      })
      if (tooClose) return

      onPlace([cx, 0, cz])
    },
    [victims, victimCount, onPlace],
  )

  const canPlace = victims.length < victimCount

  return (
    <div
      ref={gridRef}
      onClick={handleClick}
      className={`relative aspect-square w-full max-w-[500px] mx-auto rounded border border-border overflow-hidden ${
        canPlace ? "cursor-crosshair" : "cursor-default"
      }`}
      style={{
        background: "#030810",
        backgroundImage:
          "linear-gradient(to right, rgba(59,130,246,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(59,130,246,0.08) 1px, transparent 1px)",
        backgroundSize: "10% 10%",
      }}
    >
      {/* Sector quadrants */}
      {SECTOR_MAP.map((s) => (
        <div
          key={s.id}
          className="absolute"
          style={{
            left: s.left,
            top: s.top,
            width: "50%",
            height: "50%",
            backgroundColor: s.color,
            opacity: 0.06,
            borderRight: `1px solid ${s.color}33`,
            borderBottom: `1px solid ${s.color}33`,
          }}
        >
          <span
            className="absolute font-mono text-lg font-bold select-none pointer-events-none"
            style={{
              color: s.color,
              opacity: 0.4,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
            }}
          >
            SECTOR {s.id}
          </span>
        </div>
      ))}

      {/* Charging hub at origin */}
      <div
        className="absolute w-3 h-3 rounded-full pointer-events-none"
        style={{
          left: "0%",
          top: "0%",
          transform: "translate(-25%, -25%)",
          backgroundColor: "#22c55e",
          border: "1px solid #22c55e",
          boxShadow: "0 0 8px #22c55e",
        }}
        title="Charging Hub [0, 0]"
      />

      {/* Placed victim markers */}
      {victims.map((v, i) => (
        <div
          key={v.id}
          className="absolute"
          style={{
            left: `${(v.position[0] / 50) * 100}%`,
            top: `${(v.position[2] / 50) * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="relative">
            <div
              className="absolute -inset-2 rounded-full animate-ping"
              style={{ backgroundColor: "#ef4444", opacity: 0.15 }}
            />
            <div
              className="w-5 h-5 rounded-full bg-destructive flex items-center justify-center text-white text-[10px] font-mono font-bold cursor-pointer relative z-10"
              style={{ boxShadow: "0 0 10px rgba(239,68,68,0.6)" }}
              onClick={(e) => {
                e.stopPropagation()
                onRemove(i)
              }}
              title={`${v.id} [${v.position[0]}, ${v.position[2]}] — Click to remove`}
            >
              {i + 1}
            </div>
          </div>
        </div>
      ))}

      {canPlace && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur px-3 py-1 rounded font-mono text-xs text-primary border border-primary/30 pointer-events-none">
          Click to place Victim {String(victims.length + 1).padStart(2, "0")}
        </div>
      )}
    </div>
  )
}

// ─── Countdown Overlay (Step 3) ──────────────────────────────────────────────

function CountdownOverlay({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState(0)
  const texts = ["3", "2", "1", "AEGIS SWARM OPS!"]

  useEffect(() => {
    if (phase < 4) {
      const ms = phase === 3 ? 1800 : 1000
      const timeout = setTimeout(() => setPhase((p) => p + 1), ms)
      return () => clearTimeout(timeout)
    } else {
      onComplete()
    }
  }, [phase, onComplete])

  if (phase >= 4) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div
        key={phase}
        className="animate-countdown select-none"
        style={{
          fontSize: phase === 3 ? "clamp(1.8rem, 5vw, 3.5rem)" : "clamp(5rem, 15vw, 10rem)",
          fontFamily: "var(--font-mono, 'Geist Mono', monospace)",
          fontWeight: 900,
          color: phase === 3 ? "#22d3ee" : "#e2e8f0",
          textShadow:
            phase === 3
              ? "0 0 40px rgba(34,211,238,0.5), 0 0 80px rgba(34,211,238,0.25)"
              : "0 0 30px rgba(226,232,240,0.25)",
          letterSpacing: phase === 3 ? "0.15em" : "0.05em",
          textAlign: "center" as const,
        }}
      >
        {texts[phase]}
      </div>
    </div>
  )
}

// ─── Main Setup Wizard ───────────────────────────────────────────────────────

export default function SetupWizard({ onComplete }: { onComplete: (config: SetupConfig) => void }) {
  const [step, setStep] = useState(1)
  const [showCountdown, setShowCountdown] = useState(false)

  const [drones, setDrones] = useState([
    { id: "DRONE-01", online: true, battery: 95 },
    { id: "DRONE-02", online: true, battery: 88 },
    { id: "DRONE-03", online: true, battery: 72 },
    { id: "DRONE-04", online: true, battery: 65 },
  ])

  const [droneCount, setDroneCount] = useState(4)
  const [victimCount, setVictimCount] = useState(6)
  const [victims, setVictims] = useState<{ id: string; position: [number, number, number] }[]>([])

  const onlineDrones = drones.filter((d) => d.online)
  const allVictimsPlaced = victims.length === victimCount

  const handleDroneChange = useCallback(
    (index: number, update: Partial<{ online: boolean; battery: number }>) => {
      setDrones((prev) => prev.map((d, i) => (i === index ? { ...d, ...update } : d)))
    },
    [],
  )

  const handlePlaceVictim = useCallback((position: [number, number, number]) => {
    setVictims((prev) => [
      ...prev,
      { id: `VIC-${String(prev.length + 1).padStart(3, "0")}`, position },
    ])
  }, [])

  const handleRemoveVictim = useCallback((index: number) => {
    setVictims((prev) => {
      const next = prev.filter((_, i) => i !== index)
      return next.map((v, i) => ({ ...v, id: `VIC-${String(i + 1).padStart(3, "0")}` }))
    })
  }, [])

  const handleDroneCountChange = useCallback((count: number) => {
    setDroneCount(count)
    setDrones((prev) => {
      if (prev.length > count) {
        return prev.slice(0, count)
      }
      const newDrones = [...prev]
      const sectors = ["A", "B", "C", "D", "E", "F"]
      const batteries = [95, 88, 72, 65, 50, 40]
      for (let i = prev.length; i < count; i++) {
        newDrones.push({
          id: `DRONE-${String(i + 1).padStart(2, "0")}`,
          online: true,
          battery: batteries[i] || 50,
        })
      }
      return newDrones
    })
  }, [])

  const handleVictimCountChange = useCallback((count: number) => {
    setVictimCount(count)
    setVictims((prev) => (prev.length > count ? prev.slice(0, count) : prev))
  }, [])

  const handleStartMission = useCallback(() => {
    setStep(3)
    setShowCountdown(true)
  }, [])

  const handleCountdownComplete = useCallback(() => {
    onComplete({ drones, victims })
  }, [drones, victims, onComplete])

  // ─── Countdown phase ────────────────────────────────────────────────────

  if (showCountdown) {
    return <CountdownOverlay onComplete={handleCountdownComplete} />
  }

  // ─── Wizard UI ──────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background tactical-grid">
      {/* Header */}
      <div className="border-b border-border bg-card/80 backdrop-blur px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <h1 className="font-mono text-lg font-bold text-foreground tracking-widest">AEGIS SWARM</h1>
            <span className="font-mono text-xs text-muted-foreground tracking-wide">MISSION SETUP</span>
          </div>
          <span className="font-mono text-xs text-muted-foreground">Step {step} of 3</span>
        </div>
      </div>

      <StepIndicator current={step} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 tactical-scrollbar">
        {/* ── Step 1: Drone Configuration ──────────────────────────────────── */}
        {step === 1 && (
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <h2 className="font-mono text-xl font-bold text-foreground tracking-wide mb-1">
                DRONE CONFIGURATION
              </h2>
              <p className="font-mono text-xs text-muted-foreground">
                Toggle drones online/offline and set battery levels for the mission.
              </p>
            </div>

            {/* Drone count control */}
            <div className="flex items-center gap-6 mb-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">DRONES:</span>
                <input
                  type="range"
                  min={1}
                  max={6}
                  value={droneCount}
                  onChange={(e) => handleDroneCountChange(parseInt(e.target.value))}
                  className="w-32 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: "#22c55e" }}
                />
                <span className="font-mono text-sm font-bold text-chart-4">{droneCount}</span>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-card border border-border rounded p-3 text-center">
                <div className="font-mono text-2xl font-bold text-chart-4">{onlineDrones.length}</div>
                <div className="font-mono text-xs text-muted-foreground">ONLINE</div>
              </div>
              <div className="bg-card border border-border rounded p-3 text-center">
                <div className="font-mono text-2xl font-bold text-chart-1">{drones.length}</div>
                <div className="font-mono text-xs text-muted-foreground">TOTAL</div>
              </div>
              <div className="bg-card border border-border rounded p-3 text-center">
                <div className="font-mono text-2xl font-bold text-foreground">
                  {onlineDrones.length > 0
                    ? Math.round(onlineDrones.reduce((s, d) => s + d.battery, 0) / onlineDrones.length)
                    : 0}
                  %
                </div>
                <div className="font-mono text-xs text-muted-foreground">AVG BATTERY</div>
              </div>
            </div>

            {/* Drone cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {drones.map((drone, i) => (
                <DroneCard key={drone.id} drone={drone} onChange={(u) => handleDroneChange(i, u)} />
              ))}
            </div>
          </div>
        )}

        {/* ── Step 2: Victim & Terrain Setup ───────────────────────────────── */}
        {step === 2 && (
          <div className="max-w-5xl mx-auto">
            <div className="mb-6">
              <h2 className="font-mono text-xl font-bold text-foreground tracking-wide mb-1">
                VICTIM &amp; TERRAIN SETUP
              </h2>
              <p className="font-mono text-xs text-muted-foreground">
                Click on the tactical grid to place victim markers. Area 7 — 50×50 units.
              </p>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-6 mb-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">VICTIMS:</span>
                <input
                  type="range"
                  min={1}
                  max={6}
                  value={victimCount}
                  onChange={(e) => handleVictimCountChange(parseInt(e.target.value))}
                  className="w-32 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: "#ef4444" }}
                />
                <span className="font-mono text-sm font-bold text-destructive">{victimCount}</span>
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                Placed: <span className="text-foreground font-bold">{victims.length}</span> / {victimCount}
              </div>
            </div>

            {/* Map + victim list */}
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 min-w-0">
                <TacticalMap
                  victims={victims}
                  victimCount={victimCount}
                  onPlace={handlePlaceVictim}
                  onRemove={handleRemoveVictim}
                />
              </div>

              <div className="lg:w-56 space-y-2">
                <div className="font-mono text-xs text-muted-foreground mb-2">PLACED VICTIMS</div>
                {victims.length === 0 ? (
                  <div className="font-mono text-xs text-muted-foreground/50 italic">
                    Click on map to place…
                  </div>
                ) : (
                  victims.map((v, i) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between bg-card border border-border rounded px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-destructive flex items-center justify-center text-white text-[9px] font-mono font-bold">
                          {i + 1}
                        </div>
                        <span className="font-mono text-xs text-foreground">{v.id}</span>
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        [{v.position[0]}, {v.position[2]}]
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer navigation */}
      <div className="border-t border-border bg-card/80 backdrop-blur px-6 py-3 flex items-center justify-between">
        <div>
          {step > 1 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="flex items-center gap-2 px-4 py-2 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              BACK
            </button>
          )}
        </div>
        <div>
          {step === 1 && (
            <button
              onClick={() => setStep(2)}
              disabled={onlineDrones.length === 0}
              className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground font-mono text-xs font-bold rounded hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              NEXT
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          {step === 2 && (
            <button
              onClick={handleStartMission}
              disabled={!allVictimsPlaced}
              className="flex items-center gap-2 px-5 py-2 bg-chart-4 text-white font-mono text-xs font-bold rounded hover:bg-chart-4/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ boxShadow: allVictimsPlaced ? "0 0 20px rgba(34,197,94,0.3)" : "none" }}
            >
              <Crosshair className="w-4 h-4" />
              START MISSION
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
