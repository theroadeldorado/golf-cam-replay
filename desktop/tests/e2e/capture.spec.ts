import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Full capture loop against the built app with Chromium's fake camera:
 * add camera → manual trigger → MP4 + thumbnail + clips.json on disk →
 * instant replay overlay shown.
 *
 * Prereq: `npm run build` (launches out/main/index.js).
 */

let app: ElectronApplication
let page: Page
let dataDir: string

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'rs-e2e-'))
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      REPLAYSWING_DATA_DIR: dataDir,
      REPLAYSWING_FAKE_MEDIA: '1'
    }
  })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test('captures a clip from the fake camera via manual trigger', async () => {
  await expect(page.getByText('No cameras yet', { exact: false })).toBeVisible()

  // Add the fake camera.
  await page.getByRole('button', { name: 'Add camera' }).click()
  await page.getByTestId('camera-option').first().click()

  // Tile goes live and reports a frame rate.
  await expect(page.getByText(/\d+ fps/)).toBeVisible({ timeout: 20_000 })

  // Give the ring a moment to fill some pre-roll, then trigger.
  await page.waitForTimeout(2_500)
  await page.getByRole('button', { name: /Record now/ }).click()

  // Post-roll is 4s; the replay overlay appears after mux + save.
  await expect(page.getByText(/Saved shot_0000\.mp4/)).toBeVisible({ timeout: 30_000 })

  // Verify the on-disk session matches the v1 format.
  const sessions = readdirSync(dataDir).filter((name) =>
    /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(name)
  )
  expect(sessions).toHaveLength(1)
  const sessionDir = join(dataDir, sessions[0])

  const clips = JSON.parse(readFileSync(join(sessionDir, 'clips.json'), 'utf-8'))
  expect(clips).toHaveLength(1)
  expect(clips[0].file).toBe('shot_0000.mp4')
  expect(clips[0].cameras).toBe(1)
  expect(clips[0].v2.trigger.source).toBe('manual')

  const mp4Stat = statSync(join(sessionDir, 'shot_0000.mp4'))
  expect(mp4Stat.size).toBeGreaterThan(100_000) // ~6s of 720p H.264

  const thumbnail = statSync(join(sessionDir, clips[0].thumbnail))
  expect(thumbnail.size).toBeGreaterThan(1_000)

  // Replay dismisses with Escape.
  await page.keyboard.press('Escape')
  await expect(page.getByText(/Saved shot_0000\.mp4/)).toBeHidden()
})

test('captures a second clip in the same session', async () => {
  await page.keyboard.press('t')
  await expect(page.getByText(/Saved shot_0001\.mp4/)).toBeVisible({ timeout: 30_000 })

  const sessions = readdirSync(dataDir).filter((name) => /^\d{4}-/.test(name))
  const clips = JSON.parse(readFileSync(join(dataDir, sessions[0], 'clips.json'), 'utf-8'))
  expect(clips).toHaveLength(2)
})

test('selecting a shot from the rail plays it on the stage', async () => {
  // Back to live if a replay is up (click, not Escape — robust to focus).
  const backToLive = page.getByRole('button', { name: 'Back to live' })
  if (await backToLive.isVisible().catch(() => false)) await backToLive.click()
  await page.locator('.shot-card').last().click() // oldest shot

  await expect(page.getByText(/shot_0000\.mp4/)).toBeVisible()
  // The clip actually decodes and plays — not a black frame.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const v = document.querySelector('.replay-stage video') as HTMLVideoElement | null
        return v ? { w: v.videoWidth, err: v.error?.code ?? null } : null
      })
    )
    .toEqual({ w: 1280, err: null })

  // Slow-mo slider drives the replay's playbackRate.
  await page.getByTestId('replay-speed-slider').fill('0.25')
  await expect(page.getByTestId('replay-speed')).toHaveText('0.25×')
  const rate = await page.evaluate(
    () => (document.querySelector('.replay-stage video') as HTMLVideoElement).playbackRate
  )
  expect(rate).toBeCloseTo(0.25)
})
