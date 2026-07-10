import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Vision trigger end-to-end: the fake camera plays a generated y4m of a
 * "swing" — 4s of still gray (address) then 1.5s of strobing (the swing).
 * Arm the app and a clip must save with trigger.source === 'vision',
 * with zero manual interaction.
 */

const WIDTH = 160
const HEIGHT = 120
const FPS = 15

function makeSwingY4m(path: string): void {
  const header = `YUV4MPEG2 W${WIDTH} H${HEIGHT} F${FPS}:1 Ip A1:1 C420\n`
  const ySize = WIDTH * HEIGHT
  const cSize = (WIDTH / 2) * (HEIGHT / 2)
  const frames: Buffer[] = [Buffer.from(header, 'ascii')]

  const frame = (luma: number): Buffer =>
    Buffer.concat([
      Buffer.from('FRAME\n', 'ascii'),
      Buffer.alloc(ySize, luma),
      Buffer.alloc(cSize, 128),
      Buffer.alloc(cSize, 128)
    ])

  // A real swing is a BRIEF burst that settles — not sustained motion (which
  // the shape filter now correctly rejects). ~4s still address → ~0.3s strobe
  // → ~1.5s still, so motion spikes then settles within the confirm window.
  for (let i = 0; i < FPS * 4; i++) frames.push(frame(128)) // still address (> 1s still-duration)
  for (let i = 0; i < Math.round(FPS * 0.3); i++) frames.push(frame(i % 2 === 0 ? 16 : 235)) // swing burst
  for (let i = 0; i < Math.round(FPS * 1.5); i++) frames.push(frame(128)) // settle back to still
  writeFileSync(path, Buffer.concat(frames))
}

let app: ElectronApplication
let page: Page
let dataDir: string

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'rs-vision-'))
  const fixture = join(dataDir, 'swing.y4m')
  makeSwingY4m(fixture)

  app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      REPLAYSWING_DATA_DIR: dataDir,
      REPLAYSWING_FAKE_MEDIA: '1',
      REPLAYSWING_FAKE_MEDIA_FILE: fixture,
      // The synthetic feed has no person; bypass the ML presence gate so this
      // test exercises the shape filter (presence itself is validated separately).
      REPLAYSWING_DISABLE_PRESENCE: '1'
    }
  })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test('armed app auto-captures when the vision trigger fires', async () => {
  await page.getByRole('button', { name: 'Add camera' }).click()
  await page.getByTestId('camera-option').first().click()
  await expect(page.getByText(/\d+ fps/)).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: /^Arm/ }).click()

  // The meter must reach 'address' during the still phase...
  await expect(page.getByTestId('vision-state')).toHaveText('address', { timeout: 20_000 })

  // ...and the strobe phase must fire a capture with NO manual trigger.
  await expect(page.getByText(/Saved shot_0000\.mp4/)).toBeVisible({ timeout: 40_000 })

  const sessions = readdirSync(dataDir).filter((name) =>
    /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(name)
  )
  const clips = JSON.parse(readFileSync(join(dataDir, sessions[0], 'clips.json'), 'utf-8'))
  expect(clips[0].v2.trigger.source).toBe('vision')
})
