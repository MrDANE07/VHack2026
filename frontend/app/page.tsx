"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import DashboardHeader from "@/components/dashboard-header"
import MissionLog, { LogEntry } from "@/components/mission-log"
import FleetStatus, { DroneStatus } from "@/components/fleet-status"
import VictimAlerts, { VictimAlert } from "@/components/victim-alerts"
import SetupWizard, { type SetupConfig } from "@/components/setup-wizard"

// Dynamic import for 3D scene (no SSR)
const DroneSimulation = dynamic(() => import("@/components/drone-simulation"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="font-mono text-xs text-muted-foreground">INITIALIZING 3D ENVIRONMENT...</p>
      </div>
    </div>
  ),
})

// Sector definitions for Area 7
const SECTORS = {
  A: { bounds: { minX: 0, maxX: 25, minZ: 0, maxZ: 25 }, center: [12.5, 5, 12.5] as [number, number, number] },
  B: { bounds: { minX: 25, maxX: 50, minZ: 0, maxZ: 25 }, center: [37.5, 5, 12.5] as [number, number, number] },
  C: { bounds: { minX: 0, maxX: 25, minZ: 25, maxZ: 50 }, center: [12.5, 5, 37.5] as [number, number, number] },
  D: { bounds: { minX: 25, maxX: 50, minZ: 25, maxZ: 50 }, center: [37.5, 5, 37.5] as [number, number, number] },
}

const CHARGING_BASE: [number, number, number] = [0, 2, 0]
const LOW_BATTERY_THRESHOLD = 20
const CRITICAL_BATTERY_THRESHOLD = 15
const SECTOR_ASSIGN_THRESHOLD = 40

export interface VictimData {
  id: string
  position: [number, number, number]
  status: "HIDDEN" | "DETECTED" | "RESCUE_OTW" | "RESCUED"
  detectedAt?: number
  trackingDroneId?: string
  rescueDispatchedAt?: number
}

export default function Page() {
  const [setupConfig, setSetupConfig] = useState<SetupConfig | null>(null)
  if (!setupConfig) return <SetupWizard onComplete={setSetupConfig} />
  return <Dashboard config={setupConfig} />
}

