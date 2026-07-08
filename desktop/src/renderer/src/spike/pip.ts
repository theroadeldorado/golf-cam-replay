/**
 * Spike C — validates the "program bus" pattern that feeds the PiP window:
 * composite canvas → captureStream(30) → WebRTC loopback → <video> in a
 * second BrowserWindow, with SDP/ICE relayed over IPC through main.
 *
 * Run with: ReplaySwing --spike=pip
 * Main opens this page twice (?role=source and ?role=sink); the sink reports.
 */

const WIDTH = 1280
const HEIGHT = 720
const MEASURE_MS = 5000

type SignalMessage =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit | null }

function send(message: SignalMessage): void {
  void window.api.invoke('spike:relay', message)
}

function makePeer(): RTCPeerConnection {
  const peer = new RTCPeerConnection()
  peer.onicecandidate = (event) => {
    send({ kind: 'candidate', candidate: event.candidate ? event.candidate.toJSON() : null })
  }
  return peer
}

async function runSource(): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!

  let frameIndex = 0
  const draw = (): void => {
    const hue = (frameIndex * 4) % 360
    ctx.fillStyle = `hsl(${hue}, 55%, 22%)`
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    ctx.fillStyle = '#fff'
    ctx.font = '64px sans-serif'
    ctx.fillText(`frame ${frameIndex}`, 60, 120)
    ctx.beginPath()
    ctx.arc(
      WIDTH / 2 + Math.cos(frameIndex / 20) * 300,
      HEIGHT / 2 + Math.sin(frameIndex / 20) * 200,
      48,
      0,
      Math.PI * 2
    )
    ctx.fillStyle = `hsl(${(hue + 180) % 360}, 80%, 60%)`
    ctx.fill()
    frameIndex++
    requestAnimationFrame(draw)
  }
  requestAnimationFrame(draw)

  const stream = canvas.captureStream(30)
  const peer = makePeer()
  for (const track of stream.getTracks()) {
    peer.addTrack(track, stream)
  }

  window.api.on('spike:message', (payload) => {
    const message = payload as SignalMessage
    if (message.kind === 'answer') {
      void peer.setRemoteDescription({ type: 'answer', sdp: message.sdp })
    } else if (message.kind === 'candidate' && message.candidate) {
      void peer.addIceCandidate(message.candidate)
    }
  })

  const offer = await peer.createOffer()
  await peer.setLocalDescription(offer)
  send({ kind: 'offer', sdp: offer.sdp! })
}

async function runSink(): Promise<void> {
  const report: Record<string, unknown> = { spike: 'pip' }
  const peer = makePeer()
  const video = document.createElement('video')
  video.muted = true
  video.autoplay = true
  document.body.appendChild(video)

  const connected = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), 15_000)
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') resolve(true)
      if (peer.connectionState === 'failed') resolve(false)
    }
  })

  peer.ontrack = (event) => {
    video.srcObject = event.streams[0] ?? new MediaStream([event.track])
  }

  window.api.on('spike:message', (payload) => {
    void (async () => {
      const message = payload as SignalMessage
      if (message.kind === 'offer') {
        await peer.setRemoteDescription({ type: 'offer', sdp: message.sdp })
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        send({ kind: 'answer', sdp: answer.sdp! })
      } else if (message.kind === 'candidate' && message.candidate) {
        await peer.addIceCandidate(message.candidate)
      }
    })()
  })

  try {
    report['connected'] = await connected
    if (report['connected']) {
      await new Promise((resolve) => setTimeout(resolve, MEASURE_MS))
      let framesDecoded = 0
      let framesPerSecond: number | null = null
      let jitterBufferDelayMs: number | null = null
      const stats = await peer.getStats()
      stats.forEach((entry) => {
        if (entry.type === 'inbound-rtp' && entry.kind === 'video') {
          framesDecoded = entry.framesDecoded ?? 0
          framesPerSecond = entry.framesPerSecond ?? null
          if (entry.jitterBufferDelay != null && entry.jitterBufferEmittedCount > 0) {
            jitterBufferDelayMs = Math.round(
              (entry.jitterBufferDelay / entry.jitterBufferEmittedCount) * 1000
            )
          }
        }
      })
      report['framesDecoded'] = framesDecoded
      report['framesPerSecond'] = framesPerSecond
      report['jitterBufferDelayMs'] = jitterBufferDelayMs
      report['videoSize'] = `${video.videoWidth}x${video.videoHeight}`
      report['ok'] = framesDecoded > (MEASURE_MS / 1000) * 20 // ≥20fps sustained
    } else {
      report['ok'] = false
    }
  } catch (error) {
    report['ok'] = false
    report['fatal'] = String(error)
  }

  await window.api.invoke('spike:report', report)
}

const role = new URLSearchParams(location.search).get('role')
if (role === 'source') {
  void runSource()
} else {
  void runSink()
}
