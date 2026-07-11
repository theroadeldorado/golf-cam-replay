import { app, ipcMain, net, protocol, session } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setupLogging, log } from './logging'
import { SettingsStore } from './settings-store'
import { golfDir, settingsFilePath } from './paths'
import { registerIpc } from './ipc'
import { WindowRegistry } from './windows'
import { runSpike, spikeNameFromArgv } from './spike'
import { setupAutoUpdate } from './updater'
import { setupCrashCapture } from './crash'

// Advertise raw LAN IPs in WebRTC host candidates instead of mDNS .local
// names, so a phone on the same network can always dial this machine even
// when the router blocks mDNS multicast.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns')

// Tests point REPLAYSWING_DATA_DIR at a temp dir; give those instances their
// own userData too so the single-instance lock (scoped by userData) doesn't
// collide with a normally running app.
if (process.env['REPLAYSWING_DATA_DIR']) {
  app.setPath('userData', join(process.env['REPLAYSWING_DATA_DIR'], '.electron'))
}

// E2E tests: synthetic camera + auto-granted permissions. An optional y4m
// file drives the fake camera's content.
if (process.env['REPLAYSWING_FAKE_MEDIA']) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
  const fakeVideo = process.env['REPLAYSWING_FAKE_MEDIA_FILE']
  if (fakeVideo) {
    app.commandLine.appendSwitch('use-file-for-fake-video-capture', fakeVideo)
  }
}

// clip://media/<sessionId>/<file> streams saved clips/thumbnails to the
// renderer (file:// is blocked from http-served dev pages; this works in both).
protocol.registerSchemesAsPrivileged([
  { scheme: 'clip', privileges: { stream: true, supportFetchAPI: true } }
])

function registerClipProtocol(): void {
  protocol.handle('clip', (request) => {
    const url = new URL(request.url)
    const relativePath = decodeURIComponent(url.pathname).replace(/^\//, '')
    if (url.host !== 'media' || relativePath.split('/').some((part) => part === '..' || part === '')) {
      return new Response('bad request', { status: 400 })
    }
    return net.fetch(pathToFileURL(join(golfDir(), relativePath)).toString())
  })
}

// Reads a bundled renderer asset (e.g. the MediaPipe model + wasm) so the
// renderer can wrap it in a blob URL — a file:// page can't fetch these
// directly, and serving them over a custom scheme would change the app origin.
function registerAssetReader(): void {
  const rendererDir = join(__dirname, '../renderer')
  ipcMain.handle('asset:read', (_event, name: string): ArrayBuffer => {
    if (name.split('/').some((part) => part === '..' || part === '')) {
      throw new Error('invalid asset path')
    }
    const buf = readFileSync(join(rendererDir, name))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let windows: WindowRegistry | null = null

  app.on('second-instance', () => {
    const main = windows?.mainWindow
    if (main) {
      if (main.isMinimized()) main.restore()
      main.focus()
    }
  })

  app.whenReady().then(() => {
    // Auto-grant camera/mic permissions so getUserMedia works without prompts.
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      const allowed = ['media', 'mediaKeySystem', 'display-capture']
      callback(allowed.includes(permission))
    })

    // Rewrite the CSP to include the configured web base URL so signaling
    // fetch calls aren't blocked when pointing at a non-production host.
    const webBase = process.env['REPLAYSWING_WEB_BASE']
    if (webBase) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const csp = details.responseHeaders?.['content-security-policy']
        if (csp) {
          csp[0] = csp[0].replace(
            /connect-src\s/,
            `connect-src ${webBase} `
          )
        }
        callback({ responseHeaders: details.responseHeaders })
      })
    }

    // Available to both the spike windows and the normal app.
    registerAssetReader()

    const spikeName = spikeNameFromArgv(process.argv)
    if (spikeName) {
      runSpike(spikeName)
      return
    }

    setupLogging()
    log.info(`ReplaySwing v${__APP_VERSION__} starting`)
    setupCrashCapture()
    setupAutoUpdate()
    registerClipProtocol()

    const store = new SettingsStore(settingsFilePath())
    windows = new WindowRegistry(store)
    registerIpc(store, windows)
    windows.createMainWindow()

    app.on('activate', () => {
      if (windows && !windows.mainWindow) {
        windows.createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
