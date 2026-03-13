"use client"

import { useRef, useMemo, useState, useEffect } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls, Grid, Text, Line } from "@react-three/drei"
import * as THREE from "three"

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

// Drone mesh component
function Drone({ data, onSelect }: { data: DroneData; onSelect: (id: string) => void }) {
  const meshRef = useRef<THREE.Group>(null)
  const scanConeRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const statusColors: Record<string, string> = {
    SEARCHING: "#3b82f6",
    SCANNING: "#22c55e",
    TRACKING: "#ef4444",
    RECALLING: "#f59e0b",
    IDLE: "#6b7280",
    CHARGING: "#10b981",
  }

  const color = statusColors[data.status] || "#3b82f6"
  const isLowBattery = data.battery < 20
  const isScanning = data.status === "SCANNING" || data.status === "SEARCHING"
  const isTracking = data.status === "TRACKING"

  useFrame((state) => {
    if (meshRef.current) {
      // Hover animation
      meshRef.current.position.y = data.position[1] + Math.sin(state.clock.elapsedTime * 2 + data.position[0]) * 0.1

      // Rotate propellers effect (subtle)
      meshRef.current.rotation.y += 0.02
    }

    if (scanConeRef.current && isScanning) {
      scanConeRef.current.rotation.y += 0.05
    }
  })

  return (
    <group
      ref={meshRef}
      position={data.position}
      onClick={() => onSelect(data.id)}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* Drone body */}
      <mesh>
        <boxGeometry args={[0.8, 0.3, 0.8]} />
        <meshStandardMaterial
          color={isLowBattery ? "#f59e0b" : color}
          emissive={isLowBattery ? "#f59e0b" : color}
          emissiveIntensity={hovered ? 0.8 : 0.4}
        />
      </mesh>

      {/* Propeller arms */}
      {[
        [0.5, 0, 0.5],
        [-0.5, 0, 0.5],
        [0.5, 0, -0.5],
        [-0.5, 0, -0.5],
      ].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]}>
          <cylinderGeometry args={[0.15, 0.15, 0.05, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
        </mesh>
      ))}

      {/* Thermal scan cone */}
      {isScanning && !isTracking && (
        <mesh ref={scanConeRef} position={[0, -2, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[2, 4, 16, 1, true]} />
          <meshStandardMaterial
            color="#22c55e"
            emissive="#22c55e"
            emissiveIntensity={0.8}
            transparent
            opacity={0.2}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      
      {/* Tracking beacon (red pulsing cone for victim lock) */}
      {isTracking && (
        <mesh ref={scanConeRef} position={[0, -1.5, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[1.5, 3, 16, 1, true]} />
          <meshStandardMaterial
            color="#ef4444"
            emissive="#ef4444"
            emissiveIntensity={1.2}
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Drone ID label */}
      <Text
        position={[0, 1, 0]}
        fontSize={0.4}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        font="/fonts/GeistMono-Bold.ttf"
      >
        {data.id}
      </Text>

      {/* Battery indicator */}
      <mesh position={[0, 0.8, 0]}>
        <boxGeometry args={[0.6, 0.1, 0.1]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
      <mesh position={[-(0.6 - data.battery / 100 * 0.6) / 2, 0.8, 0]}>
        <boxGeometry args={[data.battery / 100 * 0.6, 0.08, 0.08]} />
        <meshStandardMaterial
          color={data.battery < 20 ? "#ef4444" : data.battery < 50 ? "#f59e0b" : "#22c55e"}
          emissive={data.battery < 20 ? "#ef4444" : data.battery < 50 ? "#f59e0b" : "#22c55e"}
          emissiveIntensity={0.5}
        />
      </mesh>
    </group>
  )
}

// Search trail visualization
function SearchTrail({ points }: { points: [number, number, number][] }) {
  if (points.length < 2) return null

  return (
    <Line
      points={points}
      color="#3b82f6"
      lineWidth={1}
      transparent
      opacity={0.3}
      dashed
      dashSize={0.5}
      gapSize={0.2}
    />
  )
}

// Victim marker - only visible once detected by drone
function VictimMarker({ data }: { data: VictimData }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const ringRef = useRef<THREE.Mesh>(null)

  // Color based on status
  const isRescued = data.status === "RESCUED" || data.rescued
  const isRescueOTW = data.status === "RESCUE_OTW"
  const isDetected = data.status === "DETECTED"
  
  const color = isRescued ? "#22c55e" : isRescueOTW ? "#f59e0b" : "#ef4444"
  const statusText = isRescued ? "RESCUED" : isRescueOTW ? "RESCUE OTW" : "VICTIM"

  useFrame((state) => {
    if (meshRef.current && !isRescued) {
      meshRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 4) * 0.2)
    }
    if (ringRef.current && !isRescued) {
      ringRef.current.rotation.z = state.clock.elapsedTime * 2
    }
  })

  // Only show victim marker if detected/rescue_otw/rescued (not HIDDEN)
  if (data.status === "HIDDEN" || (!data.trackingDroneId && !isRescued && !isRescueOTW)) return null

  return (
    <group position={data.position}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.4, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isRescued ? 0.3 : 1.0}
        />
      </mesh>
      {/* Ground ring indicator */}
      <mesh ref={ringRef} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.8, 1.2, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Status label */}
      <Text
        position={[0, 1.2, 0]}
        fontSize={0.4}
        color={color}
        anchorX="center"
        anchorY="middle"
        font="/fonts/GeistMono-Bold.ttf"
      >
        {statusText}
      </Text>
      {/* Tracking drone info */}
      {data.trackingDroneId && !isRescued && (
        <Text
          position={[0, 0.8, 0]}
          fontSize={0.25}
          color={isRescueOTW ? "#22c55e" : "#f59e0b"}
          anchorX="center"
          anchorY="middle"
          font="/fonts/GeistMono-Regular.ttf"
        >
          {isRescueOTW ? `RESCUE DISPATCHED` : `TRACKING: ${data.trackingDroneId}`}
        </Text>
      )}
    </group>
  )
}

