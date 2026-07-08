/**
 * Per-camera capture worker: MediaStreamTrack → VideoEncoder (H.264) →
 * ChunkRing. On trigger, waits out the post-roll, slices the ring from the
 * keyframe covering (trigger − preRoll), muxes to MP4, and posts it back.
 *
 * Also computes the downscaled motion-energy signal for the vision trigger
 * when `motionSampleFps` > 0 (primary camera only).
 */
import { ChunkRing } from './chunk-ring'
import { muxChunksToMp4 } from './mp4-writer'
import type { FromWorkerMessage, ToWorkerMessage, WorkerInit, WorkerTrigger } from './worker-protocol'

const CODEC_LADDER: { codec: string; hardwareAcceleration: HardwareAcceleration }[] = [
  { codec: 'avc1.42E01F', hardwareAcceleration: 'prefer-hardware' },
  { codec: 'avc1.42E01F', hardwareAcceleration: 'no-preference' },
  { codec: 'avc1.4D401F', hardwareAcceleration: 'no-preference' }
]

const MOTION_WIDTH = 160
const MOTION_HEIGHT = 90
const MAX_ENCODE_QUEUE = 6
const STATUS_INTERVAL_MS = 1000

function post(message: FromWorkerMessage, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(message, transfer)
}

class CaptureSession {
  private ring!: ChunkRing
  private encoder!: VideoEncoder
  private config!: WorkerInit
  private width = 0
  private height = 0
  private description: AllowSharedBufferSource | undefined
  /** Maps encoder timestamps to the wall clock captured at encode() time. */
  private wallClockByTimestamp = new Map<number, number>()
  private pendingTrigger: WorkerTrigger | null = null
  private frameCounter = 0
  private framesSinceStatus = 0
  private lastStatusAt = 0
  private lastMotionSampleAt = 0
  private motionCanvas: OffscreenCanvas | null = null
  private previousLuma: Uint8ClampedArray | null = null
  private stopped = false

