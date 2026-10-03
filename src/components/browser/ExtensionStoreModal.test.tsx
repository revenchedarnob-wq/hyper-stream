import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ExtensionStoreModal, RECOMMENDED_EXTENSIONS } from './ExtensionStoreModal'

describe('ExtensionStoreModal Component', () => {
  it('does not render when isOpen is false', () => {
    const html = renderToString(<ExtensionStoreModal isOpen={false} onClose={vi.fn()} />)
    expect(html).toBe('')
  })

  it('recommends store extensions by id, without made-up versions', () => {
    const html = renderToString(<ExtensionStoreModal isOpen={true} onClose={vi.fn()} />)
    expect(html).toContain('Extensions')
    for (const name of ['uBlock Origin Lite', 'AdGuard AdBlocker', 'SponsorBlock for YouTube', 'Dark Reader', 'Return YouTube Dislike']) {
      expect(html).toContain(name)
    }
    expect(html).not.toMatch(/v\d+\.\d+/)
    for (const ext of RECOMMENDED_EXTENSIONS) expect(ext.storeId).toMatch(/^[a-p]{32}$/)
  })

  it('outside the desktop app, explains where extensions work and disables installs', () => {
    const html = renderToString(<ExtensionStoreModal isOpen={true} onClose={vi.fn()} />)
    expect(html).toContain('Extensions are available in the desktop app.')
    expect(html).not.toContain('Paste a Chrome Web Store')
    expect(html).toContain('disabled=""')
  })

  it('renders tabs and an accessible close button', () => {
    const html = renderToString(<ExtensionStoreModal isOpen={true} onClose={vi.fn()} />)
    expect(html).toContain('Installed (0)')
    expect(html).toContain('Recommended')
    expect(html).toContain('extension-store-close-btn')
    expect(html).toContain('aria-label="Close extensions"')
  })
})
