import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Drawing tools: draw a line and a circle on the camera tile, edit via
 * handles, recolor, verify persistence in settings.v2.json, delete.
 */

let app: ElectronApplication
let page: Page
let dataDir: string

function readDrawings(): Record<string, { kind: string; color: string; x2?: number }[]> {
  return JSON.parse(readFileSync(join(dataDir, 'settings.v2.json'), 'utf-8')).drawings
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'rs-draw-'))
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, REPLAYSWING_DATA_DIR: dataDir, REPLAYSWING_FAKE_MEDIA: '1' }
  })
  page = await app.firstWindow()
  await page.getByRole('button', { name: 'Add camera' }).click()
  await page.getByTestId('camera-option').first().click()
  await expect(page.getByText(/\d+ fps/)).toBeVisible({ timeout: 20_000 })
})

test.afterAll(async () => {
  await app?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

async function dragOnOverlay(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const overlay = page.locator('.drawing-overlay').first()
  const box = (await overlay.boundingBox())!
  await page.mouse.move(box.x + box.width * from.x, box.y + box.height * from.y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to.x, box.y + box.height * to.y, { steps: 5 })
  await page.mouse.up()
}

test('draws, edits, recolors, persists, and deletes a line', async () => {
  await page.getByTestId('draw-toggle').click()
  await page.getByTestId('tool-line').click()

  // Draw a horizontal line across the middle of the video.
  await dragOnOverlay({ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 })
  await expect(page.getByTestId('drawn-line')).toHaveCount(1)

  // New shapes come selected — drag the p2 endpoint handle to reshape.
  const before = await page.getByTestId('drawn-line').getAttribute('x2')
  await page.getByTestId('tool-select').click()
  const handle = page.getByTestId('handle-p2')
  await expect(handle).toBeVisible()
  const handleBox = (await handle.boundingBox())!
  await page.mouse.move(handleBox.x + 7, handleBox.y + 7)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + 120, handleBox.y - 80, { steps: 5 })
  await page.mouse.up()
  const after = await page.getByTestId('drawn-line').getAttribute('x2')
  expect(after).not.toBe(before)

  // Recolor the selected line via a swatch.
  await page.getByTestId('color-#43b06c').click()

  // Committed to settings: one green line for this camera.
  await expect
    .poll(() => Object.values(readDrawings()).flat().map((s) => `${s.kind}:${s.color}`))
    .toEqual(['line:#43b06c'])

  // Delete via keyboard.
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('drawn-line')).toHaveCount(0)
  await expect.poll(() => Object.values(readDrawings()).flat()).toEqual([])
})

test('draws a circle and exits draw mode with Esc', async () => {
  await page.getByTestId('tool-circle').click()
  await dragOnOverlay({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 })
  await expect(page.getByTestId('drawn-circle')).toHaveCount(1)
  await expect.poll(() => Object.values(readDrawings()).flat().map((s) => s.kind)).toEqual(['circle'])

  // Esc leaves draw mode (toolbar collapses) without dismissing anything else.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tool-circle')).toBeHidden()
  // The circle still renders as a display-only overlay.
  await expect(page.getByTestId('drawn-circle')).toHaveCount(1)
})
