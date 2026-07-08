import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { log } from './logging'

/**
 * Auto-update from GitHub Releases (publish config in electron-builder.yml).
 * Checks on startup, downloads in the background, installs on quit —
 * replaces v1's manual "download the new exe" flow.
 */
export function setupAutoUpdate(): void {
  if (!app.isPackaged) return

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => log.info(`Update available: ${info.version}`))
  autoUpdater.on('update-downloaded', (info) =>
    log.info(`Update ${info.version} downloaded; installs on quit`)
  )
  autoUpdater.on('error', (error) => log.warn(`Auto-update error: ${error.message}`))

  void autoUpdater.checkForUpdates().catch((error) => {
    log.warn(`Update check failed: ${error}`)
  })
}
