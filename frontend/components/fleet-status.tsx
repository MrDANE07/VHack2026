"use client"

import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Battery, Wifi, MapPin, Zap, Crosshair } from "lucide-react"

// Calculate current sector from position (x, z coordinates)
// Sectors: A (NW: x<25, z<25), B (NE: x>=25, z<25), C (SW: x<25, z>=25), D (SE: x>=25, z>=25)
function getCurrentSector(x: number, z: number): string | null {
  if (x < 0 || x > 50 || z < 0 || z > 50) return null
  if (x < 25) {
    return z < 25 ? "A" : "C"
  } else {
    return z < 25 ? "B" : "D"
  }
}

export interface DroneStatus {
  id: string
  position: [number, number, number]
  status: "SEARCHING" | "SCANNING" | "RECALLING" | "IDLE" | "CHARGING" | "TRACKING" | "DEPLOYING"
  battery: number
  target?: [number, number, number]
  connected: boolean
  lastSeen: Date
  conflictWarning?: boolean
  assignedSector?: string | null
  trackingVictimId?: string
  searchPatternIndex?: number
  searchWaypoints?: [number, number, number][]
}

const statusConfig: Record<string, { color: string; bgColor: string; label: string }> = {
  SEARCHING: { color: "text-chart-1", bgColor: "bg-chart-1/20 border-chart-1/50", label: "SEARCHING" },
  SCANNING: { color: "text-chart-5", bgColor: "bg-chart-5/20 border-chart-5/50", label: "SCANNING" },
  TRACKING: { color: "text-destructive", bgColor: "bg-destructive/20 border-destructive/50", label: "TRACKING" },
  RECALLING: { color: "text-chart-3", bgColor: "bg-chart-3/20 border-chart-3/50", label: "RTH" },
  IDLE: { color: "text-muted-foreground", bgColor: "bg-muted/50 border-muted-foreground/30", label: "IDLE" },
  CHARGING: { color: "text-chart-4", bgColor: "bg-chart-4/20 border-chart-4/50", label: "CHARGING" },
  DEPLOYING: { color: "text-cyan-400", bgColor: "bg-cyan-400/20 border-cyan-400/50", label: "DEPLOYING" },
}