function Dashboard({ config }: { config: SetupConfig }) {
  const [drones, setDrones] = useState<DroneStatus[]>(() =>
    config.drones.map(d => ({
      id: d.id,
      position: [...CHARGING_BASE] as [number, number, number],
      status: (d.online
        ? d.battery < SECTOR_ASSIGN_THRESHOLD ? "CHARGING" as const : "IDLE" as const
        : "IDLE" as const),
      battery: d.battery,
      connected: d.online,
      lastSeen: new Date(),
      assignedSector: null,
    }))
  )
  const [victims, setVictims] = useState<VictimData[]>(() =>
    config.victims.map(v => ({ id: v.id, position: v.position, status: "HIDDEN" as const }))
  )
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [alerts, setAlerts] = useState<VictimAlert[]>([])
  const [selectedDrone, setSelectedDrone] = useState<string | null>(null)
  const [missionStarted, setMissionStarted] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [configSynced, setConfigSynced] = useState(false)  // Track if backend has acknowledged config
  const [connectionStatus, setConnectionStatus] = useState({ websocket: false, lastPing: new Date() })

  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null)

  // Wrapper for setSelectedDrone that also notifies backend
  const handleSelectDrone = useCallback((droneId: string | null) => {
    setSelectedDrone(droneId)
    if (droneId && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "select_drone",
        droneId: droneId,
      }))
    }
  }, [])
  
  const alertIdRef = useRef(0)
  const sectorAssignments = useRef<{ droneId: string; sector: string }[]>([])
  const dronesRef = useRef(drones)
  useEffect(() => { dronesRef.current = drones }, [drones])

  // Find best replacement drone for handoff
  const findBestReplacementDrone = useCallback((
    excludeDroneId: string,
    targetPosition: [number, number, number],
    currentDrones: DroneStatus[]
  ): DroneStatus | null => {
    // Priority: IDLE > SEARCHING, then by battery, then by distance
    const candidates = currentDrones
      .filter(d => d.id !== excludeDroneId && d.battery > 40 && (d.status === "IDLE" || d.status === "SEARCHING"))
      .map(d => {
        const dx = d.position[0] - targetPosition[0]
        const dz = d.position[2] - targetPosition[2]
        const distance = Math.sqrt(dx * dx + dz * dz)
        const statusPriority = d.status === "IDLE" ? 0 : 1
        return { ...d, distance, statusPriority }
      })
      .sort((a, b) => {
        // First sort by status (IDLE first)
        if (a.statusPriority !== b.statusPriority) return a.statusPriority - b.statusPriority
        // Then by battery
        if (Math.abs(a.battery - b.battery) > 10) return b.battery - a.battery
        // Then by distance
        return a.distance - b.distance
      })
    
    return candidates[0] || null
  }, [])

  useEffect(() => {
    if (missionStarted) return

    const sectorKeys = ["A", "B", "C", "D"]

    const bootSequence = async () => {
      await delay(500)
      await delay(800)
      await delay(600)

      const onlineCount = config.drones.filter(d => d.online).length
      await delay(1000)
      await delay(800)

      await delay(600)
      await delay(800)

      const sortedOnline = config.drones.filter(d => d.online).sort((a, b) => b.battery - a.battery)

      const lowBat = sortedOnline.filter(d => d.battery < SECTOR_ASSIGN_THRESHOLD)
      if (lowBat.length > 0) {
        await delay(600)
      }

      const offline = config.drones.filter(d => !d.online)
      if (offline.length > 0) {
        await delay(600)
      }

      const dispatchable = sortedOnline.filter(d => d.battery >= SECTOR_ASSIGN_THRESHOLD)
      const assignments: { droneId: string; sector: string; battery: number }[] = []
      for (let i = 0; i < dispatchable.length && i < sectorKeys.length; i++) {
        assignments.push({ droneId: dispatchable[i].id, sector: sectorKeys[i], battery: dispatchable[i].battery })
      }

      sectorAssignments.current = assignments.map(a => ({ droneId: a.droneId, sector: a.sector }))

      if (assignments.length > 0) {
        await delay(1000)

        setDrones(prev => prev.map(drone => {
          const a = assignments.find(x => x.droneId === drone.id)
          if (a) {
            return {
              ...drone,
              status: "DEPLOYING" as const,
              assignedSector: a.sector,
              searchWaypoints: generateLawnmowerWaypoints(a.sector as keyof typeof SECTORS),
              searchPatternIndex: 0,
            }
          }
          return drone
        }))
      }

      setMissionStarted(true)
    }

    bootSequence()
  }, [missionStarted, config])

  // WebSocket connection (graceful — backend may not be running yet)
  useEffect(() => {
    let retryDelay = 2000
    let retryTimer: ReturnType<typeof setTimeout>
    let disposed = false
    let hasLoggedFailure = false

    const connectWebSocket = () => {
      if (disposed) return

      let ws: WebSocket
      try {
        ws = new WebSocket("ws://localhost:8000/ws/drone-control")
      } catch {
        return
      }

      ws.onopen = () => {
        retryDelay = 2000
        hasLoggedFailure = false
        setWsConnected(true)
        setConfigSynced(false)  // Reset config sync state on reconnect
        setConnectionStatus({ websocket: true, lastPing: new Date() })
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)

          if (message.type === "drone_update" || message.type === "initial_state") {
            const backendDrones = message.drones
            setDrones(prev => prev.map(drone => {
              const backendDrone = backendDrones[drone.id]
              if (backendDrone) {
                return {
                  ...drone,
                  position: backendDrone.position as [number, number, number],
                  status: backendDrone.status as DroneStatus["status"],
                  battery: backendDrone.battery,
                  assignedSector: backendDrone.assignedSector,
                  trackingVictimId: backendDrone.trackingVictimId,
                }
              }
              return drone
            }))

            // Update victims from backend
            if (message.victims) {
              setVictims(prev => prev.map(v => {
                const backendVictim = message.victims[v.id]
                if (backendVictim) {
                  return {
                    ...v,
                    status: backendVictim.detected ? (backendVictim.rescued ? "RESCUED" as const : "DETECTED" as const) : v.status,
                    trackingDroneId: backendVictim.tracking_drone_id || v.trackingDroneId,
                  }
                }
                return v
              }))
            }

            // Update logs from backend (with deduplication)
            if (message.logs && message.logs.length > 0) {
              setLogs(prev => {
                // Create a Set of existing log signatures to avoid duplicates
                const existingSigs = new Set(prev.map(l => `${l.type}:${l.message}:${l.droneId}`))
                const newLogs: LogEntry[] = message.logs
                  .map((l: { type: string; message: string; droneId?: string }, i: number) => ({
                    id: `log-${Date.now()}-${i}`,
                    timestamp: new Date(),
                    type: l.type as LogEntry["type"],
                    message: l.message,
                    droneId: l.droneId,
                  }))
                  .filter((l: { type: any; message: any; droneId: any }) => !existingSigs.has(`${l.type}:${l.message}:${l.droneId ?? ""}`))
                return [...prev, ...newLogs].slice(-100)
              })
            }

            // Update alerts from backend
            if (message.alerts) {
              setAlerts(message.alerts.map((a: any) => ({
                id: a.id,
                victimId: a.victimId,
                timestamp: new Date(),
                coordinates: a.position as [number, number, number],
                detectedBy: a.droneId || "UNKNOWN",
                status: a.status as VictimAlert["status"],
              })))
            }
          }

          // Handle config acknowledgment from backend
          if (message.type === "config_ack") {
            console.log("[AEGIS] Received config_ack from backend:", message)
            setConfigSynced(true)
          }

          if (message.type === "mission_started") {
            setMissionStarted(true)
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        setWsConnected(false)
        setConfigSynced(false)  // Reset config sync state on disconnect
        setConnectionStatus({ websocket: false, lastPing: new Date() })
        if (!disposed) {
          if (!hasLoggedFailure) {
            console.info("[AEGIS] Backend WS not available — running in offline simulation mode. Will retry silently.")
            hasLoggedFailure = true
          }
          retryTimer = setTimeout(connectWebSocket, retryDelay)
          retryDelay = Math.min(retryDelay * 1.5, 30000)
        }
      }

      ws.onerror = () => {
        // Swallow — onclose fires next and handles retry
      }

      wsRef.current = ws
    }

    connectWebSocket()

    return () => {
      disposed = true
      clearTimeout(retryTimer)
      wsRef.current?.close()
    }
  }, [])

  // Send setup config to backend when WebSocket connects
  useEffect(() => {
    if (!wsConnected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log("[AEGIS] Skipping config sync - WebSocket not ready:", { wsConnected, readyState: wsRef.current?.readyState })
      return
    }

    // Add a small delay to ensure WebSocket is fully ready
    const sendConfig = () => {
      // Only send online drones to backend
      const onlineDrones = config.drones.filter((d: { online: boolean }) => d.online)
      const configMessage = JSON.stringify({
        type: "sync_config",
        config: { drones: onlineDrones, victims: config.victims },
      })

      console.log("[AEGIS] Sending config to backend:", { droneCount: onlineDrones.length, victimCount: config.victims.length })

      try {
        wsRef.current?.send(configMessage)
        console.log("[AEGIS] Config sent successfully")
      } catch (error) {
        console.error("[AEGIS] Failed to send config:", error)
        // Retry after a short delay
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            console.log("[AEGIS] Retrying config send...")
            wsRef.current?.send(configMessage)
          }
        }, 1000)
      }
    }

    // Small delay to ensure WebSocket is ready, then send
    const timer = setTimeout(sendConfig, 200)
    return () => clearTimeout(timer)
  }, [wsConnected, config])

  // Send start_mission to backend when mission starts (after config is synced)
  useEffect(() => {
    console.log("[AEGIS] start_mission check:", { missionStarted, configSynced, wsOpen: wsRef.current?.readyState === WebSocket.OPEN })
    if (!missionStarted || !configSynced || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    console.log("[AEGIS] Sending start_mission to backend")
    wsRef.current.send(JSON.stringify({ type: "start_mission" }))
  }, [missionStarted, configSynced])

  // Main simulation loop - drone movement and battery management
  useEffect(() => {
    if (!missionStarted) return

    const interval = setInterval(() => {
      setDrones(prev => {
        const updated = prev.map(drone => {
          let newDrone = { ...drone, lastSeen: new Date() }

          // CHARGING: Increase battery at base, then deploy to an uncovered sector
          if (drone.status === "CHARGING") {
            newDrone.battery = Math.min(100, drone.battery + 0.5)
            if (newDrone.battery >= 100 && drone.battery < 100) {
              const coveredSectors = new Set(
                prev.filter(d => d.id !== drone.id && d.assignedSector &&
                  (d.status === "SEARCHING" || d.status === "TRACKING" || d.status === "DEPLOYING"))
                  .map(d => d.assignedSector)
              )
              const stored = sectorAssignments.current.find(a => a.droneId === drone.id)
              const targetSector = stored && !coveredSectors.has(stored.sector)
                ? stored.sector
                : (["A", "B", "C", "D"] as const).find(s => !coveredSectors.has(s))

              if (targetSector) {
                newDrone.status = "DEPLOYING"
                newDrone.assignedSector = targetSector
                newDrone.searchWaypoints = generateLawnmowerWaypoints(targetSector as keyof typeof SECTORS)
                newDrone.searchPatternIndex = 0
                return newDrone
              }
              newDrone.status = "IDLE"
            }
            newDrone.position = [...CHARGING_BASE]
            return newDrone
          }
          
          // IDLE: Stay at charging base, await instructions
          if (drone.status === "IDLE") {
            newDrone.position = [...CHARGING_BASE]
            return newDrone
          }
          
          // RECALLING (RTB): Move toward charging base
          if (drone.status === "RECALLING") {
            const dx = CHARGING_BASE[0] - drone.position[0]
            const dz = CHARGING_BASE[2] - drone.position[2]
            const dist = Math.sqrt(dx * dx + dz * dz)
            
            if (dist < 2) {
              newDrone.position = [...CHARGING_BASE]
              newDrone.status = "CHARGING"
              newDrone.assignedSector = null
            } else {
              const speed = 1.5
              newDrone.position = [
                drone.position[0] + (dx / dist) * speed,
                CHARGING_BASE[1],
                drone.position[2] + (dz / dist) * speed,
              ]
            }
            newDrone.battery = Math.max(0, drone.battery - 0.05)
            return newDrone
          }
          
          // TRACKING: Stay on victim position, drain battery
          if (drone.status === "TRACKING") {
            newDrone.battery = Math.max(0, drone.battery - 0.08)

            // Check for critical battery during tracking - need MCP handoff
            if (newDrone.battery <= CRITICAL_BATTERY_THRESHOLD && drone.battery > CRITICAL_BATTERY_THRESHOLD) {

              // Find replacement - command agent logic
              const replacement = findBestReplacementDrone(drone.id, drone.position, prev)

              if (replacement) {

                // Schedule replacement dispatch
                setTimeout(() => {
                  setDrones(d => d.map(dr => {
                    if (dr.id === replacement.id) {
                      const currentVictim = victims.find(v => v.trackingDroneId === drone.id)

                      // Update victim's tracking drone
                      if (currentVictim) {
                        setVictims(v => v.map(vic =>
                          vic.id === currentVictim.id ? { ...vic, trackingDroneId: replacement.id } : vic
                        ))
                      }

                      return {
                        ...dr,
                        status: "TRACKING" as const,
                        position: [...drone.position],
                        trackingVictimId: drone.trackingVictimId,
                        assignedSector: null
                      }
                    }
                    return dr
                  }))
                }, 500)
              }

              // Current drone returns to base
              newDrone.status = "RECALLING"
              newDrone.trackingVictimId = undefined
            }
            return newDrone
          }
          
          // DEPLOYING: Fly toward first lawnmower waypoint (or sector center as fallback)
          if (drone.status === "DEPLOYING" && drone.assignedSector) {
            const waypoints = drone.searchWaypoints ?? []
            const target = waypoints[0] ?? SECTORS[drone.assignedSector as keyof typeof SECTORS].center
            const dx = target[0] - drone.position[0]
            const dz = target[2] - drone.position[2]
            const dist = Math.sqrt(dx * dx + dz * dz)
            if (dist < 2) {
              newDrone.status = "SEARCHING"
            } else {
              const speed = 1.5
              newDrone.position = [
                drone.position[0] + (dx / dist) * speed,
                5,
                drone.position[2] + (dz / dist) * speed,
              ]
            }
            newDrone.battery = Math.max(0, drone.battery - 0.05)
            return newDrone
          }

          // SEARCHING: Follow lawnmower waypoints, drain battery
          if (drone.status === "SEARCHING" && drone.assignedSector) {
            const waypoints = drone.searchWaypoints ?? []
            const idx = drone.searchPatternIndex ?? 0

            if (waypoints.length === 0 || idx >= waypoints.length) {
              newDrone.searchPatternIndex = 0
            } else {
              const target = waypoints[idx]
              const dx = target[0] - drone.position[0]
              const dz = target[2] - drone.position[2]
              const dist = Math.sqrt(dx * dx + dz * dz)

              if (dist < 1.5) {
                newDrone.searchPatternIndex = idx + 1
              } else {
                const speed = 1.2
                newDrone.position = [
                  drone.position[0] + (dx / dist) * speed,
                  5,
                  drone.position[2] + (dz / dist) * speed,
                ]
              }
            }
            newDrone.battery = Math.max(0, drone.battery - 0.1)

            // Check for low battery - RTB needed
            if (newDrone.battery <= LOW_BATTERY_THRESHOLD && drone.battery > LOW_BATTERY_THRESHOLD) {
              const currentSector = drone.assignedSector

              newDrone.status = "RECALLING"
              newDrone.assignedSector = null

              const replacement = prev.find(d => d.status === "IDLE" && d.battery > 50)
              if (replacement && currentSector) {
                setTimeout(() => {
                  setDrones(d => d.map(dr => {
                    if (dr.id === replacement.id) {
                      const wp = generateLawnmowerWaypoints(currentSector as keyof typeof SECTORS)
                      return {
                        ...dr,
                        status: "DEPLOYING" as const,
                        assignedSector: currentSector,
                        searchWaypoints: wp,
                        searchPatternIndex: findNearestWaypointIndex(dr.position, wp),
                      }
                    }
                    return dr
                  }))
                }, 500)
              }
            }
          }
          
          return newDrone
        })
        
        return updated
      })
    }, 500)

    return () => clearInterval(interval)
  }, [missionStarted, findBestReplacementDrone, victims])

  // Victim detection logic — reads dronesRef so the interval is stable
  useEffect(() => {
    if (!missionStarted) return

    const detectionInterval = setInterval(() => {
      setVictims(prevVictims => {
        return prevVictims.map(victim => {
          if (victim.status !== "HIDDEN") return victim

          const currentDrones = dronesRef.current
          const detectingDrone = currentDrones.find(drone => {
            if (drone.status !== "SEARCHING") return false
            const dx = drone.position[0] - victim.position[0]
            const dz = drone.position[2] - victim.position[2]
            const dist = Math.sqrt(dx * dx + dz * dz)
            return dist < 4
          })

          if (detectingDrone) {

            setDrones(prev => prev.map(d => {
              if (d.id === detectingDrone.id) {
                return {
                  ...d,
                  status: "TRACKING" as const,
                  position: [victim.position[0], 3, victim.position[2]],
                  trackingVictimId: victim.id,
                  assignedSector: null
                }
              }
              return d
            }))

            const newAlert: VictimAlert = {
              id: `alert-${++alertIdRef.current}`,
              victimId: victim.id,
              timestamp: new Date(),
              coordinates: victim.position,
              detectedBy: detectingDrone.id,
              status: "AWAITING_DISPATCH",
            }
            setAlerts(prev => [newAlert, ...prev])

            return {
              ...victim,
              status: "DETECTED",
              detectedAt: Date.now(),
              trackingDroneId: detectingDrone.id
            }
          }

          return victim
        })
      })
    }, 1000)

    return () => clearInterval(detectionInterval)
  }, [missionStarted])

  // Rescue countdown timer - runs after human dispatches rescue team
  useEffect(() => {
    if (!missionStarted) return

    const rescueInterval = setInterval(() => {
      setAlerts(prev => prev.map(alert => {
        // Only countdown if rescue team has been dispatched
        if (alert.status !== "RESCUE_OTW" || alert.rescueCountdown === undefined) return alert
        
        const newCountdown = alert.rescueCountdown - 1
        
        if (newCountdown <= 0) {
          // Rescue complete!
          const victim = victims.find(v => v.id === alert.victimId)

          // Mark victim as rescued
          setVictims(v => v.map(vic =>
            vic.id === alert.victimId ? { ...vic, status: "RESCUED" as const, trackingDroneId: undefined } : vic
          ))

          // Tracking drone: continue searching if battery sufficient, else RTB
          setDrones(d => d.map(drone => {
            if (drone.trackingVictimId === alert.victimId && drone.status === "TRACKING") {
              if (drone.battery > LOW_BATTERY_THRESHOLD) {
                // Find a sector to search or go back to previous
                const availableSector = Object.keys(SECTORS).find(s =>
                  !d.some(dr => dr.assignedSector === s && (dr.status === "SEARCHING" || dr.status === "DEPLOYING"))
                )

                if (availableSector) {
                  const wp = generateLawnmowerWaypoints(availableSector as keyof typeof SECTORS)
                  return {
                    ...drone,
                    status: "DEPLOYING" as const,
                    trackingVictimId: undefined,
                    assignedSector: availableSector,
                    searchWaypoints: wp,
                    searchPatternIndex: findNearestWaypointIndex(drone.position, wp),
                  }
                } else {
                  return {
                    ...drone,
                    status: "IDLE" as const,
                    position: [...CHARGING_BASE],
                    trackingVictimId: undefined,
                    assignedSector: null
                  }
                }
              } else {
                return {
                  ...drone,
                  status: "RECALLING" as const,
                  trackingVictimId: undefined,
                  assignedSector: null
                }
              }
            }
            return drone
          }))

          return { ...alert, status: "RESCUED" as const, rescueCountdown: 0 }
        }
        
        return { ...alert, rescueCountdown: newCountdown }
      }))
    }, 1000)

    return () => clearInterval(rescueInterval)
  }, [missionStarted])

  // Handle human operator clicking "Acknowledge and Dispatch"
  const handleDispatchRescue = useCallback((alertId: string) => {
    const alert = alerts.find(a => a.id === alertId)
    if (!alert || alert.status !== "AWAITING_DISPATCH") return

    // Send rescue_dispatch to backend - backend handles the rest
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "rescue_dispatch",
        victimId: alert.victimId,
      }))
    }
  }, [alerts])

  // Handle alert dismissal
  const handleDismissAlert = useCallback((alertId: string) => {
    setAlerts(prev => prev.filter(alert => alert.id !== alertId))
  }, [])

  // Convert DroneStatus to simulation format
  const simulationDrones = drones.filter(d => d.connected).map((d) => ({
    id: d.id,
    position: d.position,
    status: d.status,
    battery: d.battery,
    searchPattern: d.status === "SEARCHING" && d.assignedSector ? generateSearchPattern(d.position, d.assignedSector) : [],
  }))

  // Convert VictimData for simulation (only show detected/rescue_otw/rescued)
  const simulationVictims = victims
    .filter(v => v.status !== "HIDDEN")
    .map(v => ({
      id: v.id,
      position: v.position,
      rescued: v.status === "RESCUED",
      trackingDroneId: v.trackingDroneId,
      status: v.status,
    }))

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <DashboardHeader connectionStatus={connectionStatus} />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Mission Log */}
        <aside className="w-80 hidden lg:block">
          <MissionLog logs={logs} />
        </aside>

        {/* Center - 3D Simulation */}
        <main className="flex-1 relative">
          <DroneSimulation
            drones={simulationDrones}
            victims={simulationVictims}
            selectedDrone={selectedDrone}
            onSelectDrone={handleSelectDrone}
          />

          {/* Victim Alerts Overlay (bottom left) */}
          <div className="absolute bottom-4 left-4 w-80 hidden lg:block">
            <div className="bg-card/95 backdrop-blur border border-border rounded-lg p-3">
              <VictimAlerts
                alerts={alerts}
                onDispatchRescue={handleDispatchRescue}
                onDismiss={handleDismissAlert}
              />
            </div>
          </div>
        </main>

        {/* Right Panel - Fleet Status */}
        <aside className="w-80 hidden md:block">
          <FleetStatus
            drones={drones}
            selectedDrone={selectedDrone}
            onSelectDrone={handleSelectDrone}
          />
        </aside>
      </div>
    </div>
  )
}

