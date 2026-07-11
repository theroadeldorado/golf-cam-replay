import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'

export interface AppPrefs {
  dataDir: string | null
}

const DEFAULT_PREFS: AppPrefs = { dataDir: null }

let cached: AppPrefs | null = null

function prefsPath(): string {
  return join(app.getPath('userData'), 'app-prefs.json')
}

export function loadAppPrefs(): AppPrefs {
  if (cached) return cached
  const path = prefsPath()
  if (!existsSync(path)) {
    cached = { ...DEFAULT_PREFS }
    return cached
  }
  try {
    cached = { ...DEFAULT_PREFS, ...JSON.parse(readFileSync(path, 'utf-8')) }
    return cached!
  } catch {
    cached = { ...DEFAULT_PREFS }
    return cached
  }
}

export function saveAppPrefs(prefs: AppPrefs): void {
  cached = prefs
  const path = prefsPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(prefs, null, 2), 'utf-8')
  renameSync(tmp, path)
}
