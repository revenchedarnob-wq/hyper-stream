import { useState } from 'react'
import './analytics.css'
import { playHapticClick } from '@/lib/sound'

export function Analytics() {
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | '30d'>('24h')

  return (
    <div className="analytics-view">
      {/* Header */}
      <header className="analytics-header">
        <div className="analytics-header-copy">
          <h1 className="analytics-title">Analytics & Telemetry</h1>
          <p className="analytics-subtitle">
            Real-time network throughput, NVMe cache saturation, and codec distribution.
          </p>
        </div>

        <div className="analytics-range-selector" role="tablist">
          {(['1h', '24h', '7d', '30d'] as const).map((range) => (
            <button
              key={range}
              type="button"
              role="tab"
              aria-selected={timeRange === range}
              className={`analytics-range-btn ${timeRange === range ? 'active' : ''}`}
              onClick={() => {
                playHapticClick()
                setTimeRange(range)
              }}
            >
              {range.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {/* Main Body */}
      <div className="analytics-scroll">
        {/* Real-time Bandwidth Throughput Card */}
        <section className="analytics-card throughput-card">
          <div className="card-top-meta">
            <div className="card-title-group">
              <span className="card-title">Ingestion Bandwidth</span>
              <span className="telemetry-live-pill">
                <span className="live-indicator-dot" />
                <span>42.8 MB/s Live</span>
              </span>
            </div>
            <div className="bandwidth-stat-chips">
              <div className="stat-chip">
                <span className="chip-label">Peak</span>
                <span className="chip-value">68.2 MB/s</span>
              </div>
              <div className="stat-chip">
                <span className="chip-label">Average</span>
                <span className="chip-value">38.4 MB/s</span>
              </div>
              <div className="stat-chip">
                <span className="chip-label">Session Ingested</span>
                <span className="chip-value">11.45 GB</span>
              </div>
            </div>
          </div>

          {/* SVG Waveform Chart */}
          <div className="chart-wrapper">
            <svg
              className="throughput-svg"
              viewBox="0 0 700 160"
              preserveAspectRatio="none"
              aria-label="Throughput waveform chart"
            >
              <defs>
                <linearGradient id="throughputGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
                  <stop offset="60%" stopColor="#3b82f6" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="lineGlow" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#60a5fa" />
                  <stop offset="50%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#2563eb" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              <line x1="0" y1="40" x2="700" y2="40" stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
              <line x1="0" y1="80" x2="700" y2="80" stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
              <line x1="0" y1="120" x2="700" y2="120" stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />

              {/* Area Fill */}
              <path
                d="M 0 160 L 0 125 Q 35 110 70 85 T 140 70 T 210 95 T 280 45 T 350 60 T 420 30 T 490 55 T 560 40 T 630 65 T 700 35 L 700 160 Z"
                fill="url(#throughputGradient)"
              />

              {/* Smooth Spline Curve */}
              <path
                d="M 0 125 Q 35 110 70 85 T 140 70 T 210 95 T 280 45 T 350 60 T 420 30 T 490 55 T 560 40 T 630 65 T 700 35"
                fill="none"
                stroke="url(#lineGlow)"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {/* Current Live Pulse Anchor */}
              <circle cx="700" cy="35" r="4" fill="#3b82f6" />
              <circle cx="700" cy="35" r="8" fill="#3b82f6" opacity="0.3" />
            </svg>

            {/* Time labels */}
            <div className="chart-time-labels">
              <span>-60 min</span>
              <span>-45 min</span>
              <span>-30 min</span>
              <span>-15 min</span>
              <span>Now</span>
            </div>
          </div>
        </section>

        {/* Dual Grid: Storage Saturation + Codec Distribution */}
        <div className="analytics-dual-grid">
          {/* NVMe Storage Saturation */}
          <section className="analytics-card">
            <div className="card-header-compact">
              <span className="card-title">NVMe Cache Allocation</span>
              <span className="card-header-badge">PCIe Gen4 · 1.42 TB Free</span>
            </div>

            {/* Segmented Bar */}
            <div className="storage-segmented-bar">
              <div className="seg-segment seg-video" style={{ width: '22%' }} title="Video Masters: 440 GB" />
              <div className="seg-segment seg-audio" style={{ width: '8%' }} title="Lossless Audio: 160 GB" />
              <div className="seg-segment seg-temp" style={{ width: '4%' }} title="Live Ring Buffers: 80 GB" />
              <div className="seg-segment seg-free" style={{ width: '66%' }} title="Free Space: 1.42 TB" />
            </div>

            {/* Legend */}
            <div className="storage-legend">
              <div className="legend-item">
                <span className="legend-dot dot-video" />
                <span className="legend-name">Video Masters</span>
                <span className="legend-val">440 GB</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot dot-audio" />
                <span className="legend-name">FLAC Audio</span>
                <span className="legend-val">160 GB</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot dot-temp" />
                <span className="legend-name">Ring Buffer</span>
                <span className="legend-val">80 GB</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot dot-free" />
                <span className="legend-name">Available</span>
                <span className="legend-val">1.42 TB</span>
              </div>
            </div>
          </section>

          {/* Codec Breakdown */}
          <section className="analytics-card">
            <div className="card-header-compact">
              <span className="card-title">Codec Ingestion Profile</span>
              <span className="card-header-badge">Hardware Decode</span>
            </div>

            <div className="codec-list">
              <div className="codec-row">
                <div className="codec-meta">
                  <span className="codec-name">AV1 (AOMedia)</span>
                  <span className="codec-pct">54%</span>
                </div>
                <div className="codec-bar-track">
                  <div className="codec-bar-fill av1" style={{ width: '54%' }} />
                </div>
              </div>

              <div className="codec-row">
                <div className="codec-meta">
                  <span className="codec-name">HEVC / H.265 (Main10)</span>
                  <span className="codec-pct">32%</span>
                </div>
                <div className="codec-bar-track">
                  <div className="codec-bar-fill hevc" style={{ width: '32%' }} />
                </div>
              </div>

              <div className="codec-row">
                <div className="codec-meta">
                  <span className="codec-name">AVC / H.264 (Legacy)</span>
                  <span className="codec-pct">10%</span>
                </div>
                <div className="codec-bar-track">
                  <div className="codec-bar-fill h264" style={{ width: '10%' }} />
                </div>
              </div>

              <div className="codec-row">
                <div className="codec-meta">
                  <span className="codec-name">FLAC & Opus Hi-Res</span>
                  <span className="codec-pct">4%</span>
                </div>
                <div className="codec-bar-track">
                  <div className="codec-bar-fill audio-codec" style={{ width: '4%' }} />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Hardware Acceleration Pipeline Strip */}
        <section className="analytics-card hardware-strip">
          <div className="hw-item">
            <span className="hw-label">PIPELINE ACCELERATOR</span>
            <span className="hw-value">NVIDIA NVENC Turbo</span>
          </div>
          <div className="hw-divider" />
          <div className="hw-item">
            <span className="hw-label">GPU MEMORY USAGE</span>
            <span className="hw-value">1.8 / 16.0 GB (11%)</span>
          </div>
          <div className="hw-divider" />
          <div className="hw-item">
            <span className="hw-label">MUX LATENCY</span>
            <span className="hw-value">0.8 ms</span>
          </div>
          <div className="hw-divider" />
          <div className="hw-item">
            <span className="hw-label">DIRECT3D 12 ENGINE</span>
            <span className="hw-value status-active">Direct Compositing</span>
          </div>
        </section>
      </div>
    </div>
  )
}
