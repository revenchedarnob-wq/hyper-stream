#!/usr/bin/env node
/**
 * Performance budget check for the release build (Windows).
 *
 *   npx tauri build --no-bundle
 *   npm run perf:smoke
 *
 * Launches HyperStream.exe with a local DevTools port and fails (exit 1) if any budget is broken.
 * Budgets come from measurements on the optimized build; loosen one only on purpose.
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const EXE = path.join(ROOT, 'src-tauri/target/release/HyperStream.exe')
const PORT = 9341

const BUDGET = {
  exeMB: 12,
  mainJsKB: 340,
  startupCssKB: 110,
  firstPaintMs: 900,
  idleLayers: 2,
  idleLayerAreaVsWindow: 1.1,
  idleCpuPctOfCore: 1.5,
  runningAnimationsIdle: 0,
}

const results = []
const check = (name, value, limit, unit = '') => results.push({ name, value, limit, unit, ok: value <= limit })

// ---------- Static: build output ----------
if (!fs.existsSync(EXE)) {
  console.error('Release build not found. Run: npx tauri build --no-bundle')
  process.exit(1)
}
check('exe size', +(fs.statSync(EXE).size / 1048576).toFixed(1), BUDGET.exeMB, ' MB')
const assets = path.join(ROOT, 'dist/assets')
const files = fs.readdirSync(assets)
const kb = (f) => Math.round(fs.statSync(path.join(assets, f)).size / 1024)
check('main script', Math.max(...files.filter((f) => /^index-.*\.js$/.test(f)).map(kb)), BUDGET.mainJsKB, ' KB')
check('startup CSS', Math.max(...files.filter((f) => /^index-.*\.css$/.test(f)).map(kb)), BUDGET.startupCssKB, ' KB')

// ---------- Live: launch and inspect ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  detached: false,
  stdio: 'ignore',
})

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = targets.find((t) => t.type === 'page' && /tauri\.localhost/.test(t.url))
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // not up yet
    }
    await sleep(150)
  }
  throw new Error('App did not open its DevTools port')
}

let ws
try {
  ws = new WebSocket(await connect())
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  let layers = null
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
    if (m.method === 'LayerTree.layerTreeDidChange' && m.params.layers) layers = m.params.layers
  })
  const call = (method, params = {}) =>
    new Promise((r) => {
      const my = ++id
      pending.set(my, r)
      ws.send(JSON.stringify({ id: my, method, params }))
    })
  const js = async (expression) =>
    (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value

  await sleep(4000)
  check('first paint', Math.round(await js(`performance.getEntriesByType('paint').at(-1)?.startTime ?? 99999`)), BUDGET.firstPaintMs, ' ms')

  // Every screen must be visible even while the window is unfocused (entrance animations must run).
  const blank = await js(`(async () => {
    const w = document.querySelector('.window-container'); w.classList.add('is-unfocused')
    const out = []
    for (const i of [2, 3, 1, 0]) {
      document.querySelectorAll('.nav-item')[i].click()
      await new Promise((r) => setTimeout(r, 900))
      const view = [...document.querySelectorAll('.hub-view-container')].find((e) => e.offsetParent)
      if (!view || getComputedStyle(view).opacity !== '1') out.push(i)
    }
    return out.length
  })()`)
  check('screens blank while unfocused', blank, 0)

  await sleep(1500)
  await call('LayerTree.enable')
  await js('document.body.style.outline = "1px solid transparent"; requestAnimationFrame(() => (document.body.style.outline = ""))')
  await sleep(1500)
  const drawn = (layers || []).filter((l) => l.drawsContent)
  const area = drawn.reduce((s, l) => s + l.width * l.height, 0)
  const windowArea = await js('innerWidth * innerHeight')
  check('GPU layers at idle', drawn.length, BUDGET.idleLayers)
  check('GPU layer area / window', +(area / windowArea).toFixed(2), BUDGET.idleLayerAreaVsWindow, 'x')
  check('animations running at idle', await js(`document.getAnimations().filter((a) => a.playState === 'running').length`), BUDGET.runningAnimationsIdle)

  // Idle CPU of the whole app (host + WebView2 processes) over 10 s.
  const cpuMs = () =>
    Number(
      execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `$r=Get-CimInstance Win32_Process -Filter "ProcessId=${app.pid}";$a=Get-CimInstance Win32_Process;$ids=@($r.ProcessId);$t=@($r);do{$k=@($a|?{$ids -contains $_.ParentProcessId});$t+=$k;$ids=@($k.ProcessId)}while($k.Count);($t|%{(Get-Process -Id $_.ProcessId -EA SilentlyContinue).TotalProcessorTime.TotalMilliseconds}|Measure-Object -Sum).Sum`,
      ]).toString().trim(),
    )
  const c0 = cpuMs()
  await sleep(10000)
  check('idle CPU (% of one core)', +(((cpuMs() - c0) / 10000) * 100).toFixed(2), BUDGET.idleCpuPctOfCore, '%')
} finally {
  ws?.close()
  try {
    execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    // already gone
  }
}

let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(32)} ${String(r.value + r.unit).padStart(10)}   budget ${r.limit}${r.unit}`)
}
console.log(failed ? `\n${failed} budget(s) broken.` : '\nAll performance budgets met.')
process.exit(failed ? 1 : 0)
