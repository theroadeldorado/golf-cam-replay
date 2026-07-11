import { homedir } from 'node:os'
import { join } from 'node:path'
import { GOLF_DIR_NAME, SETTINGS_FILE_NAME } from '@shared/constants'
import { loadAppPrefs } from './app-prefs'

/** ~/GolfSwings — shared with v1 so existing sessions remain visible.
 * REPLAYSWING_DATA_DIR overrides for tests. App prefs override for user-chosen directory. */
export function golfDir(): string {
  if (process.env['REPLAYSWING_DATA_DIR']) return process.env['REPLAYSWING_DATA_DIR']
  const prefs = loadAppPrefs()
  if (prefs.dataDir) return prefs.dataDir
  return join(homedir(), GOLF_DIR_NAME)
}

export function settingsFilePath(): string {
  return join(golfDir(), SETTINGS_FILE_NAME)
}

export function logsDir(): string {
  return join(golfDir(), 'logs')
}
