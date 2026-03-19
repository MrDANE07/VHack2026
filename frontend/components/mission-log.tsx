"use client"

import { useEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"

export interface LogEntry {
  id: string
  timestamp: Date
  type: "REASONING" | "ACTION" | "ALERT" | "SYSTEM" | "SUCCESS"
  message: string
  droneId?: string
}

const typeStyles: Record<string, { color: string; label: string }> = {
  REASONING: { color: "text-chart-5", label: "REASONING" },
  ACTION: { color: "text-chart-1", label: "ACTION" },
  ALERT: { color: "text-destructive", label: "ALERT" },
  SYSTEM: { color: "text-muted-foreground", label: "SYSTEM" },
  SUCCESS: { color: "text-chart-4", label: "SUCCESS" },
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export default function MissionLog({ logs }: { logs: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new logs are added
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [logs])

  return (
    <div className="h-full flex flex-col bg-card border-r border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-chart-4 animate-pulse" />
            <h2 className="font-mono text-sm font-bold text-foreground tracking-wider">
              MISSION LOG
            </h2>
          </div>
          <span className="text-xs font-mono text-muted-foreground">
            {logs.length} ENTRIES
          </span>
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          Chain-of-Thought Reasoning
        </p>
      </div>

      {/* Log content - newest at bottom */}
      <ScrollArea className="flex-1 h-0 tactical-scrollbar">
        <div className="p-3 space-y-2 min-h-full">
          {logs.map((log, index) => {
            const style = typeStyles[log.type]
            return (
              <div
                key={log.id}
                className="font-mono text-xs leading-relaxed break-all"
              >
                <div className="flex items-start gap-2 flex-nowrap">
                  <span className="text-muted-foreground shrink-0">
                    [{formatTime(log.timestamp)}]
                  </span>
                  <span className={`${style.color} shrink-0 font-bold`}>
                    [{style.label}]
                  </span>
                </div>
                <div className="pl-0 mt-0.5 text-foreground/90 break-words">
                  {log.droneId && (
                    <span className="text-chart-1">[{log.droneId}] </span>
                  )}
                  {log.message}
                </div>
              </div>
            )
          })}

          {/* Auto-scroll anchor and cursor */}
          <div ref={scrollRef} />
          <div className="flex items-center gap-1 mt-2">
            <span className="text-chart-4 font-mono text-xs">{">"}</span>
            <span className="w-2 h-4 bg-chart-4 animate-pulse" />
          </div>
        </div>
      </ScrollArea>

      {/* Status bar */}
      <div className="px-4 py-2 border-t border-border bg-muted/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-chart-4" />
              <span className="text-xs font-mono text-muted-foreground">AGENT ONLINE</span>
            </div>
          </div>
          <span className="text-xs font-mono text-muted-foreground">
            MCP v1.0
          </span>
        </div>
      </div>
    </div>
  )
}
