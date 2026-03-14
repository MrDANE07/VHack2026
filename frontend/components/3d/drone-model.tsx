"use client"

import { memo, useRef, useState } from "react"
import { useFrame } from "@react-three/fiber"
import { Line } from "@react-three/drei"
import * as THREE from "three"
import { DroneData, STATUS_COLORS } from "./types"

// ─── Individual Drone ─────────────────────────────────────────────────────────

export const Drone = memo(function Drone({
  data,
  onSelect,
}: {
  data: DroneData
  onSelect: (id: string) => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  // Four individual prop refs — avoids hook-in-array anti-pattern
  const prop0 = useRef<THREE.Mesh>(null)
  const prop1 = useRef<THREE.Mesh>(null)
  const prop2 = useRef<THREE.Mesh>(null)
  const prop3 = useRef<THREE.Mesh>(null)
  const coneRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const color     = STATUS_COLORS[data.status] || "#3b82f6"
  const bodyColor = data.battery < 20 ? "#f59e0b" : color
  const isActive   = data.status !== "IDLE" && data.status !== "CHARGING"
  const isTracking = data.status === "TRACKING"
  const isScanning = data.status === "SEARCHING" || data.status === "SCANNING"

  useFrame((state) => {
    if (!groupRef.current) return
    const t = state.clock.elapsedTime
    const bob = isActive ? Math.sin(t * 2.8 + data.position[0] * 0.4) * 0.12 : 0
    groupRef.current.position.set(data.position[0], data.position[1] + bob, data.position[2])

    const spin = isActive ? 0.35 : 0.04
    for (const p of [prop0, prop1, prop2, prop3]) {
      if (p.current) p.current.rotation.y += spin
    }

    if (coneRef.current) {
      coneRef.current.rotation.y += isTracking ? 0.04 : 0.018
      const mat = coneRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = isTracking
        ? 0.8 + Math.sin(t * 7) * 0.5
        : 0.3 + Math.sin(t * 1.8) * 0.15
    }
  })

  const armDirs: [number, number, number][] = [
    [ 0.65, 0,  0.65], [-0.65, 0,  0.65],
    [ 0.65, 0, -0.65], [-0.65, 0, -0.65],
  ]
  const propRefs = [prop0, prop1, prop2, prop3]

  return (
    <group
      ref={groupRef}
      onClick={() => onSelect(data.id)}
      onPointerOver={() => { setHovered(true);  document.body.style.cursor = "pointer" }}
      onPointerOut ={() => { setHovered(false); document.body.style.cursor = "auto" }}
    >
      {/* Body */}
      <mesh>
        <cylinderGeometry args={[0.33, 0.26, 0.22, 8]} />
        <meshStandardMaterial
          color={bodyColor}
          emissive={bodyColor}
          emissiveIntensity={hovered ? 1.1 : 0.55}
          metalness={0.6}
          roughness={0.35}
        />
      </mesh>

      {/* Canopy dome */}
      <mesh position={[0, 0.15, 0]}>
        <sphereGeometry args={[0.21, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color={bodyColor} emissive={bodyColor} emissiveIntensity={0.22} transparent opacity={0.6} />
      </mesh>

      {/* Arms + motors + propellers */}
      {armDirs.map((dir, i) => (
        <group key={i}>
          <mesh position={[dir[0] / 2, 0, dir[2] / 2]} rotation={[0, Math.atan2(dir[0], dir[2]), 0]}>
            <boxGeometry args={[0.065, 0.055, 0.9]} />
            <meshStandardMaterial color="#121c2a" metalness={0.7} roughness={0.35} />
          </mesh>
          <group position={dir}>
            <mesh>
              <cylinderGeometry args={[0.1, 0.09, 0.09, 8]} />
              <meshStandardMaterial color="#0a0f18" metalness={0.85} />
            </mesh>
            <mesh ref={propRefs[i]} position={[0, 0.06, 0]}>
              <cylinderGeometry args={[0.38, 0.38, 0.02, 10]} />
              <meshStandardMaterial color={bodyColor} emissive={bodyColor} emissiveIntensity={0.18} transparent opacity={0.55} />
            </mesh>
          </group>
        </group>
      ))}

      {/* Status LED (underside) */}
      <mesh position={[0, -0.14, 0]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.8} />
      </mesh>

      {/* Thermal scan / tracking cone */}
      {(isScanning || isTracking) && (
        <mesh ref={coneRef} position={[0, -2.5, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={isTracking ? [1.0, 4.8, 16, 1, true] : [2.0, 4.8, 16, 1, true]} />
          <meshStandardMaterial
            color={isTracking ? "#ef4444" : "#22c55e"}
            emissive={isTracking ? "#ef4444" : "#22c55e"}
            emissiveIntensity={0.4}
            transparent
            opacity={isTracking ? 0.4 : 0.14}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Battery bar */}
      <group position={[0, 0.47, 0]}>
        <mesh>
          <boxGeometry args={[0.5, 0.055, 0.055]} />
          <meshStandardMaterial color="#0c1520" />
        </mesh>
        <mesh position={[-(0.5 - (data.battery / 100) * 0.5) / 2, 0, 0]}>
          <boxGeometry args={[(data.battery / 100) * 0.5, 0.046, 0.046]} />
          <meshStandardMaterial
            color={data.battery < 20 ? "#ef4444" : data.battery < 50 ? "#f59e0b" : "#22c55e"}
            emissive={data.battery < 20 ? "#ef4444" : data.battery < 50 ? "#f59e0b" : "#22c55e"}
            emissiveIntensity={0.8}
          />
        </mesh>
      </group>
    </group>
  )
})

// ─── Search Trail ─────────────────────────────────────────────────────────────

export const SearchTrail = memo(function SearchTrail({
  points,
}: {
  points: [number, number, number][]
}) {
  if (points.length < 2) return null
  return (
    <Line
      points={points}
      color="#1d4ed8"
      lineWidth={1}
      transparent
      opacity={0.22}
      dashed
      dashSize={0.8}
      gapSize={0.4}
    />
  )
})

// ─── Flight Paths (hub → each deployed drone) ─────────────────────────────────

export const FlightPaths = memo(function FlightPaths({
  drones,
}: {
  drones: DroneData[]
}) {
  const HUB: [number, number, number] = [0, 1.3, 0]
  return (
    <>
      {drones
        .filter((d) => d.status === "SEARCHING" || d.status === "TRACKING" || d.status === "RECALLING")
        .map((d) => (
          <Line
            key={d.id}
            points={[HUB, d.position]}
            color={STATUS_COLORS[d.status] || "#3b82f6"}
            lineWidth={0.8}
            transparent
            opacity={0.18}
            dashed
            dashSize={2}
            gapSize={1}
          />
        ))}
    </>
  )
})
