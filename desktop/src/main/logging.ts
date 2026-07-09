import log from 'electron-log/main'
import { join } from 'node:path'
import { logsDir } from './paths'

export function setupLogging(): void {
  log.initialize()
  log.transports.file.resolvePathFn = () => join(logsDir(), 'desktop-v2.log')
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.errorHandler.startCatching()
}

export { log }
