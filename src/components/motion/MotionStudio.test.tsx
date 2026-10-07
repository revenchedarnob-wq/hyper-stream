import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MotionStudio } from './MotionStudio'

vi.mock('@/lib/sound', () => ({
  playHapticClick: vi.fn(),
  playHapticGlass: vi.fn(),
  playHapticPop: vi.fn(),
  playHapticSwoosh: vi.fn(),
  playHapticScrub: vi.fn(),
  isHapticAudioMuted: vi.fn(() => false),
  toggleHapticAudio: vi.fn(() => true),
}))

describe('MotionStudio Component Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders correctly to string with all core sections and layout', () => {
    const html = renderToString(<MotionStudio />)

    expect(html).toContain('HyperStream Motion Graphics Studio')
    expect(html).toContain('Forensic Engine')
    expect(html).toContain('Master AI Generation Prompt')
    expect(html).toContain('9:16 Reel (Creator Format)')
    expect(html).toContain('16:9 Cinematic')
    expect(html).toContain('0.00s (Identity)')
    expect(html).toContain('10.00s')
  })

  it('renders the 9:16 comparative benchmark cards structure', () => {
    const html = renderToString(<MotionStudio />)

    expect(html).toContain('hs-ms-viewport-9-16')
    expect(html).toContain('Generic Browser / Slow Stream')
    expect(html).toContain('Ultra-Low Latency Engine')
    expect(html).toContain('Follow and star')
    expect(html).toContain('HyperStream')
  })
})
