import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ExtensionStoreModal } from './ExtensionStoreModal'

describe('ExtensionStoreModal Component', () => {
  it('does not render when isOpen is false', () => {
    const html = renderToString(
      <ExtensionStoreModal isOpen={false} onClose={vi.fn()} />
    )
    expect(html).toBe('')
  })

  it('renders extension store with default extensions and header when open', () => {
    const html = renderToString(
      <ExtensionStoreModal isOpen={true} onClose={vi.fn()} />
    )

    expect(html).toContain('Extension Store')
    expect(html).toContain('AdGuard AdBlocker')
    expect(html).toContain('uBlock Origin')
    expect(html).toContain('SponsorBlock for YouTube')
    expect(html).toContain('Dark Reader')
    expect(html).toContain('Return YouTube Dislike')
    expect(html).toContain('Enhancer for YouTube')
    expect(html).toContain('Installed')
    expect(html).toContain('Search extensions (e.g. AdGuard, uBlock, Dark Reader)...')
  })

  it('renders category filtering tabs', () => {
    const html = renderToString(
      <ExtensionStoreModal isOpen={true} onClose={vi.fn()} />
    )

    expect(html).toContain('All Extensions')
    expect(html).toContain('Installed')
    expect(html).toContain('Adblockers')
    expect(html).toContain('Streaming')
  })

  it('renders close button with accessibility attributes', () => {
    const html = renderToString(
      <ExtensionStoreModal isOpen={true} onClose={vi.fn()} />
    )

    expect(html).toContain('extension-store-close-btn')
    expect(html).toContain('aria-label="Close Extension Store"')
  })
})
