import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS } from '@shared/constants'
import type { Settings } from '@shared/types'

/**
 * JSON settings persistence with atomic writes (temp file then rename) and
 * corrupt-file recovery, matching the v1 approach. Pure Node — no Electron
 * imports — so it is unit-testable against a temp directory.
 */
export class SettingsStore {
  private settings: Settings

  constructor(private readonly filePath: string) {
    this.settings = this.load()
  }

  get(): Settings {
    return this.settings
  }

  set(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch }
    this.persist()
    return this.settings
  }

  private load(): Settings {
    if (!existsSync(this.filePath)) {
      return { ...DEFAULT_SETTINGS }
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      // Merge over defaults so new fields added in later versions get defaults.
      return { ...DEFAULT_SETTINGS, ...raw }
    } catch {
      // Corrupt file: preserve it for inspection, start fresh.
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt`)
      } catch {
        // If even the rename fails, fall through to defaults.
      }
      return { ...DEFAULT_SETTINGS }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    writeFileSync(tempPath, JSON.stringify(this.settings, null, 2), 'utf-8')
    renameSync(tempPath, this.filePath)
  }
}
