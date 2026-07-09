import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'

/**
 * On-demand LAN server for beaming clips to a phone. Starts at first share,
 * runs until stop() or app quit. A single random session token gates a
 * landing page listing every shared clip; each clip streams (with HTTP range
 * support) under its own random token. Only registered clips are reachable —
 * no directory listing, tokens map to known files so path traversal is out.
 */

interface SharedClip {
  token: string
  sessionId: string
  fileName: string
  label: string
  sharedAt: number
}

function token(): string {
  return randomBytes(16).toString('base64url')
}

/** First non-internal private IPv4, else localhost. */
export function pickLanIp(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()
): string {
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address
    }
  }
  return '127.0.0.1'
}

export class ShareServer {
  private server: Server | null = null
  private sessionToken = token()
  private clips: SharedClip[] = []
  private lanIp = '127.0.0.1'
  private port = 0

  constructor(private readonly golfDir: string) {}

  /** Register a clip (starting the server if needed); returns the landing URL. */
  async share(
    sessionId: string,
    fileName: string,
    label: string
  ): Promise<{ url: string; token: string }> {
    await this.ensureStarted()
    if (!this.clips.some((c) => c.sessionId === sessionId && c.fileName === fileName)) {
      this.clips.unshift({ token: token(), sessionId, fileName, label, sharedAt: Date.now() })
    }
    return {
      url: `http://${this.lanIp}:${this.port}/${this.sessionToken}`,
      token: this.sessionToken
    }
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.clips = []
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  get isSharing(): boolean {
    return this.server !== null
  }

  private ensureStarted(): Promise<void> {
    if (this.server) return Promise.resolve()
    this.lanIp = pickLanIp()
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res))
      server.on('error', reject)
      server.listen(0, '0.0.0.0', () => {
        this.port = (server.address() as { port: number }).port
        this.server = server
        resolve()
      })
    })
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const parts = url.pathname.split('/').filter(Boolean)

    // Every path must lead with the session token.
    if (parts[0] !== this.sessionToken) {
      res.writeHead(404).end('Not found')
      return
    }

    if (parts.length === 1) {
      this.sendHtml(res, this.landingPage())
      return
    }
    if (parts.length === 2 && parts[1] === 'list') {
      this.sendJson(res, this.clipList())
      return
    }
    if (parts.length === 2 && parts[1].endsWith('.mp4')) {
      this.streamClip(req, res, parts[1].replace(/\.mp4$/, ''))
      return
    }
    res.writeHead(404).end('Not found')
  }

  private clipList(): { label: string; src: string }[] {
    return this.clips.map((clip) => ({
      label: clip.label,
      src: `/${this.sessionToken}/${clip.token}.mp4`
    }))
  }

  private streamClip(req: IncomingMessage, res: ServerResponse, clipToken: string): void {
    const clip = this.clips.find((c) => c.token === clipToken)
    if (!clip) {
      res.writeHead(404).end('Not found')
      return
    }
    const path = join(this.golfDir, clip.sessionId, clip.fileName)
    let size: number
    try {
      size = statSync(path).size
    } catch {
      res.writeHead(404).end('Not found')
      return
    }

    const range = req.headers.range
    const match = range?.match(/bytes=(\d+)-(\d*)/)
    if (match) {
      const start = Number(match[1])
      const end = match[2] ? Number(match[2]) : size - 1
      if (start >= size || end >= size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
        return
      }
      res.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1
      })
      createReadStream(path, { start, end }).pipe(res)
      return
    }

    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': size
    })
    createReadStream(path).pipe(res)
  }

  private sendHtml(res: ServerResponse, html: string): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html)
  }

  private sendJson(res: ServerResponse, data: unknown): void {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))
  }

  private landingPage(): string {
    // Self-contained page: lists shared clips, polls for new ones, and tells
    // each platform how to save. Clip cards are rendered client-side from /list.
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>ReplaySwing — Your Shots</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { background:#0b0d0c; color:#e9ede9; font-family:system-ui,-apple-system,sans-serif; padding:16px; }
  h1 { font-size:18px; letter-spacing:.04em; margin-bottom:4px; }
  p.hint { color:#7f8a83; font-size:13px; margin-bottom:16px; line-height:1.5; }
  .clip { background:#14181a; border:1px solid #232a28; border-radius:12px; overflow:hidden; margin-bottom:14px; }
  .clip video { width:100%; display:block; background:#000; }
  .clip .row { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; }
  .clip .label { font-size:14px; }
  a.save { background:#43b06c; color:#0b0d0c; font-weight:600; text-decoration:none; padding:8px 16px; border-radius:8px; font-size:14px; }
  .empty { color:#7f8a83; text-align:center; padding:40px 0; }
</style>
</head>
<body>
<h1>Your Shots</h1>
<p class="hint">Tap Save to download. On iPhone, long-press the video and choose "Save to Photos".</p>
<div id="clips"><p class="empty">Waiting for shots…</p></div>
<script>
  const base = location.pathname.replace(/\\/$/, '');
  const container = document.getElementById('clips');
  let seen = '';
  async function refresh() {
    try {
      const list = await (await fetch(base + '/list', { cache: 'no-store' })).json();
      const key = list.map(c => c.src).join(',');
      if (key === seen) return;
      seen = key;
      container.innerHTML = list.length ? '' : '<p class="empty">Waiting for shots…</p>';
      for (const clip of list) {
        const el = document.createElement('div');
        el.className = 'clip';
        el.innerHTML =
          '<video src="' + clip.src + '" controls playsinline preload="metadata"></video>' +
          '<div class="row"><span class="label"></span>' +
          '<a class="save" download href="' + clip.src + '">Save</a></div>';
        el.querySelector('.label').textContent = clip.label;
        container.appendChild(el);
      }
    } catch (e) { /* transient — next tick retries */ }
  }
  refresh();
  setInterval(refresh, 3000);
</script>
</body>
</html>`
  }
}
