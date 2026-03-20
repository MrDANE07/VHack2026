"use client"

import { useState, useEffect } from "react"
import { X, MapPin, Radio, Clock, AlertTriangle, Timer, Send } from "lucide-react"
import { Button } from "@/components/ui/button"

export interface VictimAlert {
  id: string
  victimId: string
  timestamp: Date
  coordinates: [number, number, number]
  detectedBy: string
  status: "AWAITING_DISPATCH" | "RESCUE_OTW" | "RESCUED"
  rescueCountdown?: number
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function AlertToast({
  alert,
  onDispatchRescue,
  onDismiss,
}: {
  alert: VictimAlert
  onDispatchRescue: () => void
  onDismiss: () => void
}) {
  const [timeAgo, setTimeAgo] = useState(formatTimeAgo(alert.timestamp))

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeAgo(formatTimeAgo(alert.timestamp))
    }, 1000)
    return () => clearInterval(interval)
  }, [alert.timestamp])

  const isRescued = alert.status === "RESCUED"
  const isRescueOTW = alert.status === "RESCUE_OTW"
  const isAwaiting = alert.status === "AWAITING_DISPATCH"

  return (
    <div
      className={`relative overflow-hidden rounded border ${
        isRescued
          ? "bg-chart-4/10 border-chart-4/50"
          : isRescueOTW
          ? "bg-chart-3/10 border-chart-3/50"
          : "bg-destructive/10 border-destructive/50 animate-beacon"
      }`}
    >
      {/* Alert stripe */}
      {isAwaiting && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-destructive animate-pulse" />
      )}
      {isRescueOTW && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-chart-3" />
      )}
      {isRescued && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-chart-4" />
      )}

      <div className="p-3 pl-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className={`w-4 h-4 ${
                isRescued ? "text-chart-4" : isRescueOTW ? "text-chart-3" : "text-destructive"
              }`}
            />
            <span className="font-mono text-xs font-bold text-foreground">
              {isRescued ? "VICTIM RESCUED" : isRescueOTW ? "RESCUE EN ROUTE" : "VICTIM DETECTED"}
            </span>
          </div>
          {isRescued && (
            <button
              onClick={onDismiss}
              className="p-0.5 hover:bg-muted rounded transition-colors"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Details */}
        <div className="space-y-1.5 text-xs font-mono">
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-chart-1" />
            <span className="text-muted-foreground">
              {alert.coordinates
                ? `Coordinates: [${alert.coordinates[0].toFixed(1)}, ${alert.coordinates[2].toFixed(1)}]`
                : "Coordinates: unknown"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-chart-1" />
            <span className="text-muted-foreground">Detected by {alert.detectedBy}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-chart-1" />
            <span className="text-muted-foreground">{timeAgo}</span>
          </div>
          
          {/* Rescue countdown - shows after human dispatches */}
          {isRescueOTW && alert.rescueCountdown !== undefined && (
            <div className="flex items-center gap-2 mt-2 p-2 bg-chart-3/20 rounded border border-chart-3/40">
              <Timer className="w-4 h-4 text-chart-3 animate-pulse" />
              <span className="text-chart-3 font-bold">
                Rescue team arriving in {alert.rescueCountdown}s
              </span>
            </div>
          )}
          
          {isRescued && (
            <div className="flex items-center gap-2 mt-2 p-2 bg-chart-4/20 rounded border border-chart-4/40">
              <span className="text-chart-4 font-bold">
                Rescue complete. Victim secured.
              </span>
            </div>
          )}
        </div>

        {/* Dispatch button - human clicks this */}
        {isAwaiting && (
          <Button
            size="sm"
            onClick={onDispatchRescue}
            className="w-full mt-3 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-mono text-xs"
          >
            <Send className="w-3.5 h-3.5 mr-2" />
            ACKNOWLEDGE AND DISPATCH RESCUE
          </Button>
        )}
      </div>
    </div>
  )
}

export default function VictimAlerts({
  alerts,
  onDispatchRescue,
  onDismiss,
}: {
  alerts: VictimAlert[]
  onDispatchRescue: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const awaitingCount = alerts.filter(a => a.status === "AWAITING_DISPATCH").length
  const rescueOTWCount = alerts.filter(a => a.status === "RESCUE_OTW").length
  const rescuedCount = alerts.filter(a => a.status === "RESCUED").length

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              awaitingCount > 0 ? "bg-destructive animate-pulse" : rescueOTWCount > 0 ? "bg-chart-3 animate-pulse" : "bg-chart-4"
            }`}
          />
          <h3 className="font-mono text-xs font-bold text-foreground tracking-wider">
            DISTRESS SIGNALS
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {awaitingCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground text-xs font-mono">
              {awaitingCount} PENDING
            </span>
          )}
          {rescueOTWCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-chart-3 text-background text-xs font-mono">
              {rescueOTWCount} EN ROUTE
            </span>
          )}
          {rescuedCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-chart-4 text-background text-xs font-mono">
              {rescuedCount} RESCUED
            </span>
          )}
        </div>
      </div>

      {/* Alert list */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto tactical-scrollbar">
        {alerts.length === 0 ? (
          <div className="text-center py-6 text-xs font-mono text-muted-foreground">
            Drones scanning for thermal signatures...
          </div>
        ) : (
          alerts.map((alert) => (
            <AlertToast
              key={alert.id}
              alert={alert}
              onDispatchRescue={() => onDispatchRescue(alert.id)}
              onDismiss={() => onDismiss(alert.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
