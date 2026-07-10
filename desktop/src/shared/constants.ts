import type { Settings } from './types'

export const APP_NAME = 'ReplaySwing'

/** Folder under the user's home directory shared with v1 (sessions, logs). */
export const GOLF_DIR_NAME = 'GolfSwings'

/** v2 has its own settings file so v1 and v2 never fight over one file. */
export const SETTINGS_FILE_NAME = 'settings.v2.json'

export const DEFAULT_SETTINGS: Settings = {
  preRollSec: 2.0,
  postRollSec: 4.0,
  cooldownSec: 6.0,
  fps: 30,
  cameras: [],
  primaryCameraId: null,
  sensitivity: 2,
  requirePresence: true,
  roi: null,
  pip: { bounds: null, visible: false },
  mainWindowBounds: null,
  drawings: {}
}

export const MAX_CAMERAS = 4
