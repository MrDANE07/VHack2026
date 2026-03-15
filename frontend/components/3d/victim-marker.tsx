"use client"

import { memo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { VictimData } from "./types"

export const VictimMarker = memo(function VictimMarker({ data }: { data: VictimData }) {
  const orbRef   = useRef<THREE.Mesh>(null)
  const ring1Ref = useRef<THREE.Mesh>(null)
  const ring2Ref = useRef<THREE.Mesh>(null)
  const beamRef  = useRef<THREE.Mesh>(null)

  const isRescued   = data.status === "RESCUED" || data.rescued
  const isRescueOTW = data.status === "RESCUE_OTW"
  const color = isRescued ? "#22c55e" : isRescueOTW ? "#f59e0b" : "#ef4444"
  const label = isRescued ? "RESCUED" : isRescueOTW ? "RESCUE OTW" : "DETECTED"

  useFrame((state) => {
    const t = state.clock.elapsedTime

    if (orbRef.current && !isRescued)
      orbRef.current.scale.setScalar(1 + Math.sin(t * 5.5) * 0.18)

    if (ring1Ref.current && !isRescued) {
      const p = (t * 1.2) % 1
      ring1Ref.current.scale.setScalar(1 + p * 2.2)
      ;(ring1Ref.current.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.55 - p * 0.55)
    }

    if (ring2Ref.current && !isRescued) {
      const p = (t * 1.2 + 0.5) % 1
      ring2Ref.current.scale.setScalar(1 + p * 2.2)
      ;(ring2Ref.current.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.55 - p * 0.55)
    }

    if (beamRef.current && !isRescued)
      (beamRef.current.material as THREE.MeshStandardMaterial).opacity = 0.3 + Math.sin(t * 4) * 0.2
  })

  if (data.status === "HIDDEN" || (!data.trackingDroneId && !isRescued && !isRescueOTW)) return null

  const [px, , pz] = data.position

  return (
    <group position={[px, 0, pz]}>
      {/* Expanding pulse rings */}
      <mesh ref={ring1Ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.38, 0.72, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} transparent opacity={0.5} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2Ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.38, 0.72, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} transparent opacity={0.5} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* Ground ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[0.75, 1.15, 32]} />
        <meshStandardMaterial color={color} transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* Marker orb */}
      <mesh ref={orbRef} position={[0, 0.48, 0]}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isRescued ? 0.5 : 2.5} />
      </mesh>

      {/* Vertical beacon beam */}
      {!isRescued && (
        <mesh ref={beamRef} position={[0, 2.8, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 5.5, 6]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} transparent opacity={0.4} depthWrite={false} />
        </mesh>
      )}

      {/* Victim labels removed from WebGL — status shown in the Victim Alerts panel */}
    </group>
  )
})
