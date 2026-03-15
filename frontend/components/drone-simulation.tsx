"use client"

import { useRef, memo, useCallback } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"

// Split components for better memoization and WebGL stability
import { TacticalGround, SectorZone, DisasterEnvironment, DebrisField, ChargingHub, SECTOR_DEFS } from "./3d/terrain"
import { CoverageOverlay } from "./3d/coverage-overlay"
import { Drone, FlightPaths, SearchTrail } from "./3d/drone-model"
import { VictimMarker } from "./3d/victim-marker"

// ─── Types ────────────────────────────────────────────────────────────────────

interface DroneData {
  id: string
  position: [number, number, number]
  status: "SEARCHING" | "SCANNING" | "RECALLING" | "IDLE" | "CHARGING" | "TRACKING"
  battery: number
  target?: [number, number, number]
  searchPattern: [number, number, number][]
}

interface VictimData {
  id: string
  position: [number, number, number]
  rescued: boolean
  trackingDroneId?: string
  status?: "HIDDEN" | "DETECTED" | "RESCUE_OTW" | "RESCUED"
}

// ─── Camera Tracker (writes azimuth to compass DOM element) ───────────────────

function CameraTracker({ compassRef }: { compassRef: React.RefObject<HTMLDivElement | null> }) {
  useFrame(({ camera }) => {
    if (!compassRef.current) return
    const azimuth = Math.atan2(camera.position.x - 25, camera.position.z - 25)
    compassRef.current.style.transform = `rotate(${-azimuth * (180 / Math.PI)}deg)`
  })
  return null
}

// ─── Scene Content (isolated from dashboard state) ────────────────────────────

