/**
 * Spike A — the hard gate under the whole recording pipeline.
 *
 * Answers, on THIS machine:
 *  1. Which H.264 configs does WebCodecs support (hardware vs software)?
 *  2. Can 4 concurrent 720p30 encoders keep up in real time?
 *  3. Does mp4-muxer output a playable MP4 (verified by decoding it back
 *     in a <video> element)?
 *
 * Run with: ReplaySwing --spike=encode   (prints JSON to stdout)
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

const WIDTH = 1280
const HEIGHT = 720
const FPS = 30
const DURATION_SEC = 5
const FRAME_COUNT = FPS * DURATION_SEC
const BITRATE = 8_000_000
const CODEC_CANDIDATES = ['avc1.42E01F', 'avc1.4D401F', 'avc1.640028']
const SESSION_COUNT = 4

interface ConfigSupport {
  codec: string
  hardwareAcceleration: string
  supported: boolean
}

interface SessionResult {
  session: number
  frames: number
  wallMs: number
  encodeFps: number
  chunkBytes: number
  errors: string[]
}

async function probeConfigSupport(): Promise<ConfigSupport[]> {
  const results: ConfigSupport[] = []
  for (const codec of CODEC_CANDIDATES) {
    for (const hw of ['prefer-hardware', 'prefer-software', 'no-preference'] as const) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec,
          width: WIDTH,
          height: HEIGHT,
          bitrate: BITRATE,
          framerate: FPS,
          hardwareAcceleration: hw,
          avc: { format: 'avc' }
        })
        results.push({ codec, hardwareAcceleration: hw, supported: support.supported === true })
      } catch (error) {
        results.push({ codec, hardwareAcceleration: hw, supported: false })
      }
    }
  }
  return results
}

function drawTestFrame(ctx: OffscreenCanvasRenderingContext2D, frameIndex: number, seed: number): void {
  // Moving gradient + noise blocks: enough entropy that the encoder does real work.
  const hue = (frameIndex * 3 + seed * 90) % 360
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
  gradient.addColorStop(0, `hsl(${hue}, 60%, 30%)`)
  gradient.addColorStop(1, `hsl(${(hue + 120) % 360}, 60%, 15%)`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `hsl(${(hue + i * 9) % 360}, 70%, ${30 + ((frameIndex * 7 + i * 13) % 50)}%)`
    const x = ((frameIndex * 17 + i * 97) % WIDTH) - 20
    const y = (i * 53 + frameIndex * 5) % HEIGHT
    ctx.fillRect(x, y, 40, 24)
  }

  ctx.fillStyle = '#fff'
  ctx.font = '48px sans-serif'
  ctx.fillText(`session ${seed} frame ${frameIndex}`, 40, 80)
}

interface StoredChunk {
  chunk: EncodedVideoChunk
  meta: EncodedVideoChunkMetadata | undefined
}

async function runEncodeSession(
  codec: string,
  seed: number,
  keepChunks: boolean
): Promise<{ result: SessionResult; chunks: StoredChunk[] }> {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')!
  const chunks: StoredChunk[] = []
  const errors: string[] = []
  let chunkBytes = 0

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      chunkBytes += chunk.byteLength
      if (keepChunks) chunks.push({ chunk, meta })
    },
    error: (error) => errors.push(String(error))
  })

  encoder.configure({
    codec,
    width: WIDTH,
    height: HEIGHT,
    bitrate: BITRATE,
    framerate: FPS,
    hardwareAcceleration: 'no-preference',
    latencyMode: 'realtime',
    avc: { format: 'avc' }
  })

  const start = performance.now()
  for (let i = 0; i < FRAME_COUNT; i++) {
    drawTestFrame(ctx, i, seed)
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((i * 1_000_000) / FPS),
      duration: Math.round(1_000_000 / FPS)
    })
    encoder.encode(frame, { keyFrame: i % FPS === 0 })
    frame.close()
    // Backpressure: never let the queue run away on slow machines.
    while (encoder.encodeQueueSize > 4) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  await encoder.flush()
  const wallMs = performance.now() - start
  encoder.close()

  return {
    result: {
      session: seed,
      frames: FRAME_COUNT,
      wallMs: Math.round(wallMs),
      encodeFps: Math.round((FRAME_COUNT / wallMs) * 1000),
      chunkBytes,
      errors
    },
    chunks
  }
}

function muxToMp4(chunks: StoredChunk[]): ArrayBuffer {
  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: WIDTH, height: HEIGHT },
    fastStart: 'in-memory'
  })
  for (const { chunk, meta } of chunks) {
    muxer.addVideoChunk(chunk, meta)
  }
  muxer.finalize()
  return target.buffer
}

async function verifyPlayback(mp4: ArrayBuffer): Promise<{
  playable: boolean
  durationSec: number | null
  videoWidth: number | null
  videoHeight: number | null
  error: string | null
}> {
  const url = URL.createObjectURL(new Blob([mp4], { type: 'video/mp4' }))
  const video = document.createElement('video')
  video.muted = true
  video.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('metadata load timed out')), 10_000)
      video.addEventListener(
        'loadedmetadata',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
      video.addEventListener(
        'error',
        () => {
          clearTimeout(timer)
          reject(new Error(`video element error: ${video.error?.message ?? 'unknown'}`))
        },
        { once: true }
      )
    })
    await video.play()
    await new Promise((resolve) => setTimeout(resolve, 500))
    video.pause()
    return {
      playable: video.currentTime > 0,
      durationSec: Number.isFinite(video.duration) ? Math.round(video.duration * 100) / 100 : null,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      error: null
    }
  } catch (error) {
    return {
      playable: false,
      durationSec: null,
      videoWidth: null,
      videoHeight: null,
      error: String(error)
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function main(): Promise<void> {
  const report: Record<string, unknown> = {
    spike: 'encode',
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency
  }

  try {
    const configSupport = await probeConfigSupport()
    report['configSupport'] = configSupport

    const workingCodec = CODEC_CANDIDATES.find((codec) =>
      configSupport.some((c) => c.codec === codec && c.supported)
    )
    report['selectedCodec'] = workingCodec ?? null

    if (workingCodec) {
      // 4 concurrent sessions — the multi-camera worst case. Keep chunks only
      // for session 0, which gets muxed and played back.
      const sessions = await Promise.all(
        Array.from({ length: SESSION_COUNT }, (_, i) => runEncodeSession(workingCodec, i, i === 0))
      )
      report['sessions'] = sessions.map((s) => s.result)
      report['realtimeCapable'] = sessions.every((s) => s.result.encodeFps >= FPS)

      const mp4 = muxToMp4(sessions[0].chunks)
      report['mp4Bytes'] = mp4.byteLength
      report['playback'] = await verifyPlayback(mp4)
      report['savedPath'] = await window.api.invoke('spike:save-temp', 'spike-encode.mp4', mp4)
    }

    report['ok'] =
      workingCodec != null &&
      (report['realtimeCapable'] as boolean) &&
      (report['playback'] as { playable: boolean }).playable
  } catch (error) {
    report['ok'] = false
    report['fatal'] = String(error instanceof Error ? (error.stack ?? error.message) : error)
  }

  await window.api.invoke('spike:report', report)
}

void main()
