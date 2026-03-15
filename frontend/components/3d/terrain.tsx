"use client"

import { memo, useRef, useMemo, useEffect } from "react"
import { useFrame } from "@react-three/fiber"
import { Html, Line, Grid } from "@react-three/drei"
import * as THREE from "three"
import { SECTOR_DEFS, seededRng } from "./types"

// Re-export so the parent can import SECTOR_DEFS from this module
export { SECTOR_DEFS } from "./types"

// ─── Tactical Ground ──────────────────────────────────────────────────────────

export const TacticalGround = memo(function TacticalGround() {
  const dividers: [number, number, number][][] = [
    [[25, 0.1, 0], [25, 0.1, 50]],
    [[0, 0.1, 25], [50, 0.1, 25]],
  ]
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[25, -0.06, 25]}>
        <planeGeometry args={[56, 56]} />
        <meshStandardMaterial color="#030810" roughness={1} />
      </mesh>
      <Grid
        position={[25, 0.01, 25]}
        args={[50, 50]}
        cellSize={5}
        cellThickness={0.4}
        cellColor="#0d1e2e"
        sectionSize={25}
        sectionThickness={1}
        sectionColor="#1a3a5c"
        fadeDistance={100}
        fadeStrength={1}
        infiniteGrid={false}
      />
      {dividers.map((pts, i) => (
        <Line key={i} points={pts} color="#2a5a8c" lineWidth={1.5} transparent opacity={0.7} />
      ))}
      <Line
        points={[[0,0.12,0],[50,0.12,0],[50,0.12,50],[0,0.12,50],[0,0.12,0]]}
        color="#2a5a8c"
        lineWidth={2}
      />
    </group>
  )
})

// ─── Sector Zone ──────────────────────────────────────────────────────────────

export const SectorZone = memo(function SectorZone({ def }: { def: typeof SECTOR_DEFS[0] }) {
  const fillRef = useRef<THREE.Mesh>(null)
  const cx = def.ox + 12.5
  const cz = def.oz + 12.5

  useFrame((state) => {
    if (fillRef.current) {
      const mat = fillRef.current.material as THREE.MeshStandardMaterial
      mat.opacity = 0.04 + Math.sin(state.clock.elapsedTime * 0.45 + def.ox * 0.06) * 0.015
    }
  })

  const border: [number, number, number][] = [
    [def.ox + 0.15,  0.12, def.oz + 0.15],
    [def.ox + 24.85, 0.12, def.oz + 0.15],
    [def.ox + 24.85, 0.12, def.oz + 24.85],
    [def.ox + 0.15,  0.12, def.oz + 24.85],
    [def.ox + 0.15,  0.12, def.oz + 0.15],
  ]

  return (
    <group>
      <mesh ref={fillRef} rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.02, cz]}>
        <planeGeometry args={[25, 25]} />
        <meshStandardMaterial color={def.color} transparent opacity={0.04} depthWrite={false} />
      </mesh>
      <Line points={border} color={def.color} lineWidth={1.1} transparent opacity={0.35} />
      {/* Html label — no WebGL shader, zero GPU compilation cost */}
      <Html position={[cx, 0.3, cz]} center distanceFactor={60} style={{ pointerEvents: "none", userSelect: "none" }}>
        <div style={{ color: def.color, fontFamily: "monospace", fontSize: "13px", fontWeight: "bold", opacity: 0.35, whiteSpace: "nowrap", letterSpacing: "0.1em" }}>
          SECTOR {def.id}
        </div>
      </Html>
      {([
        [def.ox + 0.2,  0.12, def.oz + 0.2],
        [def.ox + 24.8, 0.12, def.oz + 0.2],
        [def.ox + 0.2,  0.12, def.oz + 24.8],
        [def.ox + 24.8, 0.12, def.oz + 24.8],
      ] as [number, number, number][]).map((pos, i) => (
        <mesh key={i} position={pos} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.18, 0.32, 8]} />
          <meshStandardMaterial color={def.color} emissive={def.color} emissiveIntensity={0.8} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
})

// ─── Roads ────────────────────────────────────────────────────────────────────

