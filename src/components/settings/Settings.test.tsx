import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { Settings } from './Settings'

vi.mock('@/lib/sound', () => ({
  playHapticClick: vi.fn(),
  playHapticGlass: vi.fn(),
  playHapticPop: vi.fn(),
  playHapticSwoosh: vi.fn(),
}))

const props = {
  isPotatoMode: true,
  onTogglePotatoMode: vi.fn(),
  isBloomEnabled: false,
  onToggleBloom: vi.fn(),
  audioMuted: false,
  onToggleAudio: vi.fn(),
}

describe('Settings', () => {
  it('lists a Browser category next to Downloads', () => {
    const html = renderToString(<Settings {...props} />)
    const tabs = [...html.matchAll(/role="tab"[^>]*><span>([^<]+)<\/span>/g)].map((m) => m[1])
    expect(tabs).toEqual(['Downloads', 'Browser', 'Appearance', 'Sound'])
  })
})
