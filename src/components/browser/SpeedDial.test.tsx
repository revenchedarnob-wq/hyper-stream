import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { SpeedDial, SpeedDialTile } from './SpeedDial'
import { resolveBrowserNavigation } from './url-utils'
import { DEFAULT_SPEED_DIAL_PRESETS, renderSpeedDialIcon } from './speed-dial-presets'

import type { SpeedDialItem } from './types'
import * as soundModule from '@/lib/sound'

vi.mock('@/lib/sound', () => ({
  playHapticClick: vi.fn(),
  playHapticGlass: vi.fn(),
  playHapticPop: vi.fn(),
}))

describe('SpeedDial Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the start page header', () => {
    const html = renderToString(
      <SpeedDial
        onSelectUrl={vi.fn()}
      />
    )

    expect(html).toContain('speed-dial-search')
    expect(html).toContain('Find something to download')
    expect(html).not.toContain('Brave')
  })

  it('starts empty: no site is added by default', () => {
    const html = renderToString(<SpeedDial onSelectUrl={vi.fn()} />)
    expect(html).not.toContain('speed-dial-tile-')
    expect(html).toContain('Add your first site')
    // Popular sites are offered as one-click suggestions instead.
    expect(html).toContain('Quick add')
    expect(html).toContain('YouTube')
  })

  it('shows no made-up blocking statistics', () => {
    const html = renderToString(<SpeedDial onSelectUrl={vi.fn()} />)
    expect(html).not.toContain('Bandwidth Saved')
    expect(html).not.toContain('CPU Cycles')
  })

  it('renders custom tile add button slot', () => {
    const html = renderToString(
      <SpeedDial
        onSelectUrl={vi.fn()}
      />
    )

    expect(html).toContain('Add your first site')
    expect(html).toContain('speed-dial-add-tile')
  })

  it('contains zero emojis in the entire rendered HTML', () => {
    const html = renderToString(
      <SpeedDial
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

    // The wrapper holds the tile button first, then the optional remove button.
    const tileButton = tileElement.props.children[0]
    tileButton.props.onClick({} as React.MouseEvent<HTMLButtonElement>)

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

    // The remove button is a sibling of the tile button, never nested inside it
    const removeBtn = tileElement.props.children[1]
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
      'youtube',
      'facebook',
      'instagram',
      'crunchyroll',
      'x',
      'netflix',
    ])
  })

  it('renders distinct vector icons for each preset iconKey', () => {
    const keys = ['twitch', 'youtube', 'kick', 'vimeo', 'dailymotion', 'soundcloud', 'custom']
    for (const key of keys) {
      const icon = renderSpeedDialIcon(key, 24)
      const html = renderToString(icon)
      expect(html).toContain('<svg')
      expect(html).toContain('viewBox="0 0 24 24"')
    }
  })

  it('turns search words into a web search link', () => {
    expect(resolveBrowserNavigation('lofi music').url).toBe('https://search.brave.com/search?q=lofi+music')
    expect(resolveBrowserNavigation('youtube.com').url).toBe('https://youtube.com')
  })
})
