import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Swing comparison: capture two clips, enter compare mode, pick A then B,
 * and verify both videos load and play synced, and that an offset nudge
 * shifts B relative to A.
 */

let app: ElectronApplication
let page: Page
let dataDir: string

async function videoState(side: 'a' | 'b'): Promise<{ w: number; t: number }> {
  return page.evaluate((s) => {
    const v = document.querySelector(`[data-testid="compare-video-${s}"]`) as HTMLVideoElement
    return { w: v.videoWidth, t: v.currentTime }
  }, side)
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'rs-compare-'))
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, REPLAYSWING_DATA_DIR: dataDir, REPLAYSWING_FAKE_MEDIA: '1' }
  })
  page = await app.firstWindow()
  await page.getByRole('button', { name: 'Add camera' }).click()
  await page.getByTestId('camera-option').first().click()
  await expect(page.getByText(/\d+ fps/)).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(2500)
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('t')
    await expect(page.getByText(new RegExp(`Saved shot_000${i}\\.mp4`))).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Escape')
  }
})

test.afterAll(async () => {
  await app?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test('picks two shots and plays them synced with an offset nudge', async () => {
  await page.getByTestId('compare-start').click()
  await expect(page.getByTestId('pick-banner')).toContainText('first shot')

  await page.locator('.shot-card').first().click() // A
  await expect(page.getByTestId('pick-banner')).toContainText('second shot')
  await page.locator('.shot-card').last().click() // B

  // Both panes load real video.
  await expect(page.getByTestId('compare-video-a')).toBeVisible()
  await expect.poll(async () => (await videoState('a')).w).toBe(1280)
  await expect.poll(async () => (await videoState('b')).w).toBe(1280)

  // Playing by default — both advance.
  await page.waitForTimeout(800)
  expect((await videoState('a')).t).toBeGreaterThan(0)
  expect((await videoState('b')).t).toBeGreaterThan(0)

  // Pause, seek to start, then an offset nudge shifts B ahead of A.
  await page.getByTestId('compare-playpause').click() // pause
  await expect(page.getByTestId('offset-value')).toContainText('B +0f')
  await page.getByTestId('offset-plus').click()
  await page.getByTestId('offset-plus').click()
  await expect(page.getByTestId('offset-value')).toContainText('B +2f')
  const { t: ta } = await videoState('a')
  const { t: tb } = await videoState('b')
  expect(tb).toBeGreaterThan(ta) // B is ahead by the offset

  // Exit returns to the live view.
  await page.getByTestId('compare-exit').click()
  await expect(page.getByTestId('compare-video-a')).toBeHidden()
})