const Roads = memo(function Roads() {
  const ewDashes = useMemo(() => {
    const arr: [number, number, number][] = []
    for (let x = 3; x < 50; x += 4) arr.push([x, 0.15, 16.5])
    return arr
  }, [])
  const nsDashes = useMemo(() => {
    const arr: [number, number, number][] = []
    for (let z = 3; z < 50; z += 4) arr.push([21.5, 0.15, z])
    return arr
  }, [])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[25, 0.05, 16.5]}>
        <planeGeometry args={[50, 3.5]} />
        <meshStandardMaterial color="#0b141d" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[21.5, 0.05, 25]}>
        <planeGeometry args={[3.5, 50]} />
        <meshStandardMaterial color="#0b141d" roughness={0.95} />
      </mesh>
      <Line points={[[0,0.07,15],[50,0.07,15]]} color="#1a2e40" lineWidth={0.6} transparent opacity={0.5} />
      <Line points={[[0,0.07,18],[50,0.07,18]]} color="#1a2e40" lineWidth={0.6} transparent opacity={0.5} />
      <Line points={[[20,0.07,0],[20,0.07,50]]} color="#1a2e40" lineWidth={0.6} transparent opacity={0.5} />
      <Line points={[[23,0.07,0],[23,0.07,50]]} color="#1a2e40" lineWidth={0.6} transparent opacity={0.5} />
      {ewDashes.map((pos, i) => (
        <mesh key={`ew-${i}`} position={pos} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2, 0.18]} />
          <meshStandardMaterial color="#1e3040" />
        </mesh>
      ))}
      {nsDashes.map((pos, i) => (
        <mesh key={`ns-${i}`} position={pos} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.18, 2]} />
          <meshStandardMaterial color="#1e3040" />
        </mesh>
      ))}
    </group>
  )
})

// ─── Collapsed Building ───────────────────────────────────────────────────────

const CollapsedBuilding = memo(function CollapsedBuilding({
  x, z, angle = 0, size = 1,
}: {
  x: number; z: number; angle?: number; size?: number
}) {
  const debris = useMemo(() => {
    const rng = seededRng(Math.floor(x * 997 + z * 331))
    return Array.from({ length: 7 }, () => ({
      px: (rng() - 0.5) * 8 * size,
      py: rng() * 0.5 * size,
      pz: (rng() - 0.5) * 5 * size,
      rx: rng() * 0.9,
      ry: rng() * Math.PI,
      rz: rng() * 0.9,
      sx: (0.5 + rng() * 1.4) * size,
      sy: (0.15 + rng() * 0.7) * size,
      sz: (0.4 + rng() * 1.1) * size,
    }))
  }, [x, z, size])

  const lean = useMemo(() => {
    const rng = seededRng(Math.floor(x * 777 + z * 333))
    return (rng() - 0.5) * 0.18
  }, [x, z])

  const w = 9 * size
  const d = 6 * size

  return (
    <group position={[x, 0, z]} rotation={[0, angle, 0]}>
      <mesh position={[0, 0.1 * size, 0]}>
        <boxGeometry args={[w, 0.25 * size, d]} />
        <meshStandardMaterial color="#0c1820" roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.6 * size, -d * 0.47]} rotation={[lean, 0, 0]}>
        <boxGeometry args={[w * 0.9, 3.2 * size, 0.38 * size]} />
        <meshStandardMaterial color="#101d2b" roughness={0.9} />
      </mesh>
      <mesh position={[-w * 0.47, 0.9 * size, 0]} rotation={[0, 0, lean * 0.7]}>
        <boxGeometry args={[0.38 * size, 1.8 * size, d * 0.8]} />
        <meshStandardMaterial color="#0f1b28" roughness={0.9} />
      </mesh>
      <mesh position={[w * 0.1, 0.45 * size, d * 0.1]} rotation={[0.45, 0.1, -0.2]}>
        <boxGeometry args={[w * 0.65, 0.28 * size, d * 0.7]} />
        <meshStandardMaterial color="#0d1a26" roughness={0.9} />
      </mesh>
      {debris.map((db, i) => (
        <mesh key={i} position={[db.px, db.py, db.pz]} rotation={[db.rx, db.ry, db.rz]}>
          <boxGeometry args={[db.sx, db.sy, db.sz]} />
          <meshStandardMaterial color="#0b1520" roughness={1} />
        </mesh>
      ))}
    </group>
  )
})

// ─── Disaster Environment ─────────────────────────────────────────────────────