  async start(config: WorkerInit): Promise<void> {
    this.config = config
    this.width = config.width
    this.height = config.height
    this.ring = new ChunkRing(config.retentionMs)

    const encoderConfig = await this.pickEncoderConfig()
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.onChunk(chunk, meta),
      error: (error) =>
        post({ type: 'error', cameraId: this.config.cameraId, message: String(error), fatal: true })
    })
    this.encoder.configure(encoderConfig)

    if (config.motionSampleFps > 0) {
      this.motionCanvas = new OffscreenCanvas(MOTION_WIDTH, MOTION_HEIGHT)
    }

    const reader = config.frames.getReader()
    this.lastStatusAt = performance.now()

    for (;;) {
      const { done, value: frame } = await reader.read()
      if (done || this.stopped) {
        frame?.close()
        break
      }
      this.handleFrame(frame)
    }

    // Track ended (unplug, phone lock, stop): deliver a partial clip if a
    // trigger was in flight, so a mid-recording failure still saves footage.
    if (this.pendingTrigger) {
      await this.finishTrigger(this.pendingTrigger)
    }
  }

  private async pickEncoderConfig(): Promise<VideoEncoderConfig> {
    for (const candidate of CODEC_LADDER) {
      const config: VideoEncoderConfig = {
        codec: candidate.codec,
        width: this.width,
        height: this.height,
        bitrate: this.config.bitrate,
        framerate: this.config.fps,
        hardwareAcceleration: candidate.hardwareAcceleration,
        latencyMode: 'realtime',
        avc: { format: 'avc' }
      }
      try {
        const support = await VideoEncoder.isConfigSupported(config)
        if (support.supported) return config
      } catch {
        continue
      }
    }
    throw new Error('no supported H.264 encoder configuration')
  }

  private handleFrame(frame: VideoFrame): void {
    const wallMs = performance.now()

    if (this.motionCanvas && wallMs - this.lastMotionSampleAt >= 1000 / this.config.motionSampleFps) {
      this.lastMotionSampleAt = wallMs
      this.sampleMotion(frame, wallMs)
    }

    // Backpressure: drop frames rather than let the encode queue run away.
    if (this.encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
      frame.close()
      return
    }

    this.wallClockByTimestamp.set(frame.timestamp, wallMs)
    this.encoder.encode(frame, { keyFrame: this.frameCounter % this.config.fps === 0 })
    this.frameCounter++
    this.framesSinceStatus++
    frame.close()

    if (wallMs - this.lastStatusAt >= STATUS_INTERVAL_MS) {
      post({
        type: 'status',
        cameraId: this.config.cameraId,
        measuredFps: Math.round((this.framesSinceStatus * 1000) / (wallMs - this.lastStatusAt)),
        encodeQueueDepth: this.encoder.encodeQueueSize,
        ringChunks: this.ring.size
      })
      this.framesSinceStatus = 0
      this.lastStatusAt = wallMs
    }
  }

  private sampleMotion(frame: VideoFrame, wallMs: number): void {
    const ctx = this.motionCanvas!.getContext('2d', { willReadFrequently: true })!
    const roi = this.config.motionRoi
    if (roi) {
      ctx.drawImage(
        frame,
        roi.x * this.width,
        roi.y * this.height,
        roi.w * this.width,
        roi.h * this.height,
        0,
        0,
        MOTION_WIDTH,
        MOTION_HEIGHT
      )
    } else {
      ctx.drawImage(frame, 0, 0, MOTION_WIDTH, MOTION_HEIGHT)
    }
    const { data } = ctx.getImageData(0, 0, MOTION_WIDTH, MOTION_HEIGHT)
    const luma = new Uint8ClampedArray(MOTION_WIDTH * MOTION_HEIGHT)
    for (let i = 0; i < luma.length; i++) {
      const o = i * 4
      luma[i] = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8
    }
    if (this.previousLuma) {
      let total = 0
      for (let i = 0; i < luma.length; i++) {
        total += Math.abs(luma[i] - this.previousLuma[i])
      }
      post({
        type: 'motion',
        cameraId: this.config.cameraId,
        wallClockMs: wallMs,
        energy: total / luma.length
      })
    }
    this.previousLuma = luma
  }

  private onChunk(chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata | undefined): void {
    if (meta?.decoderConfig?.description) {
      this.description = meta.decoderConfig.description
    }
    const wallClockMs = this.wallClockByTimestamp.get(chunk.timestamp) ?? performance.now()
    this.wallClockByTimestamp.delete(chunk.timestamp)

    const data = new Uint8Array(chunk.byteLength)
    chunk.copyTo(data)
    this.ring.push({
      data,
      type: chunk.type as 'key' | 'delta',
      timestampUs: chunk.timestamp,
      durationUs: chunk.duration ?? Math.round(1_000_000 / this.config.fps),
      wallClockMs
    })

    const trigger = this.pendingTrigger
    if (trigger && wallClockMs >= trigger.triggerWallMs + trigger.postRollMs) {
      this.pendingTrigger = null
      void this.finishTrigger(trigger)
    }
  }

  trigger(message: WorkerTrigger): void {
    if (this.pendingTrigger) return // one capture at a time; coordinator enforces cooldown
    this.pendingTrigger = message
  }

  private async finishTrigger(trigger: WorkerTrigger): Promise<void> {
    try {
      await this.encoder.flush()
      const slice = this.ring.sliceFrom(trigger.triggerWallMs - trigger.preRollMs)
      if (slice.length === 0) {
        post({
          type: 'error',
          cameraId: this.config.cameraId,
          message: 'no buffered frames at trigger time',
          fatal: false
        })
        return
      }
      const mp4 = muxChunksToMp4(slice, this.width, this.height, this.description)
      post(
        {
          type: 'clip',
          cameraId: this.config.cameraId,
          mp4,
          width: this.width,
          height: this.height,
          firstFrameWallMs: slice[0].wallClockMs,
          triggerWallMs: trigger.triggerWallMs
        },
        [mp4]
      )
    } catch (error) {
      post({ type: 'error', cameraId: this.config.cameraId, message: String(error), fatal: false })
    }
  }

  stop(): void {
    this.stopped = true
    try {
      this.encoder?.close()
    } catch {
      // already closed
    }
    self.close()
  }
}

const session = new CaptureSession()

self.onmessage = (event: MessageEvent<ToWorkerMessage>) => {
  const message = event.data
  if (message.type === 'init') {
    void session.start(message).catch((error) => {
      post({ type: 'error', cameraId: message.cameraId, message: String(error), fatal: true })
    })
  } else if (message.type === 'trigger') {
    session.trigger(message)
  } else if (message.type === 'stop') {
    session.stop()
  }
}