// Helper delay function
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function generateLawnmowerWaypoints(
  sector: keyof typeof SECTORS,
  altitude: number = 5,
  spacing: number = 4,
): [number, number, number][] {
  const { bounds } = SECTORS[sector]
  const waypoints: [number, number, number][] = []
  let row = 0
  for (let z = bounds.minZ + 2; z <= bounds.maxZ - 2; z += spacing) {
    if (row % 2 === 0) {
      for (let x = bounds.minX + 2; x <= bounds.maxX - 2; x += spacing) {
        waypoints.push([x, altitude, z])
      }
    } else {
      for (let x = bounds.maxX - 2; x >= bounds.minX + 2; x -= spacing) {
        waypoints.push([x, altitude, z])
      }
    }
    row++
  }
  return waypoints
}

function findNearestWaypointIndex(
  position: [number, number, number],
  waypoints: [number, number, number][]
): number {
  let nearest = 0
  let nearestDist = Infinity
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i][0] - position[0]
    const dz = waypoints[i][2] - position[2]
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d < nearestDist) { nearestDist = d; nearest = i }
  }
  return nearest
}

// Helper to generate search pattern trails
function generateSearchPattern(
  position: [number, number, number],
  sector: string
): [number, number, number][] {
  const sectorData = SECTORS[sector as keyof typeof SECTORS]
  if (!sectorData) return []

  const pattern: [number, number, number][] = []
  const [x, y, z] = position

  for (let i = 0; i < 8; i++) {
    const offsetX = (i % 2 === 0 ? 3 : -3)
    const offsetZ = i * 2
    pattern.push([
      Math.max(sectorData.bounds.minX, Math.min(sectorData.bounds.maxX, x + offsetX)),
      y,
      Math.max(sectorData.bounds.minZ, Math.min(sectorData.bounds.maxZ, z - offsetZ))
    ])
  }

  return pattern
}
