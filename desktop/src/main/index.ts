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
