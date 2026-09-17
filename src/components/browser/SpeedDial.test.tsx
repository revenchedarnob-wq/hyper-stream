import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { SpeedDial, SpeedDialTile } from './SpeedDial'
import { DEFAULT_SPEED_DIAL_PRESETS, renderSpeedDialIcon } from './speed-dial-presets'

import type { ShieldsMetrics, SpeedDialItem } from './types'
import * as soundModule from '@/lib/sound'

vi.mock('@/lib/sound', () => ({
  playHapticClick: vi.fn(),
  playHapticGlass: vi.fn(),
  playHapticPop: vi.fn(),
}))

describe('SpeedDial Component', () => {
  const mockShieldsStats: ShieldsMetrics = {
    adsBlocked: 340,
    trackersBlocked: 180,
    bandwidthSavedBytes: 33554432, // 32.0 MB
    fingerprintingBlocked: 42,
    isEnabled: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders header badge with Brave Privacy Workspace and authentic lion logo', () => {
    const html = renderToString(
      <SpeedDial
        shieldsStats={mockShieldsStats}
        onSelectUrl={vi.fn()}
      />
    )

    expect(html).toContain('Brave Privacy Workspace')
    expect(html).toContain('speed-dial-badge')
    expect(html).toContain('Decentralized Streaming Gateway')
  })

  it('renders all 6 curated streaming presets with appropriate URLs and categories', () => {
    const html = renderToString(
      <SpeedDial
        shieldsStats={mockShieldsStats}
        onSelectUrl={vi.fn()}
      />
    )

    // Verify all 6 preset titles exist
    expect(html).toContain('Twitch')
    expect(html).toContain('YouTube')
    expect(html).toContain('Kick')
    expect(html).toContain('Crunchyroll')
    expect(html).toContain('AnimeFlix')
    expect(html).toContain('SoundCloud')

    // Verify preset URLs without protocol display
    expect(html).toContain('twitch.tv')
    expect(html).toContain('youtube.com')
    expect(html).toContain('kick.com')
    expect(html).toContain('crunchyroll.com')
    expect(html).toContain('animeflix.live')
    expect(html).toContain('soundcloud.com')

    // Verify categories
    expect(html).toContain('streaming')
    expect(html).toContain('anime')
    expect(html).toContain('music')
  })

  it('renders privacy telemetry ribbon with calculated values', () => {
    const html = renderToString(
      <SpeedDial
        shieldsStats={mockShieldsStats}
        onSelectUrl={vi.fn()}
      />
    )

    // Total blocked: 340 + 180 = 520
    expect(html).toContain('520')
    expect(html).toContain('Total Ads &amp; Trackers Blocked')

    // Bandwidth saved: 32.0 MB
    expect(html).toContain('32.0 MB')
    expect(html).toContain('Bandwidth Saved')

    // CPU efficiency
    expect(html).toContain('Hyper-Efficient')
    expect(html).toContain('CPU Cycles Preserved')
  })

  it('renders custom tile add button slot', () => {
    const html = renderToString(
      <SpeedDial
        shieldsStats={mockShieldsStats}
        onSelectUrl={vi.fn()}
      />
    )

    expect(html).toContain('Add Bookmark')
    expect(html).toContain('speed-dial-add-tile')
  })

  it('contains zero emojis in the entire rendered HTML', () => {
    const html = renderToString(
      <SpeedDial
        shieldsStats={mockShieldsStats}
        onSelectUrl={vi.fn()}
      />
    )

    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    expect(emojiRegex.test(html)).toBe(false)
  })
})

describe('SpeedDialTile Component', () => {
  const sampleItem: SpeedDialItem = {
    id: 'twitch',
    title: 'Twitch',
    url: 'https://twitch.tv',
    category: 'streaming',
    iconKey: 'twitch',
    accentColor: '#9146FF',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders tile structure with icon, title, url, and category', () => {
    const html = renderToString(
      <SpeedDialTile
        item={sampleItem}
        onSelect={vi.fn()}
      />
    )

    expect(html).toContain('speed-dial-tile')
    expect(html).toContain('Twitch')
    expect(html).toContain('twitch.tv')
    expect(html).toContain('streaming')
    expect(html).toContain('speed-dial-tile-icon')
  })

  it('executes playHapticClick and invokes onSelect callback on tile click', () => {
    const onSelect = vi.fn()
    const tileElement = SpeedDialTile({
      item: sampleItem,
      onSelect,
    })

    // Simulate clicking the tile button
    tileElement.props.onClick({} as React.MouseEvent<HTMLButtonElement>)

    expect(soundModule.playHapticClick).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('https://twitch.tv')
  })

  it('handles custom tiles with remove action and triggers playHapticPop', () => {
    const customItem: SpeedDialItem = {
      id: 'custom-bilibili',
      title: 'Bilibili',
      url: 'https://bilibili.com',
      category: 'custom',
      iconKey: 'custom',
    }

    const onSelect = vi.fn()
    const onRemove = vi.fn()

    const tileElement = SpeedDialTile({
      item: customItem,
      onSelect,
      onRemove,
      isCustom: true,
    })

    // Locate remove button from children
    const removeBtn = tileElement.props.children[2]
    expect(removeBtn).toBeDefined()

    const stopPropagationMock = vi.fn()
    removeBtn.props.onClick({
      stopPropagation: stopPropagationMock,
    } as unknown as React.MouseEvent<HTMLButtonElement>)

    expect(stopPropagationMock).toHaveBeenCalledTimes(1)
    expect(soundModule.playHapticPop).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith('custom-bilibili')
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('SpeedDial Presets & Icons', () => {
  it('defines exactly 6 high-resolution presets as per specification', () => {
    expect(DEFAULT_SPEED_DIAL_PRESETS).toHaveLength(6)

    const presetIds = DEFAULT_SPEED_DIAL_PRESETS.map((p) => p.id)
    expect(presetIds).toEqual([
      'twitch',
      'youtube',
      'kick',
      'crunchyroll',
      'animeflix',
      'soundcloud',
    ])
  })

  it('renders distinct vector icons for each preset iconKey', () => {
    const keys = ['twitch', 'youtube', 'kick', 'crunchyroll', 'animeflix', 'soundcloud', 'custom']
    for (const key of keys) {
      const icon = renderSpeedDialIcon(key, 24)
      const html = renderToString(icon)
      expect(html).toContain('<svg')
      expect(html).toContain('viewBox="0 0 24 24"')
    }
  })
})
