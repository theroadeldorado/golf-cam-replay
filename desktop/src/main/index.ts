import { app, net, protocol } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setupLogging, log } from './logging'
import { SettingsStore } from './settings-store'
import { golfDir, settingsFilePath } from './paths'
import { registerIpc } from './ipc'
import { WindowRegistry } from './windows'
import { runSpike, spikeNameFromArgv } from './spike'

// Advertise raw LAN IPs in WebRTC host candidates instead of mDNS .local
// names, so a phone on the same network can always dial this machine even
// when the router blocks mDNS multicast.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns')

// E2E tests: synthetic camera + auto-granted permissions. An optional y4m
// file drives the fake camera's content (used to exercise the vision trigger).
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
    const spikeName = spikeNameFromArgv(process.argv)
    if (spikeName) {
      runSpike(spikeName)
      return
    }

    setupLogging()
    log.info(`ReplaySwing v${__APP_VERSION__} starting`)
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
