import { app, ipcMain, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const SPIKE_TIMEOUT_MS = 120_000

/**
 * Headless diagnostic mode: `ReplaySwing --spike=encode` opens a hidden window
 * running the named spike page, prints its JSON report to stdout, and exits.
 * Used to validate the media pipeline on end-user hardware (esp. Windows).
 */
export function spikeNameFromArgv(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith('--spike='))
  return arg ? arg.slice('--spike='.length) : null
}

export function runSpike(name: string): void {
  ipcMain.handle('spike:save-temp', (_event, fileName: string, data: ArrayBuffer) => {
    const path = join(tmpdir(), `replayswing-${basename(fileName)}`)
    writeFileSync(path, Buffer.from(data))
    return path
  })

  ipcMain.handle('spike:report', (_event, report: unknown) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    setTimeout(() => app.exit(0), 200)
  })

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const page = `spike-${name}.html`
  if (process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${page}`)
  } else {
    window.loadFile(join(__dirname, `../renderer/${page}`))
  }

  setTimeout(() => {
    process.stderr.write(`spike '${name}' timed out after ${SPIKE_TIMEOUT_MS}ms\n`)
    app.exit(2)
  }, SPIKE_TIMEOUT_MS)
}
