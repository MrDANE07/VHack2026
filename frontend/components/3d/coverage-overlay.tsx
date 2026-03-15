"use client"

import { memo, useRef, useMemo, useEffect } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { DroneData, SECTOR_DEFS, COVERAGE_CELLS, CELL_SIZE } from "./types"

export const CoverageOverlay = memo(function CoverageOverlay({
  drones,
}: {
  drones: DroneData[]
}) {
  const meshRef  = useRef<THREE.InstancedMesh>(null)
  const coverage = useRef<Float32Array>(new Float32Array(COVERAGE_CELLS * COVERAGE_CELLS))
  const tmpColor = useRef(new THREE.Color())
  const dummy    = useMemo(() => new THREE.Object3D(), [])
  const black    = useMemo(() => new THREE.Color(0, 0, 0), [])

  // Initialise cell matrices + set every cell to black (= invisible at start)
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    for (let cx = 0; cx < COVERAGE_CELLS; cx++) {
      for (let cz = 0; cz < COVERAGE_CELLS; cz++) {
        const idx = cx * COVERAGE_CELLS + cz
        dummy.position.set(cx * CELL_SIZE + CELL_SIZE / 2, 0.09, cz * CELL_SIZE + CELL_SIZE / 2)
        dummy.rotation.set(-Math.PI / 2, 0, 0)
        dummy.scale.set(CELL_SIZE * 0.88, CELL_SIZE * 0.88, 1)
        dummy.updateMatrix()
        mesh.setMatrixAt(idx, dummy.matrix)
        mesh.setColorAt(idx, black)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

    return () => {
      // Explicit cleanup on unmount
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose())
      } else {
        (mesh.material as THREE.Material)?.dispose()
      }
      mesh.geometry?.dispose()
    }
  }, [dummy, black])

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh?.instanceColor) return
    let dirty = false

    // Mark cells scanned by SEARCHING drones
    for (const drone of drones) {
      if (drone.status !== "SEARCHING") continue
      const [dx, , dz] = drone.position
      const R = 4
      const minCX = Math.max(0, Math.floor((dx - R) / CELL_SIZE))
      const maxCX = Math.min(COVERAGE_CELLS - 1, Math.ceil((dx + R) / CELL_SIZE) - 1)
      const minCZ = Math.max(0, Math.floor((dz - R) / CELL_SIZE))
      const maxCZ = Math.min(COVERAGE_CELLS - 1, Math.ceil((dz + R) / CELL_SIZE) - 1)

      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cz = minCZ; cz <= maxCZ; cz++) {
          const cellCX = cx * CELL_SIZE + CELL_SIZE / 2
          const cellCZ = cz * CELL_SIZE + CELL_SIZE / 2
          if (Math.hypot(dx - cellCX, dz - cellCZ) <= R) {
            const idx = cx * COVERAGE_CELLS + cz
            if (coverage.current[idx] < 1) {
              coverage.current[idx] = Math.min(1, coverage.current[idx] + 0.025)
              dirty = true
            }
          }
        }
      }
    }

    if (!dirty) return

    for (let cx = 0; cx < COVERAGE_CELLS; cx++) {
      for (let cz = 0; cz < COVERAGE_CELLS; cz++) {
        const idx = cx * COVERAGE_CELLS + cz
        const cov = coverage.current[idx]
        if (cov > 0) {
          const worldX = cx * CELL_SIZE + CELL_SIZE / 2
          const worldZ = cz * CELL_SIZE + CELL_SIZE / 2
          // Determine which sector the cell belongs to
          const sectorIdx = (worldX >= 25 ? 1 : 0) + (worldZ >= 25 ? 2 : 0)
          tmpColor.current.set(SECTOR_DEFS[sectorIdx].color)
          tmpColor.current.multiplyScalar(cov * 0.9)
          mesh.setColorAt(idx, tmpColor.current)
        }
      }
    }
    mesh.instanceColor!.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COVERAGE_CELLS * COVERAGE_CELLS]}>
      <planeGeometry />
      {/* color="white" so instance colour is applied unmodified */}
      <meshBasicMaterial color="white" transparent opacity={0.22} depthWrite={false} />
    </instancedMesh>
  )
})
