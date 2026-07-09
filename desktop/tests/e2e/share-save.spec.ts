import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Share-to-phone and save-to-disk on the replay stage: capture a clip, then
 * Share (fetch the served page + MP4 to prove the LAN server) and Save
 * (verify the file copies to a pre-set destination via the test seam).
 */

let app: ElectronApplication
let page: Page
let dataDir: string
let saveDest: string

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'rs-share-'))
  saveDest = join(dataDir, 'exported-swing.mp4')
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      REPLAYSWING_DATA_DIR: dataDir,
      REPLAYSWING_FAKE_MEDIA: '1',
      REPLAYSWING_SAVEAS_DEST: saveDest
    }
  })
  page = await app.firstWindow()
  await page.getByRole('button', { name: 'Add camera' }).click()
  await page.getByTestId('camera-option').first().click()
  await expect(page.getByText(/\d+ fps/)).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: /Record now/ }).click()
  await expect(page.getByText(/Saved shot_0000\.mp4/)).toBeVisible({ timeout: 30_000 })
})

test.afterAll(async () => {
  await app?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test('shares the clip over a LAN server the phone can reach', async () => {
  await page.getByTestId('share-clip').click()

  const shareUrl = (await page.getByTestId('share-url').textContent())!.trim()
  expect(shareUrl).toMatch(/^http:\/\/[\d.]+:\d+\/[A-Za-z0-9_-]{16,}$/)

  // Fetch from Node (the test process) — the phone reaches the same server.
  const landing = await (await fetch(shareUrl)).text()
  expect(landing).toContain('Your Shots')

  const items = (await (await fetch(`${shareUrl}/list`)).json()) as { label: string; src: string }[]
  expect(items).toHaveLength(1)
  expect(items[0].src).toMatch(/\.mp4$/)

  // The served MP4 matches the clip on disk.
  const origin = new URL(shareUrl).origin
  const served = Buffer.from(await (await fetch(`${origin}${items[0].src}`)).arrayBuffer())
  const session = readdirSync(dataDir).find((n) => /^\d{4}-\d{2}-\d{2}_/.test(n))!
  const onDisk = readFileSync(join(dataDir, session, 'shot_0000.mp4'))
  expect(served.equals(onDisk)).toBe(true)

  // Stop sharing tears the server down.
  await page.getByTestId('stop-sharing').click()
  await expect(page.getByTestId('share-url')).toBeHidden()
  const reachable = await fetch(shareUrl)
    .then(() => true)
    .catch(() => false)
  expect(reachable).toBe(false)
})

test('saves the clip to disk', async () => {
  await page.getByTestId('save-clip').click()
  await expect(page.getByText(/Saved to/)).toBeVisible()
  expect(existsSync(saveDest)).toBe(true)

  const session = readdirSync(dataDir).find((n) => /^\d{4}-\d{2}-\d{2}_/.test(n))!
  const original = readFileSync(join(dataDir, session, 'shot_0000.mp4'))
  expect(readFileSync(saveDest).equals(original)).toBe(true)
})
