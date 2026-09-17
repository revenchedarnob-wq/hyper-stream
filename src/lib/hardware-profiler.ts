export interface HardwareProfile {
  tier: 'potato' | 'balanced' | 'enthusiast';
  isIntegratedGpu: boolean;
  gpuRenderer: string;
  logicalCores: number;
  memoryGb: number;
  isBatteryPowered: boolean;
  recommendedRenderingProfile: 'potato' | 'studio';
  summaryReason: string;
}

const POTATO_RENDERER_PATTERNS: RegExp[] = [
  /intel.*(?:hd|uhd|iris|xe)/i,
  /radeon.*(?:vega|graphics|\br[2-5]\b)/i,
  /swiftshader/i,
  /basic render/i,
  /software/i,
  /llvmpipe/i,
  /mesa/i,
]

const ENTHUSIAST_RENDERER_PATTERNS: RegExp[] = [
  /(?:geforce\s+)?rtx/i,
  /radeon\s+rx\s+[6789]/i,
  /apple\s+m\d*\s*(?:max|pro)/i,
]

export function parseGpuTier(rendererString: string): 'potato' | 'balanced' | 'enthusiast' {
  if (!rendererString) {
    return 'balanced'
  }

  const isPotato = POTATO_RENDERER_PATTERNS.some((pattern) => pattern.test(rendererString))
  if (isPotato) {
    return 'potato'
  }

  const isEnthusiast = ENTHUSIAST_RENDERER_PATTERNS.some((pattern) => pattern.test(rendererString))
  if (isEnthusiast) {
    return 'enthusiast'
  }

  return 'balanced'
}

export function formatGpuName(raw: string): string {
  if (!raw || raw === 'Unknown' || raw === 'Unknown Renderer') {
    return 'Hardware Accelerated GPU'
  }

  let cleaned = raw

  // If ANGLE format: ANGLE (Vendor, Device Name ... Direct3D...)
  const angleMatch = raw.match(/ANGLE\s*\([^,]+,\s*([^\r\n]+)\)/i)
  if (angleMatch && angleMatch[1]) {
    cleaned = angleMatch[1]
  }

  // Strip hex device IDs e.g. (0x00001638)
  cleaned = cleaned.replace(/\s*\(0x[0-9a-fA-F]+\)/gi, '')
  // Strip trademark symbols
  cleaned = cleaned.replace(/\((?:TM|R)\)/gi, '')
  // Strip Direct3D and shader compiler suffixes
  cleaned = cleaned.replace(/\s*\bDirect3D.*$/i, '')
  cleaned = cleaned.replace(/\s*,\s*D3D\d+.*$/i, '')
  cleaned = cleaned.replace(/\s*vs_\d+_\d+\s+ps_\d+_\d+.*$/i, '')
  // Strip any trailing parentheses or commas
  cleaned = cleaned.replace(/[,\)]+$/, '')
  // Clean whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  return cleaned || 'Hardware Accelerated GPU'
}

export function detectHardwareProfile(): HardwareProfile {
  let gpuRenderer = 'Unknown Renderer'
  let isIntegratedGpu = false

  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
      if (gl) {
        const glCtx = gl as WebGLRenderingContext
        const debugInfo = glCtx.getExtension('WEBGL_debug_renderer_info')
        if (debugInfo) {
          gpuRenderer = glCtx.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'Unknown'
        }
        const loseContext = glCtx.getExtension('WEBGL_lose_context')
        if (loseContext) {
          loseContext.loseContext()
        }
      }
    }
  } catch {
    // Fallback on restricted or headless environments
  }

  const tier = parseGpuTier(gpuRenderer)
  isIntegratedGpu = tier === 'potato'

  const logicalCores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4

  const memoryGb = typeof navigator !== 'undefined' && 'deviceMemory' in navigator
    ? (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8
    : 8

  const isBatteryPowered = false

  let recommendedRenderingProfile: 'potato' | 'studio' = 'studio'
  let summaryReason = 'Dedicated GPU and high memory detected'

  if (logicalCores >= 8 && memoryGb >= 8) {
    recommendedRenderingProfile = 'studio'
    summaryReason = `High performance processor detected (${logicalCores} Cores)`
  } else if (isIntegratedGpu || logicalCores <= 4 || memoryGb <= 4) {
    recommendedRenderingProfile = 'potato'
    summaryReason = isIntegratedGpu
      ? `Integrated graphics detected (${gpuRenderer.slice(0, 32)})`
      : `Constrained system resources (${logicalCores} cores, ${memoryGb}GB RAM)`
  }

  return {
    tier,
    isIntegratedGpu,
    gpuRenderer,
    logicalCores,
    memoryGb,
    isBatteryPowered,
    recommendedRenderingProfile,
    summaryReason,
  }
}
