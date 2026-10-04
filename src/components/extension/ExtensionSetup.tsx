import React from 'react'
import { createPortal } from 'react-dom'
import { listen } from '@tauri-apps/api/event'
import './extension-setup.css'
import { addBrowserExtension, errorMessage, getExtensionStatus, isTauri } from '@/lib/tauri-bridge'
import { playHapticGlass } from '@/lib/sound'

type Step = 'intro' | 'store' | 'manual' | 'done' | 'error'

const PROMPT_KEY = 'hyperstream_extension_prompt'

/**
 * Adds the HyperStream extension to the default browser. Browsers always ask the user to
 * confirm an extension, so the last click happens in the browser; this dialog waits for the
 * extension to connect and closes itself.
 */
export function ExtensionSetupDialog({
  browserName,
  addNow = false,
  onClose,
}: {
  browserName: string
  /** Skip the introduction (opened from Settings). */
  addNow?: boolean
  onClose: () => void
}) {
  const [step, setStep] = React.useState<Step>('intro')
  const [manual, setManual] = React.useState<{ page: string; folder: string } | null>(null)
  const [error, setError] = React.useState('')
  const [copied, setCopied] = React.useState<'page' | 'folder' | null>(null)
  const started = React.useRef(false)

  const copy = React.useCallback(async (what: 'page' | 'folder', text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000)
    } catch {
      setCopied(null)
    }
  }, [])

  const add = React.useCallback(async () => {
    try {
      const result = await addBrowserExtension()
      if (result.mode === 'manual') {
        const page = result.extensions_page ?? 'chrome://extensions'
        setManual({ page, folder: result.folder ?? '' })
        void copy('page', page)
        setStep('manual')
      } else {
        setStep('store')
      }
    } catch (e) {
      setError(errorMessage(e))
      setStep('error')
    }
  }, [copy])

  React.useEffect(() => {
    if (addNow && !started.current) {
      started.current = true
      void add()
    }
  }, [addNow, add])

  // Finish as soon as the extension connects (event when the app is reachable, check as backup).
  React.useEffect(() => {
    if (step !== 'store' && step !== 'manual') return
    const unlisten = listen('extension-connected', () => setStep('done'))
    const timer = window.setInterval(() => {
      void getExtensionStatus().then((s) => {
        if (s?.installed) setStep('done')
      })
    }, 3000)
    return () => {
      void unlisten.then((fn) => fn())
      window.clearInterval(timer)
    }
  }, [step])

  React.useEffect(() => {
    if (step !== 'done') return
    playHapticGlass()
    try {
      localStorage.setItem(PROMPT_KEY, 'added')
    } catch {
      // Not saved: the prompt may show once more, nothing else.
    }
    const t = window.setTimeout(onClose, 2200)
    return () => window.clearTimeout(t)
  }, [step, onClose])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const waiting = (
    <p className="ext-setup-waiting" role="status">
      Waiting for {browserName}…
    </p>
  )

  // On <body>: blurred or transformed containers would otherwise trap the fixed backdrop.
  return createPortal(
    <div className="ext-setup-backdrop" onClick={onClose} role="presentation">
      <div
        className="ext-setup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ext-setup-title"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'intro' && (
          <>
            <h2 id="ext-setup-title">Download from {browserName}</h2>
            <p>
              Add the HyperStream extension to {browserName}. It finds videos on the pages you visit and sends
              downloads here with one click.
            </p>
            <div className="ext-setup-actions">
              <button type="button" className="ext-setup-secondary" onClick={onClose}>
                Not now
              </button>
              <button type="button" className="ext-setup-primary" onClick={() => void add()} autoFocus>
                Add to {browserName}
              </button>
            </div>
          </>
        )}

        {step === 'store' && (
          <>
            <h2 id="ext-setup-title">Finish in {browserName}</h2>
            <p>
              {browserName} opened the HyperStream extension page. Click the Add button there, then confirm.
            </p>
            {waiting}
            <div className="ext-setup-actions">
              <button type="button" className="ext-setup-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {step === 'manual' && manual && (
          <>
            <h2 id="ext-setup-title">Add it in {browserName}</h2>
            <ol className="ext-setup-steps">
              <li>
                In {browserName}, open <span className="ext-setup-code">{manual.page}</span>
                <button type="button" className="ext-setup-copy" onClick={() => void copy('page', manual.page)}>
                  {copied === 'page' ? 'Copied' : 'Copy'}
                </button>
              </li>
              <li>Turn on Developer mode (top right), then click Load unpacked.</li>
              <li>
                Choose the HyperStream extension folder
                <button type="button" className="ext-setup-copy" onClick={() => void copy('folder', manual.folder)}>
                  {copied === 'folder' ? 'Copied' : 'Copy path'}
                </button>
              </li>
            </ol>
            {waiting}
            <div className="ext-setup-actions">
              <button type="button" className="ext-setup-secondary" onClick={onClose} autoFocus>
                Close
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <h2 id="ext-setup-title">Added to {browserName}</h2>
            <p>Right-click a video or link and choose Download with HyperStream, or use the toolbar button.</p>
          </>
        )}

        {step === 'error' && (
          <>
            <h2 id="ext-setup-title">Couldn't open {browserName}</h2>
            <p>{error}</p>
            <div className="ext-setup-actions">
              <button type="button" className="ext-setup-primary" onClick={onClose} autoFocus>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Asks once, on first run, to add the extension to the default browser. */
export default function ExtensionPrompt() {
  const [browserName, setBrowserName] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!isTauri()) return
    let asked = false
    try {
      asked = localStorage.getItem(PROMPT_KEY) !== null
    } catch {
      asked = true
    }
    if (asked) return
    let cancelled = false
    void getExtensionStatus()
      .then((s) => {
        if (cancelled || !s?.browser || !s.supported || s.installed) return
        try {
          localStorage.setItem(PROMPT_KEY, 'asked')
        } catch {
          // Not saved: it may ask once more.
        }
        setBrowserName(s.browser.name)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!browserName) return null
  return <ExtensionSetupDialog browserName={browserName} onClose={() => setBrowserName(null)} />
}
