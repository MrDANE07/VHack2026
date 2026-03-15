"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import DashboardHeader from "@/components/dashboard-header"
import MissionLog, { LogEntry } from "@/components/mission-log"
import FleetStatus, { DroneStatus } from "@/components/fleet-status"
import VictimAlerts, { VictimAlert } from "@/components/victim-alerts"

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

export interface VictimData {
  id: string
  position: [number, number, number]
  status: "HIDDEN" | "DETECTED" | "RESCUE_OTW" | "RESCUED"
  detectedAt?: number
  trackingDroneId?: string
  rescueDispatchedAt?: number
}

// Initial drone fleet at charging base
const createInitialDrones = (): DroneStatus[] => [
  { id: "DRONE-01", position: [...CHARGING_BASE], status: "IDLE", battery: 95, connected: true, lastSeen: new Date(), assignedSector: null },
  { id: "DRONE-02", position: [...CHARGING_BASE], status: "IDLE", battery: 88, connected: true, lastSeen: new Date(), assignedSector: null },
  { id: "DRONE-03", position: [...CHARGING_BASE], status: "IDLE", battery: 72, connected: true, lastSeen: new Date(), assignedSector: null },
  { id: "DRONE-04", position: [...CHARGING_BASE], status: "IDLE", battery: 65, connected: true, lastSeen: new Date(), assignedSector: null },
  { id: "DRONE-05", position: [...CHARGING_BASE], status: "CHARGING", battery: 30, connected: true, lastSeen: new Date(), assignedSector: null },
  { id: "DRONE-06", position: [...CHARGING_BASE], status: "CHARGING", battery: 15, connected: true, lastSeen: new Date(), assignedSector: null },
]

// Hidden victims to be discovered by thermal scan
const createHiddenVictims = (): VictimData[] => [
  { id: "VIC-001", position: [18, 0, 12], status: "HIDDEN" },
  { id: "VIC-002", position: [40, 0, 8], status: "HIDDEN" },
  { id: "VIC-003", position: [8, 0, 38], status: "HIDDEN" },
  { id: "VIC-004", position: [42, 0, 42], status: "HIDDEN" },
]

