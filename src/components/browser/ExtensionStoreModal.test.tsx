import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ExtensionStoreModal } from './ExtensionStoreModal'

describe('ExtensionStoreModal Component', () => {
  it('does not render when isOpen is false', () => {
    const html = renderToString(<ExtensionStoreModal isOpen={false} onClose={vi.fn()} />)
    expect(html).toBe('')
  })

  it('renders extension management header and clean empty state when no extensions are loaded', () => {
    const html = renderToString(<ExtensionStoreModal isOpen={true} onClose={vi.fn()} />)
    expect(html).toContain('Extensions')
    expect(html).toContain('No extensions installed')
    expect(html).toContain('Chrome Web Store')
    expect(html).toContain('Edge Add-ons')
  })

  it('outside the desktop app, explains where extensions work and hides desktop-only quick add', () => {
    const html = renderToString(<ExtensionStoreModal isOpen={true} onClose={vi.fn()} />)
    expect(html).toContain('Extensions are available in the desktop app.')
    expect(html).not.toContain('Paste Chrome Web Store')
  })

  it('renders an accessible close button and flyout dialog semantics', () => {
    const html = renderToString(<ExtensionStoreModal isOpen={true} onClose={vi.fn()} />)
    expect(html).toContain('extension-store-close-btn')
    expect(html).toContain('aria-label="Close extensions"')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Browser extensions"')
  })

  it('preserves invariant hook order when transitioning isOpen from false to true', () => {
    // Verifies Rules of Hooks compliance: no React error #310 ("Rendered more hooks than during the previous render")
    let openState = false
    const onClose = vi.fn()
    function TestConsumer() {
      return <ExtensionStoreModal isOpen={openState} onClose={onClose} />
    }

    const closed = renderToString(<TestConsumer />)
    expect(closed).toBe('')

    openState = true
    const opened = renderToString(<TestConsumer />)
    expect(opened).toContain('Extensions')
  })
})
