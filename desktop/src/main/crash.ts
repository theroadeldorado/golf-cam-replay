import { app, crashReporter } from 'electron'
import { log } from './logging'

/**
 * Local crash capture. Native crashes (GPU/codec) write minidumps to the
 * crashDumps dir; renderer/child exits are logged with reasons. Wiring these
 * to a remote service (Sentry) is a ship-readiness follow-up — the local
 * artifacts plus ~/GolfSwings/logs already beat v1's remote-log-server flow.
 */
export function setupCrashCapture(): void {
  crashReporter.start({ uploadToServer: false })
  log.info(`Crash dumps: ${app.getPath('crashDumps')}`)

  app.on('render-process-gone', (_event, webContents, details) => {
    log.error(`Renderer gone (${webContents.getURL()}): ${details.reason} exitCode=${details.exitCode}`)
  })
  app.on('child-process-gone', (_event, details) => {
    log.error(`Child process gone: ${details.type} ${details.name ?? ''} ${details.reason}`)
  })
  process.on('uncaughtException', (error) => {
    log.error(`Uncaught exception in main: ${error.stack ?? error.message}`)
  })
}