function DroneCard({
  drone,
  isSelected,
  onSelect,
}: {
  drone: DroneStatus
  isSelected: boolean
  onSelect: () => void
}) {
  const config = drone.connected
    ? statusConfig[drone.status]
    : { color: "text-muted-foreground", bgColor: "bg-muted/30 border-muted-foreground/30", label: "OFFLINE" }
  const isLowBattery = drone.battery < 20
  const isCriticalBattery = drone.battery < 10

  return (
    <button
      onClick={onSelect}
      className={`w-full p-3 rounded border text-left transition-all ${
        isSelected
          ? "bg-primary/10 border-primary"
          : "bg-card border-border hover:border-primary/50"
      } ${!drone.connected ? "opacity-50" : ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              drone.connected ? "bg-chart-4 animate-pulse" : "bg-muted-foreground"
            }`}
          />
          <span className="font-mono text-sm font-bold text-foreground">
            {drone.id}
          </span>
        </div>
        <Badge variant="outline" className={`${config.bgColor} ${config.color} text-xs font-mono border`}>
          {config.label}
        </Badge>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        {/* Battery */}
        <div className="flex items-center gap-1.5">
          <Battery
            className={`w-3.5 h-3.5 ${
              isCriticalBattery
                ? "text-destructive"
                : isLowBattery
                ? "text-chart-3"
                : "text-chart-4"
            }`}
          />
          <div className="flex-1">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isCriticalBattery
                    ? "bg-destructive"
                    : isLowBattery
                    ? "bg-chart-3"
                    : "bg-chart-4"
                }`}
                style={{ width: `${drone.battery}%` }}
              />
            </div>
          </div>
          <span className="text-muted-foreground w-8 text-right">{drone.battery.toFixed(2)}%</span>
        </div>

        {/* Connection */}
        <div className="flex items-center gap-1.5">
          <Wifi
            className={`w-3.5 h-3.5 ${
              drone.connected ? "text-chart-4" : "text-muted-foreground"
            }`}
          />
          <span className="text-muted-foreground">
            {drone.connected ? "LINKED" : "OFFLINE"}
          </span>
        </div>

        {/* Position */}
        <div className="flex items-center gap-1.5 col-span-2">
          <MapPin className="w-3.5 h-3.5 text-chart-1" />
          <span className="text-muted-foreground">
            [{drone.position[0].toFixed(1)}, {drone.position[1].toFixed(1)}, {drone.position[2].toFixed(1)}]
          </span>
        </div>
        
        {/* Sector info - show both assigned and current position-based sector */}
        {(() => {
          const currentSector = getCurrentSector(drone.position[0], drone.position[2])
          const isMismatch = drone.assignedSector && currentSector && drone.assignedSector !== currentSector
          return (
            <div className="flex items-center gap-1.5 col-span-2">
              <Crosshair className={`w-3.5 h-3.5 ${isMismatch ? "text-chart-3" : "text-chart-1"}`} />
              {drone.assignedSector && (
                <span className={`text-xs ${isMismatch ? "text-chart-3" : "text-chart-1"}`}>
                  ASSIGNED: {drone.assignedSector}
                </span>
              )}
              {currentSector && (
                <span className={`text-xs ${isMismatch ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                  {drone.assignedSector ? ` | AT: ${currentSector}` : `SECTOR ${currentSector}`}
                  {isMismatch && " (MISMATCH!)"}
                </span>
              )}
            </div>
          )
        })()}
        
        {/* Tracking indicator */}
        {drone.status === "TRACKING" && drone.trackingVictimId && (
          <div className="flex items-center gap-1.5 col-span-2">
            <span className="text-xs text-destructive animate-pulse">VICTIM LOCK</span>
          </div>
        )}
      </div>

      {/* Warnings */}
      {(isLowBattery || drone.conflictWarning) && (
        <div className="mt-2 pt-2 border-t border-border space-y-1">
          {isLowBattery && (
            <div className="flex items-center gap-1.5 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-chart-3" />
              <span className="text-chart-3 font-mono">LOW BATTERY - RTH ADVISED</span>
            </div>
          )}
          {drone.conflictWarning && (
            <div className="flex items-center gap-1.5 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-chart-3" />
              <span className="text-chart-3 font-mono">SECTOR CONFLICT</span>
            </div>
          )}
        </div>
      )}
    </button>
  )
}

export default function FleetStatus({
  drones,
  selectedDrone,
  onSelectDrone,
}: {
  drones: DroneStatus[]
  selectedDrone: string | null
  onSelectDrone: (id: string) => void
}) {
  const activeDrones = drones.filter((d) => d.connected)
  const totalBattery = activeDrones.length > 0
    ? activeDrones.reduce((acc, d) => acc + d.battery, 0) / activeDrones.length
    : 0

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-chart-1" />
            <h2 className="font-mono text-sm font-bold text-foreground tracking-wider">
              FLEET STATUS
            </h2>
          </div>
          <span className="text-xs font-mono text-muted-foreground">
            MCP DISCOVERY
          </span>
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          Dynamic Tool Registration
        </p>
      </div>

      {/* Stats bar */}
      <div className="px-4 py-2 border-b border-border bg-muted/30">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-mono font-bold text-chart-4">{activeDrones.length}</div>
            <div className="text-xs font-mono text-muted-foreground">ACTIVE</div>
          </div>
          <div>
            <div className="text-lg font-mono font-bold text-chart-1">{drones.length}</div>
            <div className="text-xs font-mono text-muted-foreground">TOTAL</div>
          </div>
          <div>
            <div className={`text-lg font-mono font-bold ${totalBattery < 30 ? "text-chart-3" : "text-chart-4"}`}>
              {totalBattery.toFixed(0)}%
            </div>
            <div className="text-xs font-mono text-muted-foreground">AVG BAT</div>
          </div>
        </div>
      </div>

      {/* Drone list */}
      <ScrollArea className="flex-1 tactical-scrollbar">
        <div className="p-3 space-y-2">
          {drones.map((drone) => (
            <DroneCard
              key={drone.id}
              drone={drone}
              isSelected={selectedDrone === drone.id}
              onSelect={() => onSelectDrone(drone.id)}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border bg-muted/50">
        <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
          <span>WS: localhost:8000</span>
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-chart-4 animate-pulse" />
            <span>CONNECTED</span>
          </div>
        </div>
      </div>
    </div>
  )
}
