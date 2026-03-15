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
  const [connectionStatus, setConnectionStatus] = useState({ websocket: false, lastPing: new Date() })

  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null)
  const pressedKeysRef = useRef<Set<string>>(new Set())

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
  
  const logIdRef = useRef(0)
  const alertIdRef = useRef(0)
  const sectorAssignments = useRef<{ droneId: string; sector: string }[]>([])
  const dronesRef = useRef(drones)
  useEffect(() => { dronesRef.current = drones }, [drones])

  // Add log entry
  const addLog = useCallback((type: LogEntry["type"], message: string, droneId?: string) => {
    const newLog: LogEntry = {
      id: `log-${++logIdRef.current}`,
      timestamp: new Date(),
      type,
      message,
      droneId,
    }
    setLogs((prev) => [...prev, newLog])
  }, [])

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
      addLog("SYSTEM", "AEGIS SWARM Mission Control initialized.")
      await delay(500)
      addLog("SYSTEM", "Connecting to MCP server...")
      await delay(800)
      addLog("SUCCESS", "MCP connection established. Discovering drone tools...")
      await delay(600)

      const onlineCount = config.drones.filter(d => d.online).length
      addLog("SYSTEM", `${onlineCount} drones registered via MCP discovery. Tools: move_to(), thermal_scan(), return_home(), get_status()`)
      await delay(1000)
      addLog("SYSTEM", "Mission instruction received: SEARCH AREA 7 FOR SURVIVORS")
      await delay(800)

      addLog("REASONING", "Analyzing mission parameters...", "COMMAND")
      await delay(600)
      addLog("REASONING", "Area 7 divided into 4 sectors (A, B, C, D). Assessing drone battery levels for dispatch.", "COMMAND")
      await delay(800)

      const sortedOnline = config.drones.filter(d => d.online).sort((a, b) => b.battery - a.battery)

      const lowBat = sortedOnline.filter(d => d.battery < SECTOR_ASSIGN_THRESHOLD)
      if (lowBat.length > 0) {
        addLog("REASONING", `${lowBat.map(d => `${d.id} (${d.battery}%)`).join(", ")} — insufficient battery. Keeping at charging base.`, "COMMAND")
        await delay(600)
      }

      const offline = config.drones.filter(d => !d.online)
      if (offline.length > 0) {
        addLog("REASONING", `${offline.map(d => d.id).join(", ")} — OFFLINE. Excluded from mission.`, "COMMAND")
        await delay(600)
      }

      const dispatchable = sortedOnline.filter(d => d.battery >= SECTOR_ASSIGN_THRESHOLD)
      const assignments: { droneId: string; sector: string; battery: number }[] = []
      for (let i = 0; i < dispatchable.length && i < sectorKeys.length; i++) {
        assignments.push({ droneId: dispatchable[i].id, sector: sectorKeys[i], battery: dispatchable[i].battery })
      }

      sectorAssignments.current = assignments.map(a => ({ droneId: a.droneId, sector: a.sector }))

      if (assignments.length > 0) {
        addLog("REASONING", `Optimal dispatch: ${assignments.map(a => `${a.droneId}(${a.battery}%) -> Sector ${a.sector}`).join(", ")}`, "COMMAND")
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

        for (const a of assignments) {
          addLog("ACTION", `Dispatched to Sector ${a.sector}. Initiating thermal scan.`, a.droneId)
        }
      } else {
        addLog("ALERT", "No drones available for dispatch. All drones are charging or offline.", "COMMAND")
      }

      setMissionStarted(true)
    }

    bootSequence()
  }, [addLog, missionStarted, config])

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
                  manualMode: backendDrone.manualMode,
                }
              }
              return drone
            }))
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        setWsConnected(false)
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
    if (!wsConnected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({
      type: "sync_config",
      config: { drones: config.drones, victims: config.victims },
    }))
  }, [wsConnected, config])

  useEffect(() => {
  // Guard: Ensure we have a socket and a drone selected
  if (!wsRef.current || !selectedDrone) return;

  const validKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "W", "s", "S", "a", "A", "d", "D"];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!validKeys.includes(e.key)) return;

    // Prevent scrolling for arrow keys
    if (e.key.startsWith("Arrow")) e.preventDefault();

    const isSocketReady = wsRef.current?.readyState === WebSocket.OPEN;

    if (isSocketReady && !pressedKeysRef.current.has(e.key)) {
      pressedKeysRef.current.add(e.key);
      wsRef.current?.send(JSON.stringify({
        type: "keydown",
        key: e.key,
        droneId: selectedDrone,
      }));
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (!validKeys.includes(e.key)) return;

    const isSocketReady = wsRef.current?.readyState === WebSocket.OPEN;

    // Only send if the key was actually tracked and socket is live
    if (pressedKeysRef.current.has(e.key)) {
      pressedKeysRef.current.delete(e.key);
      
      if (isSocketReady) {
        wsRef.current?.send(JSON.stringify({
          type: "keyup",
          key: e.key,
          droneId: selectedDrone,
        }));
      }
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  return () => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    // Important: Clear tracking so keys don't "stick" if the effect re-runs
    pressedKeysRef.current.clear();
  };
}, [selectedDrone]); // Effect re-syncs when drone target changes

  // Main simulation loop - drone movement and battery management
  useEffect(() => {
    if (!missionStarted) return

    const interval = setInterval(() => {
      setDrones(prev => {
        const updated = prev.map(drone => {
          // Skip manual drones - backend handles their movement
          if (drone.status === "MANUAL" || drone.manualMode) {
            return { ...drone, lastSeen: new Date() }
          }

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
                addLog("SUCCESS", `Fully charged. Deploying to Sector ${targetSector}.`, drone.id)
                return newDrone
              }
              newDrone.status = "IDLE"
              addLog("SUCCESS", "Fully charged. All sectors covered — awaiting instructions.", drone.id)
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
              addLog("SUCCESS", "Arrived at charging base. Beginning charge cycle.", drone.id)
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
              addLog("ALERT", `Battery critical (${newDrone.battery.toFixed(0)}%) while tracking victim! Requesting handoff via MCP.`, drone.id)
              
              // Find replacement - command agent logic
              const replacement = findBestReplacementDrone(drone.id, drone.position, prev)
              
              if (replacement) {
                addLog("REASONING", `MCP handoff request received from ${drone.id}. Evaluating fleet...`, "COMMAND")
                addLog("REASONING", `Best candidate: ${replacement.id} (${replacement.status}, ${replacement.battery.toFixed(0)}% battery). Dispatching for takeover.`, "COMMAND")
                
                // Schedule replacement dispatch
                setTimeout(() => {
                  setDrones(d => d.map(dr => {
                    if (dr.id === replacement.id) {
                      const currentVictim = victims.find(v => v.trackingDroneId === drone.id)
                      addLog("ACTION", `Taking over victim tracking from ${drone.id} at [${drone.position[0].toFixed(1)}, ${drone.position[2].toFixed(1)}]`, replacement.id)
                      
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
              } else {
                addLog("ALERT", "No available drones for handoff! Victim may lose tracking.", "COMMAND")
              }
              
              // Current drone returns to base
              newDrone.status = "RECALLING"
              newDrone.trackingVictimId = undefined
              addLog("ACTION", "Handoff initiated. Returning to base for charging.", drone.id)
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
              addLog("ACTION", `Arrived at Sector ${drone.assignedSector}. Initiating search pattern.`, drone.id)
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
              addLog("ALERT", `Battery low (${newDrone.battery.toFixed(0)}%). Must return to base.`, drone.id)
              addLog("REASONING", `${drone.id} battery critical. Initiating RTB protocol.`, "COMMAND")
              
              newDrone.status = "RECALLING"
              newDrone.assignedSector = null
              
              const replacement = prev.find(d => d.status === "IDLE" && d.battery > 50)
              if (replacement && currentSector) {
                addLog("REASONING", `Sector ${currentSector} needs coverage. Dispatching ${replacement.id} (${replacement.battery.toFixed(0)}% battery).`, "COMMAND")
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
                  addLog("ACTION", `Dispatched to Sector ${currentSector}. Deploying...`, replacement.id)
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
  }, [missionStarted, addLog, findBestReplacementDrone, victims])

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
            addLog("ALERT", `THERMAL SIGNATURE DETECTED at [${victim.position[0].toFixed(1)}, ${victim.position[2].toFixed(1)}]!`, detectingDrone.id)
            addLog("REASONING", `${detectingDrone.id} thermal scan positive. Switching to TRACKING mode. Awaiting human dispatch order.`, "COMMAND")

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

            addLog("ACTION", "Holding position over victim. Sending distress signal to command. Awaiting rescue team dispatch.", detectingDrone.id)

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
  }, [missionStarted, addLog])

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
          addLog("SUCCESS", `Rescue team has arrived! Victim at [${alert.coordinates[0].toFixed(1)}, ${alert.coordinates[2].toFixed(1)}] secured.`, alert.detectedBy)
          
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
                  addLog("REASONING", `Rescue complete. ${drone.id} battery sufficient (${drone.battery.toFixed(0)}%). Deploying to Sector ${availableSector}.`, "COMMAND")
                  addLog("ACTION", `Rescue mission complete. Deploying to Sector ${availableSector}.`, drone.id)
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
                  addLog("REASONING", `All sectors covered. ${drone.id} returning to IDLE at base.`, "COMMAND")
                  addLog("ACTION", `No sectors need coverage. Returning to base. Status: IDLE.`, drone.id)
                  return { 
                    ...drone, 
                    status: "IDLE" as const, 
                    position: [...CHARGING_BASE],
                    trackingVictimId: undefined,
                    assignedSector: null
                  }
                }
              } else {
                addLog("REASONING", `Rescue complete. ${drone.id} battery low (${drone.battery.toFixed(0)}%). Initiating RTB.`, "COMMAND")
                addLog("ACTION", `Rescue mission complete. Battery low - returning to base for charging.`, drone.id)
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
  }, [missionStarted, addLog])

  // Handle human operator clicking "Acknowledge and Dispatch"
  const handleDispatchRescue = useCallback((alertId: string) => {
    setAlerts(prev => prev.map(alert => {
      if (alert.id === alertId && alert.status === "AWAITING_DISPATCH") {
        addLog("ACTION", `Human operator acknowledged. Rescue team dispatched to [${alert.coordinates[0].toFixed(1)}, ${alert.coordinates[2].toFixed(1)}].`)
        addLog("SYSTEM", `Rescue team ETA: 10 seconds. ${alert.detectedBy} will maintain position until arrival.`)
        
        // Update victim status
        setVictims(v => v.map(vic => 
          vic.id === alert.victimId ? { ...vic, status: "RESCUE_OTW" as const } : vic
        ))
        
        return { 
          ...alert, 
          status: "RESCUE_OTW" as const, 
          rescueCountdown: 10 
        }
      }
      return alert
    }))
  }, [addLog])

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
