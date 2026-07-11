import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { broadcast } from './ipc'
import { log } from './logging'

export function setupAutoUpdate(): void {
  if (!app.isPackaged) return

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => log.info(`Update available: ${info.version}`))
  autoUpdater.on('update-downloaded', (info) => {
    log.info(`Update ${info.version} downloaded; notifying renderer`)
    broadcast('update:ready', { version: info.version })
  })
  autoUpdater.on('error', (error) => log.warn(`Auto-update error: ${error.message}`))

  void autoUpdater.checkForUpdates().catch((error) => {
    log.warn(`Update check failed: ${error}`)
  })
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