export default function DashboardPage() {
  const [drones, setDrones] = useState<DroneStatus[]>(createInitialDrones)
  const [victims, setVictims] = useState<VictimData[]>(createHiddenVictims)
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

  // Initialize mission on mount
  useEffect(() => {
    if (missionStarted) return
    
    const bootSequence = async () => {
      addLog("SYSTEM", "AEGIS SWARM Mission Control initialized.")
      await delay(500)
      addLog("SYSTEM", "Connecting to MCP server...")
      await delay(800)
      addLog("SUCCESS", "MCP connection established. Discovering drone tools...")
      await delay(600)
      addLog("SYSTEM", "6 drones registered. Tools: move_to(), thermal_scan(), return_home(), get_status()")
      await delay(1000)
      addLog("SYSTEM", "Mission instruction received: SEARCH AREA 7 FOR SURVIVORS")
      await delay(800)
      
      // Command agent reasoning
      addLog("REASONING", "Analyzing mission parameters...", "COMMAND")
      await delay(600)
      addLog("REASONING", "Area 7 divided into 4 sectors (A, B, C, D). Assessing drone battery levels for dispatch.", "COMMAND")
      await delay(800)
      addLog("REASONING", "DRONE-05 (30%) and DRONE-06 (15%) have insufficient battery. Keeping at charging base.", "COMMAND")
      await delay(600)
      addLog("REASONING", "Optimal dispatch: DRONE-01(95%) -> Sector A, DRONE-02(88%) -> Sector B, DRONE-03(72%) -> Sector C, DRONE-04(65%) -> Sector D", "COMMAND")
      
      await delay(1000)
      
      // Dispatch drones
      setDrones(prev => prev.map(drone => {
        if (drone.id === "DRONE-01") return { ...drone, status: "SEARCHING" as const, assignedSector: "A", position: SECTORS.A.center }
        if (drone.id === "DRONE-02") return { ...drone, status: "SEARCHING" as const, assignedSector: "B", position: SECTORS.B.center }
        if (drone.id === "DRONE-03") return { ...drone, status: "SEARCHING" as const, assignedSector: "C", position: SECTORS.C.center }
        if (drone.id === "DRONE-04") return { ...drone, status: "SEARCHING" as const, assignedSector: "D", position: SECTORS.D.center }
        return drone
      }))
      
      addLog("ACTION", "Dispatched to Sector A. Initiating thermal scan.", "DRONE-01")
      addLog("ACTION", "Dispatched to Sector B. Initiating thermal scan.", "DRONE-02")
      addLog("ACTION", "Dispatched to Sector C. Initiating thermal scan.", "DRONE-03")
      addLog("ACTION", "Dispatched to Sector D. Initiating thermal scan.", "DRONE-04")
      
      setMissionStarted(true)
    }
    
    bootSequence()
  }, [addLog, missionStarted])

  // WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      const ws = new WebSocket("ws://localhost:8000/ws/drone-control")

      ws.onopen = () => {
        console.log("WebSocket connected")
        setWsConnected(true)
        setConnectionStatus({ websocket: true, lastPing: new Date() })
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === "drone_update" || message.type === "initial_state") {
            // Update drones from backend state
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
        } catch (e) {
          console.error("Error parsing WebSocket message:", e)
        }
      }

      ws.onclose = () => {
        console.log("WebSocket disconnected")
        setWsConnected(false)
        setConnectionStatus({ websocket: false, lastPing: new Date() })
        // Reconnect after 2 seconds
        setTimeout(connectWebSocket, 2000)
      }

      ws.onerror = (error) => {
        console.error("WebSocket error:", error)
      }

      wsRef.current = ws
    }

    connectWebSocket()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

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

          // CHARGING: Increase battery at base
          if (drone.status === "CHARGING") {
            newDrone.battery = Math.min(100, drone.battery + 0.5)
            if (newDrone.battery >= 100 && drone.battery < 100) {
              addLog("SUCCESS", "Fully charged. Status: IDLE, awaiting instructions.", drone.id)
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
          
          // SEARCHING: Move in pattern, drain battery, can detect victims
          if (drone.status === "SEARCHING" && drone.assignedSector) {
            const sector = SECTORS[drone.assignedSector as keyof typeof SECTORS]
            
            // Random movement within sector bounds
            const newX = Math.max(sector.bounds.minX, Math.min(sector.bounds.maxX, drone.position[0] + (Math.random() - 0.5) * 3))
            const newZ = Math.max(sector.bounds.minZ, Math.min(sector.bounds.maxZ, drone.position[2] + (Math.random() - 0.5) * 3))
            
            newDrone.position = [newX, 5, newZ]
            newDrone.battery = Math.max(0, drone.battery - 0.1)
            
            // Check for low battery - RTB needed
            if (newDrone.battery <= LOW_BATTERY_THRESHOLD && drone.battery > LOW_BATTERY_THRESHOLD) {
              const currentSector = drone.assignedSector
              addLog("ALERT", `Battery low (${newDrone.battery.toFixed(0)}%). Must return to base.`, drone.id)
              addLog("REASONING", `${drone.id} battery critical. Initiating RTB protocol.`, "COMMAND")
              
              newDrone.status = "RECALLING"
              newDrone.assignedSector = null
              
              // Try to find replacement for the sector
              const replacement = prev.find(d => d.status === "IDLE" && d.battery > 50)
              if (replacement && currentSector) {
                addLog("REASONING", `Sector ${currentSector} needs coverage. Dispatching ${replacement.id} (${replacement.battery.toFixed(0)}% battery).`, "COMMAND")
                setTimeout(() => {
                  setDrones(d => d.map(dr => {
                    if (dr.id === replacement.id) {
                      return { ...dr, status: "SEARCHING" as const, assignedSector: currentSector, position: sector.center }
                    }
                    return dr
                  }))
                  addLog("ACTION", `Dispatched to Sector ${currentSector}. Resuming search pattern.`, replacement.id)
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

  // Victim detection logic - thermal scan
  useEffect(() => {
    if (!missionStarted) return

    const detectionInterval = setInterval(() => {
      setVictims(prevVictims => {
        return prevVictims.map(victim => {
          // Skip if already detected or rescued
          if (victim.status !== "HIDDEN") return victim
          
          // Check if any SEARCHING drone is close enough to detect via thermal
          const detectingDrone = drones.find(drone => {
            if (drone.status !== "SEARCHING") return false
            const dx = drone.position[0] - victim.position[0]
            const dz = drone.position[2] - victim.position[2]
            const dist = Math.sqrt(dx * dx + dz * dz)
            return dist < 8 // Thermal detection range
          })
          
          if (detectingDrone) {
            // Drone detected victim!
            addLog("ALERT", `THERMAL SIGNATURE DETECTED at [${victim.position[0].toFixed(1)}, ${victim.position[2].toFixed(1)}]!`, detectingDrone.id)
            addLog("REASONING", `${detectingDrone.id} thermal scan positive. Switching to TRACKING mode. Awaiting human dispatch order.`, "COMMAND")
            
            // Update drone to tracking mode
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
            
            addLog("ACTION", `Holding position over victim. Sending distress signal to command. Awaiting rescue team dispatch.`, detectingDrone.id)
            
            // Create alert for human operator
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
  }, [missionStarted, drones, addLog])

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
                  !d.some(dr => dr.assignedSector === s && dr.status === "SEARCHING")
                )
                
                if (availableSector) {
                  addLog("REASONING", `Rescue complete. ${drone.id} battery sufficient (${drone.battery.toFixed(0)}%). Resuming search in Sector ${availableSector}.`, "COMMAND")
                  addLog("ACTION", `Rescue mission complete. Returning to search pattern in Sector ${availableSector}.`, drone.id)
                  return { 
                    ...drone, 
                    status: "SEARCHING" as const, 
                    position: SECTORS[availableSector as keyof typeof SECTORS].center,
                    trackingVictimId: undefined,
                    assignedSector: availableSector
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
  }, [missionStarted, victims, addLog])

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
  const simulationDrones = drones.map((d) => ({
    id: d.id,
    position: d.position,
    status: d.status,
    battery: d.battery,
    searchPattern: d.status === "SEARCHING" && d.assignedSector ? generateSearchPattern(d.position, d.assignedSector) : [],
  }))

  // Convert VictimData for simulation (only show detected/rescue_otw/rescued)
  const simulationVictims = victims.map(v => ({
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
