import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from '../../src/main/settings-store'
import { DEFAULT_SETTINGS } from '@shared/constants'

describe('SettingsStore', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rs-settings-'))
    filePath = join(dir, 'settings.v2.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns defaults when no file exists', () => {
    const store = new SettingsStore(filePath)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(existsSync(filePath)).toBe(false)
  })

  it('persists a patch and round-trips through a new instance', () => {
    const store = new SettingsStore(filePath)
    store.set({ preRollSec: 3.5, audioThreshold: 0.15 })

    const reloaded = new SettingsStore(filePath)
    expect(reloaded.get().preRollSec).toBe(3.5)
    expect(reloaded.get().audioThreshold).toBe(0.15)
    expect(reloaded.get().postRollSec).toBe(DEFAULT_SETTINGS.postRollSec)
  })

  it('writes atomically — no temp file left behind', () => {
    const store = new SettingsStore(filePath)
    store.set({ fps: 60 })
    expect(readdirSync(dir)).toEqual(['settings.v2.json'])
  })

  it('recovers from a corrupt file, preserving it for inspection', () => {
    writeFileSync(filePath, '{not json!!', 'utf-8')
    const store = new SettingsStore(filePath)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(existsSync(`${filePath}.corrupt`)).toBe(true)
  })

  it('merges unknown/missing fields over defaults (forward compat)', () => {
    writeFileSync(filePath, JSON.stringify({ fps: 60, futureField: true }), 'utf-8')
    const store = new SettingsStore(filePath)
    expect(store.get().fps).toBe(60)
    expect(store.get().preRollSec).toBe(DEFAULT_SETTINGS.preRollSec)
  })

  it('creates parent directories on first write', () => {
    const nested = join(dir, 'a', 'b', 'settings.v2.json')
    const store = new SettingsStore(nested)
    store.set({ fps: 60 })
    expect(JSON.parse(readFileSync(nested, 'utf-8')).fps).toBe(60)
  })
})
