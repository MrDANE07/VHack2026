"use client"

import { X, Smartphone, Wifi, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function QRModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-card border border-border rounded-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-chart-1" />
            <h2 className="font-mono text-sm font-bold text-foreground">
              VICTIM DISTRESS UI
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Mock QR Code */}
          <div className="w-48 h-48 mx-auto mb-4 bg-white p-3 rounded">
            <div className="w-full h-full grid grid-cols-8 gap-0.5">
              {Array.from({ length: 64 }).map((_, i) => (
                <div
                  key={i}
                  className={`aspect-square ${
                    Math.random() > 0.5 ? "bg-black" : "bg-white"
                  }`}
                />
              ))}
            </div>
          </div>

          <p className="text-center text-xs font-mono text-muted-foreground mb-6">
            Scan to access mobile distress beacon
          </p>

          {/* Features */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded border border-border">
              <Wifi className="w-5 h-5 text-chart-1" />
              <div>
                <div className="text-xs font-mono font-bold text-foreground">
                  EMERGENCY BROADCAST
                </div>
                <div className="text-xs font-mono text-muted-foreground">
                  Transmit location via WebSocket
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded border border-border">
              <MapPin className="w-5 h-5 text-chart-4" />
              <div>
                <div className="text-xs font-mono font-bold text-foreground">
                  GPS COORDINATES
                </div>
                <div className="text-xs font-mono text-muted-foreground">
                  High-precision location tracking
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
            <span>AEGIS SWARM v1.0</span>
            <span>WS: localhost:8000/distress</span>
          </div>
        </div>
      </div>
    </div>
  )
}
