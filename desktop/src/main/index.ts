import { app, BrowserWindow } from 'electron'
import { setupLogging, log } from './logging'
import { SettingsStore } from './settings-store'
import { settingsFilePath } from './paths'
import { registerIpc } from './ipc'
import { createMainWindow } from './windows'
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

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
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

    const store = new SettingsStore(settingsFilePath())
    registerIpc(store)
    mainWindow = createMainWindow(store)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(store)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
