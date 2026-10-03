import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * The desktop app shows wallpapers through their small blurred and thumbnail versions; the
 * full-size JPEGs are only used by the browser preview (`npm run dev`). Leaving them out of
 * `tauri build` keeps ~8 MB out of the installed app.
 */
function dropPreviewWallpapers(): Plugin {
  return {
    name: 'drop-preview-wallpapers',
    apply: 'build',
    closeBundle() {
      if (!process.env.TAURI_ENV_PLATFORM) return
      const dir = path.resolve(import.meta.dirname, 'dist/wallpapers')
      for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        if (/^bg-.*\.jpg$/.test(name)) fs.rmSync(path.join(dir, name))
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), dropPreviewWallpapers()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    cssCodeSplit: true,
  },
})
