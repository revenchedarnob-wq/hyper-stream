import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { errorMessage, getInstalledExtensions, installStoreExtension, isTauri } from '@/lib/tauri-bridge'
import { playHapticClick, playHapticPop } from '@/lib/sound'
import { IconCheck } from '../stream-hub/Icons'
import { IconPuzzlePiece } from './Icons'
import type { ExtensionStoreListing } from './url-utils'

type Phase = 'checking' | 'ready' | 'installing' | 'installed' | 'error'

/**
 * Store pages say "Switch to Chrome" / "Get Microsoft Edge"; this adds the extension to the
 * built-in browser instead.
 */
export function ExtensionStorePill({ listing, onManage }: { listing: ExtensionStoreListing; onManage?: () => void }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    getInstalledExtensions()
      .then((list) => {
        if (cancelled) return
        const installed = list.some((e) => e.storeId === listing.id || e.id === listing.id)
        setPhase(installed ? 'installed' : 'ready')
      })
      .catch(() => !cancelled && setPhase('ready'))
    return () => {
      cancelled = true
    }
  }, [listing.id])

  useEffect(() => {
    if (!isTauri()) return

    const unlistenInstalling = listen<string>('browser-extension-installing', (event) => {
      if (event.payload?.toLowerCase() === listing.id.toLowerCase()) {
        setPhase('installing')
        setError('')
      }
    })

    const unlistenInstalled = listen<string>('browser-extension-installed', (event) => {
      if (event.payload?.toLowerCase() === listing.id.toLowerCase()) {
        setPhase('installed')
      }
    })

    const unlistenError = listen<string>('browser-extension-error', (event) => {
      setError(event.payload || 'Failed to install extension')
      setPhase('error')
    })

    return () => {
      void unlistenInstalling.then((fn) => fn())
      void unlistenInstalled.then((fn) => fn())
      void unlistenError.then((fn) => fn())
    }
  }, [listing.id])

  const install = async () => {
    playHapticPop()
    setPhase('installing')
    setError('')
    try {
      await installStoreExtension(listing.id)
      setPhase('installed')
    } catch (err) {
      setError(errorMessage(err))
      setPhase('error')
    }
  }

  if (phase === 'checking') return null

  return (
    <div className="stream-detector-pill extension-store-pill" role="status" aria-live="polite">
      <div className="stream-bolt-icon" aria-hidden="true">
        <IconPuzzlePiece size={14} />
      </div>
      {phase === 'installed' ? (
        <>
          <span className="stream-format-badge">
            <IconCheck size={11} /> Added
          </span>
          <button
            type="button"
            className="stream-action-chip"
            onClick={() => {
              playHapticClick()
              onManage?.()
            }}
          >
            Manage
          </button>
        </>
      ) : phase === 'error' ? (
        <>
          <span className="stream-format-badge extension-store-pill-error" title={error}>
            {error}
          </span>
          <button type="button" className="stream-action-chip primary" onClick={() => void install()}>
            Retry
          </button>
        </>
      ) : (
        <button
          type="button"
          className="stream-action-chip primary"
          disabled={phase === 'installing'}
          onClick={() => void install()}
          title={`Add this extension to HyperStream's browser (from ${listing.store === 'chrome' ? 'Chrome Web Store' : 'Edge Add-ons'})`}
        >
          {phase === 'installing' ? 'Adding…' : 'Add to HyperStream'}
        </button>
      )}
    </div>
  )
}
