import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShareServer, pickLanIp } from '../../src/main/share-server'

const CLIP_BYTES = Buffer.from('fake-mp4-payload-0123456789', 'utf-8')

describe('pickLanIp', () => {
  it('prefers a non-internal private IPv4', () => {
    const ip = pickLanIp({
      lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true } as never],
      en0: [
        { family: 'IPv6', address: 'fe80::1', internal: false } as never,
        { family: 'IPv4', address: '192.168.1.24', internal: false } as never
      ]
    })
    expect(ip).toBe('192.168.1.24')
  })

  it('falls back to localhost when only internal addresses exist', () => {
    expect(pickLanIp({ lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true } as never] })).toBe(
      '127.0.0.1'
    )
  })
})

describe('ShareServer', () => {
  let dir: string
  let server: ShareServer

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rs-share-'))
    mkdirSync(join(dir, 'sess1'))
    writeFileSync(join(dir, 'sess1', 'shot_0000.mp4'), CLIP_BYTES)
    server = new ShareServer(dir)
  })

  afterEach(async () => {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts on first share and returns a landing URL with the session token', async () => {
    const { url } = await server.share('sess1', 'shot_0000.mp4', 'Shot 1')
    expect(url).toMatch(/^http:\/\/[\d.]+:\d+\/[A-Za-z0-9_-]{16,}$/)
  })

  it('serves a landing page listing the shared clip', async () => {
    const { url } = await server.share('sess1', 'shot_0000.mp4', 'Shot 1')
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const html = await res.text()
    // Labels render client-side from /list (enables scan-once auto-refresh);
    // the page itself just needs to load and poll.
    expect(html).toContain('Your Shots')
    expect(html).toContain('/list')
  })

  it('lists shared clips as JSON, newest first', async () => {
    const { url } = await server.share('sess1', 'shot_0000.mp4', 'Shot 1')
    writeFileSync(join(dir, 'sess1', 'shot_0001.mp4'), CLIP_BYTES)
    await server.share('sess1', 'shot_0001.mp4', 'Shot 2')
    const res = await fetch(`${url}/list`)
    const list = (await res.json()) as { label: string; src: string }[]
    expect(list.map((c) => c.label)).toEqual(['Shot 2', 'Shot 1'])
    expect(list[0].src).toMatch(/\.mp4$/)
  })

  it('streams the full clip with the right content type', async () => {
    const { url } = await server.share('sess1', 'shot_0000.mp4', 'Shot 1')
    const list = (await (await fetch(`${url}/list`)).json()) as { src: string }[]
    const base = url.slice(0, url.lastIndexOf('/'))
    const res = await fetch(`${base}${list[0].src}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(CLIP_BYTES)
  })

  it('honors a Range request with a 206 and the correct slice', async () => {
    const { url } = await server.share('sess1', 'shot_0000.mp4', 'Shot 1')
    const list = (await (await fetch(`${url}/list`)).json()) as { src: string }[]
    const base = url.slice(0, url.lastIndexOf('/'))
    const res = await fetch(`${base}${list[0].src}`, { headers: { Range: 'bytes=5-9' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 5-9/${CLIP_BYTES.length}`)
    expect(Buffer.from(await res.arrayBuffer())).toEqual(CLIP_BYTES.subarray(5, 10))
  })

  it('404s an unknown clip token', async () => {
    const { url } = await server.share('sess1', 'shot_0000.mp4', 'Shot 1')
    const base = url.slice(0, url.lastIndexOf('/'))
    const res = await fetch(`${base}/deadbeefdeadbeef.mp4`)
    expect(res.status).toBe(404)
  })

  it('404s a request with the wrong session token (no directory listing)', async () => {
    const { url } = await server.share('sess1', 'shot_0000.mp4', 'Shot 1')
    const origin = new URL(url).origin
    expect((await fetch(`${origin}/not-the-token`)).status).toBe(404)
    expect((await fetch(`${origin}/`)).status).toBe(404)
  })

  it('reuses one server/token across multiple shares', async () => {
    const a = await server.share('sess1', 'shot_0000.mp4', 'Shot 1')
    writeFileSync(join(dir, 'sess1', 'shot_0001.mp4'), CLIP_BYTES)
    const b = await server.share('sess1', 'shot_0001.mp4', 'Shot 2')
    expect(new URL(a.url).host).toBe(new URL(b.url).host)
    expect(a.url).toBe(b.url) // same landing page
  })

  it('stops serving after stop()', async () => {
    const { url } = await server.share('sess1', 'shot_0000.mp4', 'Shot 1')
    await server.stop()
    await expect(fetch(url)).rejects.toThrow()
  })
})