const SceneContent = memo(function SceneContent({
  drones,
  victims,
  onSelectDrone,
  compassRef,
}: {
  drones: DroneData[]
  victims: VictimData[]
  onSelectDrone: (id: string) => void
  compassRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <>
      <fog attach="fog" args={["#0a1520", 100, 250]} />
      <color attach="background" args={["#0a1520"]} />

      {/* Lighting */}
      <ambientLight intensity={1.2} color="#b0d4ff" />
      <directionalLight position={[30, 60, 40]} intensity={1.5} color="#ffffff" />
      <pointLight position={[0, 10, 0]} color="#22c55e" intensity={5} distance={30} decay={2} />

      {/* Static terrain (heavily memoized) */}
      <TacticalGround />
      {SECTOR_DEFS.map((def) => <SectorZone key={def.id} def={def} />)}
      <DisasterEnvironment />
      <DebrisField />
      <ChargingHub />

      {/* Dynamic elements */}
      <CoverageOverlay drones={drones} />
      <FlightPaths drones={drones} />

      {drones.map((drone) => (
        <group key={drone.id}>
          <Drone data={drone} onSelect={onSelectDrone} />
          <SearchTrail points={drone.searchPattern} />
        </group>
      ))}
      {victims.map((victim) => <VictimMarker key={victim.id} data={victim} />)}

      <CameraTracker compassRef={compassRef} />

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        minDistance={8}
        maxDistance={140}
        maxPolarAngle={Math.PI / 2.1}
        target={[25, 0, 25]}
      />
    </>
  )
})

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function DroneSimulation({
  drones,
  victims,
  selectedDrone,
  onSelectDrone,
}: {
  drones: DroneData[]
  victims: VictimData[]
  selectedDrone: string | null
  onSelectDrone: (id: string) => void
}) {
  const compassRef = useRef<HTMLDivElement>(null)
  const activeAlerts = victims.filter((v) => v.status === "DETECTED").length
  const rescuedCount = victims.filter((v) => v.status === "RESCUED" || v.rescued).length
  const searchingCount = drones.filter((d) => d.status === "SEARCHING").length
  const trackingCount = drones.filter((d) => d.status === "TRACKING").length

  // Memoize callback to prevent unnecessary re-renders
  const handleSelectDrone = useCallback((id: string) => {
    onSelectDrone(id)
  }, [onSelectDrone])

  return (
    <div className="w-full h-full relative bg-[#030810]">
      <Canvas
        camera={{ position: [25, 48, 90], fov: 52, near: 0.1, far: 300 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        dpr={[1, 1.5]}
      >
        <SceneContent
          drones={drones}
          victims={victims}
          onSelectDrone={handleSelectDrone}
          compassRef={compassRef}
        />
      </Canvas>

      {/* Top-left status bar */}
      <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none select-none">
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/70 backdrop-blur border border-emerald-500/30 rounded">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-mono text-emerald-400">LIVE</span>
        </div>
        <div className="flex items-center gap-3 px-3 py-1 bg-black/70 backdrop-blur border border-blue-500/20 rounded text-[11px] font-mono text-blue-300/80">
          <span>GRID <span className="text-white/40">50x50m</span></span>
          <span className="text-white/20">|</span>
          <span>DRONES <span className="text-blue-300">{drones.length}</span></span>
          <span className="text-white/20">|</span>
          <span>SEARCHING <span className="text-blue-300">{searchingCount}</span></span>
          <span className="text-white/20">|</span>
          <span>TRACKING <span className={trackingCount > 0 ? "text-red-400" : "text-blue-300"}>{trackingCount}</span></span>
          <span className="text-white/20">|</span>
          <span>ALERTS <span className={activeAlerts > 0 ? "text-red-400 animate-pulse" : "text-blue-300"}>{activeAlerts}</span></span>
          <span className="text-white/20">|</span>
          <span>RESCUED <span className="text-emerald-400">{rescuedCount}</span></span>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute top-3 right-3 bg-black/70 backdrop-blur border border-blue-500/20 rounded p-2.5 pointer-events-none select-none space-y-0.5">
        <div className="text-[9px] font-mono text-white/30 tracking-widest pb-1">DRONE STATUS</div>
        {[
          { color: "#3b82f6", label: "SEARCHING" },
          { color: "#ef4444", label: "TRACKING" },
          { color: "#f59e0b", label: "RECALLING" },
          { color: "#10b981", label: "CHARGING" },
          { color: "#4b5563", label: "IDLE" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2 py-0.5">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }} />
            <span className="text-[10px] font-mono text-slate-400">{label}</span>
          </div>
        ))}
        <div className="pt-1.5 border-t border-white/10">
          <div className="text-[9px] font-mono text-white/30 tracking-widest pb-1">VICTIMS</div>
          {[
            { color: "#ef4444", label: "DETECTED" },
            { color: "#f59e0b", label: "RESCUE OTW" },
            { color: "#22c55e", label: "RESCUED" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2 py-0.5">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }} />
              <span className="text-[10px] font-mono text-slate-400">{label}</span>
            </div>
          ))}
        </div>
        <div className="pt-1.5 border-t border-white/10">
          <div className="text-[9px] font-mono text-white/30 tracking-widest pb-0.5">COVERAGE</div>
          <div className="flex items-center gap-2 py-0.5">
            <div className="w-2 h-2 rounded shrink-0 opacity-20 bg-blue-400" />
            <span className="text-[10px] font-mono text-slate-400">UNSCANNED</span>
          </div>
          <div className="flex items-center gap-2 py-0.5">
            <div className="w-2 h-2 rounded shrink-0" style={{ backgroundColor: "#3b82f6", boxShadow: "0 0 4px #3b82f6" }} />
            <span className="text-[10px] font-mono text-slate-400">SCANNED</span>
          </div>
        </div>
      </div>

      {/* Compass */}
      <div className="absolute bottom-4 right-4 w-16 h-16 rounded-full bg-black/70 backdrop-blur border border-blue-500/25 flex items-center justify-center pointer-events-none select-none overflow-hidden">
        <div ref={compassRef} className="relative w-12 h-12 transition-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 text-[10px] font-mono text-blue-400 font-bold leading-none">N</div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] font-mono text-slate-600 leading-none">S</div>
          <div className="absolute left-0 top-1/2 -translate-y-1/2 text-[9px] font-mono text-slate-600 leading-none">W</div>
          <div className="absolute right-0 top-1/2 -translate-y-1/2 text-[9px] font-mono text-slate-600 leading-none">E</div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full w-0.5 h-4 bg-blue-400 origin-bottom rounded-full" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 h-2.5 w-0.5 bg-slate-600 origin-top rounded-full" />
        </div>
      </div>

      {/* Area label */}
      <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-black/70 backdrop-blur border border-blue-500/20 rounded pointer-events-none select-none">
        <span className="text-[10px] font-mono text-slate-500">AREA 7 - DISASTER ZONE - 50x50m</span>
      </div>
    </div>
  )
}
