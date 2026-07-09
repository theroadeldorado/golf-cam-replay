import { test, expect } from '@playwright/test'
import { _electron as electron, chromium, type Browser, type ElectronApplication, type Page } from 'playwright'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

/**
 * Phone pairing end-to-end with a mock phone:
 *  - an in-test HTTP server implements the signaling API (same contract as
 *    web/src/app/api/signal) AND serves a minimal /camera page that mirrors
 *    the real phone page's WebRTC flow,
 *  - the desktop app points at it via REPLAYSWING_WEB_BASE,
 *  - a headless Chromium with a fake camera plays the phone.
 * Real-device validation (iOS Safari / Android Chrome) is manual.
 */

const PHONE_PAGE = `<!doctype html><html><body><script>
  const sessionId = new URLSearchParams(location.search).get('s')
  const base = '/api/signal/' + sessionId + '/phone'
  const post = (type, payload) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, payload }) })
  ;(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    const peer = new RTCPeerConnection()
    for (const track of stream.getTracks()) peer.addTrack(track, stream)
    const heartbeat = peer.createDataChannel('heartbeat')
    setInterval(() => { if (heartbeat.readyState === 'open') heartbeat.send(String(Date.now())) }, 2000)
    peer.onicecandidate = (e) => post('candidate', e.candidate ? e.candidate.toJSON() : null)
    peer.onconnectionstatechange = () => { document.title = peer.connectionState }
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    await post('offer', { sdp: offer.sdp })
    let since = 0
    setInterval(async () => {
      const res = await fetch(base + '?since=' + since)
      const { messages } = await res.json()
      for (const m of messages) {
        since = Math.max(since, m.seq)
        if (m.type === 'answer') await peer.setRemoteDescription({ type: 'answer', sdp: m.payload.sdp })
        else if (m.type === 'candidate' && m.payload) await peer.addIceCandidate(m.payload)
      }
    }, 500)
  })()
</script></body></html>`

function startStubServer(): Promise<Server> {
  const inboxes = new Map<string, { type: string; payload: unknown; seq: number }[]>()
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    const match = url.pathname.match(/^\/api\/signal\/([\w-]+)\/(desktop|phone)$/)
    if (url.pathname === '/camera') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(PHONE_PAGE)
      return
    }
    if (!match) {
      res.writeHead(404)
      res.end()
      return
    }
    const [, session, role] = match
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const other = role === 'desktop' ? 'phone' : 'desktop'
        const key = `${session}:${other}`
        const list = inboxes.get(key) ?? []
        const message = JSON.parse(body)
        list.push({ ...message, seq: list.length + 1 })
        inboxes.set(key, list)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      })
    } else {
      const since = Number(url.searchParams.get('since') ?? 0)
      const list = inboxes.get(`${session}:${role}`) ?? []
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ messages: list.slice(since) }))
    }
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

let server: Server
let app: ElectronApplication
let page: Page
let phoneBrowser: Browser
let dataDir: string

test.beforeAll(async () => {
  server = await startStubServer()
  const port = (server.address() as AddressInfo).port
  dataDir = mkdtempSync(join(tmpdir(), 'rs-phone-'))

  app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      REPLAYSWING_DATA_DIR: dataDir,
      REPLAYSWING_FAKE_MEDIA: '1',
      REPLAYSWING_WEB_BASE: `http://127.0.0.1:${port}`
    }
  })
  page = await app.firstWindow()

  phoneBrowser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  })
})

test.afterAll(async () => {
  await phoneBrowser?.close()
  await app?.close()
  server?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test('phone pairs via QR session and its stream becomes a recordable camera', async () => {
  await page.getByRole('button', { name: 'Add phone' }).click()
  const pairingUrl = (await page.getByTestId('pairing-url').textContent())!.trim()
  expect(pairingUrl).toMatch(/\/camera\?s=[\w-]{16,}/)

  // "Scan the QR": open the pairing URL in the mock phone.
  const phonePage = await phoneBrowser.newPage()
  await phonePage.goto(pairingUrl)

  // Desktop side: pairing dialog closes and a live Phone tile appears.
  await expect(page.getByTestId('pairing-url')).toBeHidden({ timeout: 30_000 })
  await expect(page.getByText(/Phone · \d+ fps/)).toBeVisible({ timeout: 30_000 })

  // The phone stream records like any camera.
  await page.getByRole('button', { name: /Record now/ }).click()
  await expect(page.getByText(/Saved shot_0000\.mp4/)).toBeVisible({ timeout: 30_000 })

  const sessions = readdirSync(dataDir).filter((name) => /^\d{4}-\d{2}-\d{2}_/.test(name))
  const clips = JSON.parse(readFileSync(join(dataDir, sessions[0], 'clips.json'), 'utf-8'))
  expect(clips[0].cameras).toBe(1)
  expect(Object.values(clips[0].camera_labels)).toContain('Phone')
})