// Charging hub at origin
function ChargingHub() {
  const ringRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (ringRef.current) {
      ringRef.current.rotation.z = state.clock.elapsedTime * 0.5
    }
  })

  return (
    <group position={[0, 0, 0]}>
      {/* Base platform */}
      <mesh position={[0, -0.1, 0]}>
        <cylinderGeometry args={[3, 3, 0.2, 32]} />
        <meshStandardMaterial color="#0a2a1a" emissive="#22c55e" emissiveIntensity={0.1} />
      </mesh>

      {/* Glowing ring */}
      <mesh ref={ringRef} position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.5, 0.1, 8, 32]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.8} transparent opacity={0.8} />
      </mesh>

      {/* Center beacon */}
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 1, 16]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.6} />
      </mesh>

      <Text
        position={[0, 1.5, 0]}
        fontSize={0.5}
        color="#22c55e"
        anchorX="center"
        anchorY="middle"
        font="/fonts/GeistMono-Bold.ttf"
      >
        CHARGING HUB
      </Text>
    </group>
  )
}

// Grid floor
function TacticalGrid() {
  return (
    <>
      <Grid
        position={[0, -0.01, 0]}
        args={[100, 100]}
        cellSize={5}
        cellThickness={0.5}
        cellColor="#1a3a5c"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#2a5a8c"
        fadeDistance={80}
        fadeStrength={1}
        infiniteGrid={false}
      />

      {/* Sector labels */}
      {["A", "B", "C", "D"].map((sector, i) => {
        const positions: [number, number, number][] = [
          [-25, 0.1, -25],
          [25, 0.1, -25],
          [-25, 0.1, 25],
          [25, 0.1, 25],
        ]
        return (
          <Text
            key={sector}
            position={positions[i]}
            fontSize={3}
            color="#3b82f6"
            anchorX="center"
            anchorY="middle"
            rotation={[-Math.PI / 2, 0, 0]}
            font="/fonts/GeistMono-Bold.ttf"
          >
            {`SECTOR ${sector}`}
          </Text>
        )
      })}
    </>
  )
}

// Scene content
function SceneContent({
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
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.3} />
      <directionalLight position={[50, 50, 25]} intensity={0.5} />
      <pointLight position={[0, 20, 0]} intensity={0.5} color="#3b82f6" />

      {/* Environment */}
      <fog attach="fog" args={["#0a0a14", 50, 150]} />
      <color attach="background" args={["#0a0a14"]} />

      {/* Grid */}
      <TacticalGrid />

      {/* Charging Hub */}
      <ChargingHub />

      {/* Drones */}
      {drones.map((drone) => (
        <group key={drone.id}>
          <Drone data={drone} onSelect={onSelectDrone} />
          <SearchTrail points={drone.searchPattern} />
        </group>
      ))}

      {/* Victims */}
      {victims.map((victim) => (
        <VictimMarker key={victim.id} data={victim} />
      ))}

      {/* Camera controls */}
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={10}
        maxDistance={100}
        maxPolarAngle={Math.PI / 2.2}
        target={[0, 0, 0]}
      />
    </>
  )
}

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
  return (
    <div className="w-full h-full relative">
      <Canvas
        camera={{ position: [40, 30, 40], fov: 60 }}
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
        <SceneContent
          drones={drones}
          victims={victims}
          selectedDrone={selectedDrone}
          onSelectDrone={onSelectDrone}
        />
      </Canvas>

      {/* HUD overlay */}
      <div className="absolute top-4 left-4 flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-card/80 backdrop-blur border border-border rounded">
          <div className="w-2 h-2 rounded-full bg-chart-1 animate-pulse" />
          <span className="text-xs font-mono text-muted-foreground">LIVE</span>
        </div>
        <div className="px-3 py-1.5 bg-card/80 backdrop-blur border border-border rounded">
          <span className="text-xs font-mono text-muted-foreground">
            GRID: 100x100 | DRONES: {drones.length} | VICTIMS: {victims.filter(v => !v.rescued).length}
          </span>
        </div>
      </div>

      {/* Compass */}
      <div className="absolute bottom-4 right-4 w-16 h-16 rounded-full border border-border bg-card/80 backdrop-blur flex items-center justify-center">
        <div className="relative w-12 h-12">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 text-xs font-mono text-chart-1">N</div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs font-mono text-muted-foreground">S</div>
          <div className="absolute left-0 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground">W</div>
          <div className="absolute right-0 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground">E</div>
        </div>
      </div>
    </div>
  )
}
