/**
 * The "program bus": composites what the app is showing (live grid or replay)
 * onto one canvas and streams it to the PiP window over a WebRTC loopback
 * (validated by --spike=pip). One encode, ~1 frame latency, and the PiP
 * automatically mirrors live ↔ replay with no logic of its own.
 */

const WIDTH = 1280
const HEIGHT = 720
const FPS = 30

interface BusSignal {
  kind: 'offer' | 'answer' | 'candidate'
  sdp?: string
  candidate?: RTCIceCandidateInit | null
}

export class ProgramBus {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private videos = new Map<string, HTMLVideoElement>()
  private replayVideo: HTMLVideoElement | null = null
  private peer: RTCPeerConnection | null = null
  private drawTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = WIDTH
    this.canvas.height = HEIGHT
    this.ctx = this.canvas.getContext('2d')!
    window.api.on('pip:signal', (payload) => void this.onSignal(payload as BusSignal))
  }

  setCameras(cameras: { id: string; stream: MediaStream | null }[]): void {
    const liveIds = new Set<string>()
    for (const camera of cameras) {
      if (!camera.stream) continue
      liveIds.add(camera.id)
      if (!this.videos.has(camera.id)) {
        const video = document.createElement('video')
        video.muted = true
        video.srcObject = camera.stream
        void video.play().catch(() => {})
        this.videos.set(camera.id, video)
      } else if (this.videos.get(camera.id)!.srcObject !== camera.stream) {
        const video = this.videos.get(camera.id)!
        video.srcObject = camera.stream
        void video.play().catch(() => {})
      }
    }
    for (const id of [...this.videos.keys()]) {
      if (!liveIds.has(id)) {
        this.videos.get(id)!.srcObject = null
        this.videos.delete(id)
      }
    }
  }

  setReplayUrl(url: string | null): void {
    if (!url) {
      this.replayVideo = null
      return
    }
    const video = document.createElement('video')
    video.muted = true
    video.loop = true
    video.src = url
    void video.play().catch(() => {})
    this.replayVideo = video
  }

  async start(): Promise<void> {
    if (this.peer) return
    this.drawTimer = setInterval(() => this.draw(), 1000 / FPS)

    const stream = this.canvas.captureStream(FPS)
    const [track] = stream.getVideoTracks()
    track.contentHint = 'motion'
    const peer = new RTCPeerConnection()
    this.peer = peer
    peer.addTrack(track, stream)
    peer.onicecandidate = (event) => {
      void window.api.invoke('pip:signal', {
        kind: 'candidate',
        candidate: event.candidate ? event.candidate.toJSON() : null
      })
    }
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    await window.api.invoke('pip:signal', { kind: 'offer', sdp: offer.sdp })
  }

  stop(): void {
    if (this.drawTimer) clearInterval(this.drawTimer)
    this.drawTimer = null
    this.peer?.close()
    this.peer = null
  }

  private async onSignal(signal: BusSignal): Promise<void> {
    if (!this.peer) return
    if (signal.kind === 'answer' && signal.sdp) {
      await this.peer.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
    } else if (signal.kind === 'candidate' && signal.candidate) {
      await this.peer.addIceCandidate(signal.candidate)
    }
  }

  private draw(): void {
    const ctx = this.ctx
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    if (this.replayVideo && this.replayVideo.videoWidth > 0) {
      this.drawContained(this.replayVideo, 0, 0, WIDTH, HEIGHT)
      return
    }

    const videos = [...this.videos.values()].filter((video) => video.videoWidth > 0)
    if (videos.length === 0) return
    if (videos.length === 1) {
      this.drawContained(videos[0], 0, 0, WIDTH, HEIGHT)
    } else if (videos.length === 2) {
      this.drawContained(videos[0], 0, 0, WIDTH / 2, HEIGHT)
      this.drawContained(videos[1], WIDTH / 2, 0, WIDTH / 2, HEIGHT)
    } else {
      videos.slice(0, 4).forEach((video, index) => {
        const x = (index % 2) * (WIDTH / 2)
        const y = Math.floor(index / 2) * (HEIGHT / 2)
        this.drawContained(video, x, y, WIDTH / 2, HEIGHT / 2)
      })
    }
  }

  private drawContained(video: HTMLVideoElement, x: number, y: number, w: number, h: number): void {
    const scale = Math.min(w / video.videoWidth, h / video.videoHeight)
    const dw = video.videoWidth * scale
    const dh = video.videoHeight * scale
    this.ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  }
}