export const DisasterEnvironment = memo(function DisasterEnvironment() {
  return (
    <group>
      <Roads />
      {/* Buildings placed near victim coordinates for narrative context */}
      <CollapsedBuilding x={13} z={9}  angle={0.15}  size={1.0} />
      <CollapsedBuilding x={37} z={5}  angle={-0.3}  size={1.1} />
      <CollapsedBuilding x={6}  z={35} angle={0.4}   size={0.9} />
      <CollapsedBuilding x={43} z={45} angle={-0.2}  size={1.2} />
      <CollapsedBuilding x={30} z={33} angle={1.1}   size={0.8} />
    </group>
  )
})

// ─── Debris Field (instanced mesh) ────────────────────────────────────────────

export const DebrisField = memo(function DebrisField() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy   = useMemo(() => new THREE.Object3D(), [])

  const items = useMemo(() => {
    const rng = seededRng(0xdead)
    const out: { x: number; z: number; sx: number; sy: number; sz: number; ry: number }[] = []
    let tries = 0
    while (out.length < 35 && tries < 300) {
      tries++
      const x = 1.5 + rng() * 47
      const z = 1.5 + rng() * 47
      if (x < 9 && z < 9) continue
      out.push({ x, z, sx: 0.35 + rng() * 1.8, sy: 0.1 + rng() * 1.2, sz: 0.35 + rng() * 1.8, ry: rng() * Math.PI * 2 })
    }
    return out
  }, [])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    items.forEach((d, i) => {
      dummy.position.set(d.x, d.sy / 2, d.z)
      dummy.rotation.set(0, d.ry, 0)
      dummy.scale.set(d.sx, d.sy, d.sz)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true

    return () => {
      // Explicit cleanup — R3F also disposes declarative children on unmount
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose())
      } else {
        (mesh.material as THREE.Material)?.dispose()
      }
      mesh.geometry?.dispose()
    }
  }, [items, dummy])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, items.length]}>
      <boxGeometry />
      <meshStandardMaterial color="#0d1520" roughness={0.95} />
    </instancedMesh>
  )
})

// ─── Charging Hub ─────────────────────────────────────────────────────────────

export const ChargingHub = memo(function ChargingHub() {
  const outerRing = useRef<THREE.Mesh>(null)
  const innerRing = useRef<THREE.Mesh>(null)
  const beacon    = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (outerRing.current) outerRing.current.rotation.z =  t * 0.3
    if (innerRing.current) innerRing.current.rotation.z = -t * 0.6
    if (beacon.current) {
      const mat = beacon.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 0.8 + Math.sin(t * 2.5) * 0.5
    }
  })

  const pads: [number, number][] = [
    [-1.7, -1.5], [0, -1.5], [1.7, -1.5],
    [-1.7,  1.5], [0,  1.5], [1.7,  1.5],
  ]

  return (
    <group>
      <mesh position={[0, -0.1, 0]}>
        <cylinderGeometry args={[5, 5.5, 0.2, 6]} />
        <meshStandardMaterial color="#071a0a" emissive="#10b981" emissiveIntensity={0.06} metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh ref={outerRing} position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[4.3, 0.1, 8, 48]} />
        <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={2} />
      </mesh>
      <mesh ref={innerRing} position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.8, 0.07, 8, 36]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1.2} transparent opacity={0.85} />
      </mesh>
      <Line points={[[-4.8,0.06,0],[4.8,0.06,0]]} color="#10b981" lineWidth={0.5} transparent opacity={0.25} />
      <Line points={[[0,0.06,-4.8],[0,0.06,4.8]]} color="#10b981" lineWidth={0.5} transparent opacity={0.25} />
      {pads.map((pos, i) => (
        <group key={i} position={[pos[0], 0.05, pos[1]]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.38, 0.58, 6]} />
            <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.4} side={THREE.DoubleSide} />
          </mesh>
          {/* Pad number removed — troika-three-text causes WebGL context loss with many instances */}
        </group>
      ))}
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.1, 0.16, 1.2, 8]} />
        <meshStandardMaterial color="#0b2210" metalness={0.6} emissive="#10b981" emissiveIntensity={0.2} />
      </mesh>
      <mesh ref={beacon} position={[0, 1.3, 0]}>
        <sphereGeometry args={[0.2, 12, 12]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1} />
      </mesh>
      <Html position={[0, 2.1, 0]} center distanceFactor={40} style={{ pointerEvents: "none", userSelect: "none" }}>
        <div style={{ color: "#22c55e", fontFamily: "monospace", fontSize: "11px", fontWeight: "bold", whiteSpace: "nowrap", letterSpacing: "0.08em" }}>
          CHARGING HUB
        </div>
      </Html>
    </group>
  )
})
