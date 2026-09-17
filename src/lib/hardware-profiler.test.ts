import { describe, it, expect } from 'vitest'
import { parseGpuTier, detectHardwareProfile, formatGpuName } from './hardware-profiler'

describe('parseGpuTier', () => {
  it('identifies Intel HD and UHD graphics as integrated potato tier', () => {
    expect(parseGpuTier('Intel(R) HD Graphics 620')).toBe('potato')
    expect(parseGpuTier('Intel(R) UHD Graphics 630')).toBe('potato')
    expect(parseGpuTier('Intel Iris Xe Graphics')).toBe('potato')
    expect(parseGpuTier('Mesa Intel(R) Xe Graphics')).toBe('potato')
  })

  it('identifies AMD Radeon Vega, integrated Radeon Graphics, and R2-R5 as potato tier', () => {
    expect(parseGpuTier('AMD Radeon Vega 8 Graphics')).toBe('potato')
    expect(parseGpuTier('AMD Radeon(TM) Graphics')).toBe('potato')
    expect(parseGpuTier('AMD Radeon R5 Graphics')).toBe('potato')
    expect(parseGpuTier('AMD Radeon R2 Graphics')).toBe('potato')
  })

  it('identifies software fallbacks as potato tier', () => {
    expect(parseGpuTier('Google SwiftShader')).toBe('potato')
    expect(parseGpuTier('Microsoft Basic Render Driver')).toBe('potato')
    expect(parseGpuTier('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('potato')
    expect(parseGpuTier('Software Rasterizer')).toBe('potato')
  })

  it('identifies dedicated enthusiast GPUs', () => {
    expect(parseGpuTier('NVIDIA GeForce RTX 4080')).toBe('enthusiast')
    expect(parseGpuTier('GeForce RTX 3070 Ti')).toBe('enthusiast')
    expect(parseGpuTier('AMD Radeon RX 7900 XTX')).toBe('enthusiast')
    expect(parseGpuTier('AMD Radeon RX 6800 XT')).toBe('enthusiast')
    expect(parseGpuTier('Apple M1 Max')).toBe('enthusiast')
    expect(parseGpuTier('Apple M2 Pro')).toBe('enthusiast')
    expect(parseGpuTier('Apple M3 Max')).toBe('enthusiast')
    expect(parseGpuTier('Apple M4 Pro')).toBe('enthusiast')
  })

  it('identifies mid-range dedicated or standard GPUs as balanced tier', () => {
    expect(parseGpuTier('NVIDIA GeForce GTX 1080')).toBe('balanced')
    expect(parseGpuTier('NVIDIA GeForce GTX 1660 Ti')).toBe('balanced')
    expect(parseGpuTier('AMD Radeon RX 580')).toBe('balanced')
    expect(parseGpuTier('Apple M1')).toBe('balanced')
    expect(parseGpuTier('Apple M2')).toBe('balanced')
    expect(parseGpuTier('')).toBe('balanced')
  })
})

describe('detectHardwareProfile', () => {
  it('returns a valid HardwareProfile object with required properties', () => {
    const profile = detectHardwareProfile()
    expect(profile).toBeDefined()
    expect(['potato', 'balanced', 'enthusiast']).toContain(profile.tier)
    expect(typeof profile.isIntegratedGpu).toBe('boolean')
    expect(typeof profile.gpuRenderer).toBe('string')
    expect(typeof profile.logicalCores).toBe('number')
    expect(typeof profile.memoryGb).toBe('number')
    expect(typeof profile.isBatteryPowered).toBe('boolean')
    expect(['potato', 'studio']).toContain(profile.recommendedRenderingProfile)
    expect(typeof profile.summaryReason).toBe('string')
    expect(profile.summaryReason.length).toBeGreaterThan(0)
  })

  it('assigns potato rendering profile when integrated GPU or constrained resources are present', () => {
    const profile = detectHardwareProfile()
    if (profile.isIntegratedGpu || profile.logicalCores <= 4 || profile.memoryGb <= 4) {
      expect(profile.recommendedRenderingProfile).toBe('potato')
    } else {
      expect(profile.recommendedRenderingProfile).toBe('studio')
    }
  })
})

describe('formatGpuName', () => {
  it('formats ANGLE DirectX strings into clean luxury device names', () => {
    expect(
      formatGpuName('ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)')
    ).toBe('AMD Radeon Graphics')

    expect(
      formatGpuName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11)')
    ).toBe('NVIDIA GeForce RTX 3080')

    expect(
      formatGpuName('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)')
    ).toBe('Intel Iris Xe Graphics')
  })

  it('handles standard clean renderer strings cleanly', () => {
    expect(formatGpuName('Apple M3 Max')).toBe('Apple M3 Max')
    expect(formatGpuName('')).toBe('Hardware Accelerated GPU')
    expect(formatGpuName('Unknown')).toBe('Hardware Accelerated GPU')
  })
})
