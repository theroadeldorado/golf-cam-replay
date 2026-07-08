import { homedir } from 'node:os'
import { join } from 'node:path'
import { GOLF_DIR_NAME, SETTINGS_FILE_NAME } from '@shared/constants'

/** ~/GolfSwings — shared with v1 so existing sessions remain visible.
 * REPLAYSWING_DATA_DIR overrides for tests. */
export function golfDir(): string {
  return process.env['REPLAYSWING_DATA_DIR'] ?? join(homedir(), GOLF_DIR_NAME)
}

export function settingsFilePath(): string {
  return join(golfDir(), SETTINGS_FILE_NAME)
}

export function logsDir(): string {
  return join(golfDir(), 'logs')
}
