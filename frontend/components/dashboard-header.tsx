"use client"

import { useState, useEffect } from "react"
import { Shield, Radio, Wifi, WifiOff, Clock, Activity } from "lucide-react"

interface ConnectionStatus {
  websocket: boolean
  lastPing: Date | null
}

export default function DashboardHeader({
  connectionStatus,
}: {
  connectionStatus: ConnectionStatus
}) {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [hasMounted, setHasMounted] = useState(false)

  useEffect(() => {
    setHasMounted(true)
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  }

  return (
    <header className="h-14 px-4 flex items-center justify-between bg-card border-b border-border">
      {/* Logo & Title */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded bg-primary/10 border border-primary/30">
          <Shield className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="font-mono text-sm font-bold text-foreground tracking-wider">
            AEGIS SWARM
          </h1>
          <p className="font-mono text-xs text-muted-foreground">
            Mission Control v1.0
          </p>
        </div>
      </div>

      {/* Center - Mission Status */}
      <div className="hidden md:flex items-center gap-6">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded border border-border">
          <Activity className="w-4 h-4 text-chart-4" />
          <span className="font-mono text-xs text-foreground">MISSION ACTIVE</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded border border-border">
          <Radio className="w-4 h-4 text-chart-1 animate-pulse" />
          <span className="font-mono text-xs text-foreground">COMMS ONLINE</span>
        </div>
      </div>

      {/* Right - Status & Time */}
      <div className="flex items-center gap-4">
        {/* WebSocket Status */}
        <div className="flex items-center gap-2">
          {connectionStatus.websocket ? (
            <>
              <Wifi className="w-4 h-4 text-chart-4" />
              <span className="hidden sm:inline font-mono text-xs text-chart-4">
                WS CONNECTED
              </span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-destructive" />
              <span className="hidden sm:inline font-mono text-xs text-destructive">
                WS DISCONNECTED
              </span>
            </>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-border" />

        {/* Date & Time */}
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <div className="text-right min-w-[80px]"> 
            <div className="font-mono text-xs text-foreground">
              {hasMounted ? formatTime(currentTime) : "--:--:--"}
            </div>
            <div className="font-mono text-xs text-muted-foreground">
              {hasMounted ? formatDate(currentTime) : "Loading..."}
            </div>
          </div>
        </div>
      </div> {/* Closed the Right-side container */}
    </header>
  )
}