/**
 * Per-camera capture worker: MediaStreamTrack → VideoEncoder (H.264) →
 * ChunkRing. On trigger, waits out the post-roll, slices the ring from the
 * keyframe covering (trigger − preRoll), muxes to MP4, and posts it back.
 *
 * Phone cameras ramp through several resolutions during WebRTC negotiation
 * (e.g. 180×320 → 360×640 → 720×1280). Rather than locking to one resolution,
 * we accept sustained changes: if 5+ consecutive frames arrive at new
 * dimensions, we close the old encoder, create a fresh one, and clear the ring.
 * Brief blips (phone vibration) are absorbed by the tolerance threshold.
 *
 * We never call encoder.configure() on an already-running encoder — Chromium's
 * hardware H.264 path stalls when reconfigured mid-stream. Every resolution
 * change produces a brand-new VideoEncoder instance.
 */
import { ChunkRing } from './chunk-ring'
import { muxChunksToMp4 } from './mp4-writer'
import type { FromWorkerMessage, ToWorkerMessage, WorkerInit, WorkerTrigger } from './worker-protocol'

const CODEC_LADDER: { codec: string; hardwareAcceleration: HardwareAcceleration }[] = [
  { codec: 'avc1.42E01F', hardwareAcceleration: 'prefer-hardware' },
  { codec: 'avc1.42E01F', hardwareAcceleration: 'no-preference' },
  { codec: 'avc1.4D401F', hardwareAcceleration: 'no-preference' }
]

const MAX_ENCODE_QUEUE = 6
const STATUS_INTERVAL_MS = 1000
const MISMATCH_TOLERANCE = 5
const STALL_DETECT_MS = 3000

function post(message: FromWorkerMessage, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(message, transfer)
}

class CaptureSession {
  private ring!: ChunkRing
  private encoder: VideoEncoder | null = null
  private config!: WorkerInit
  private width = 0
  private height = 0
  private description: AllowSharedBufferSource | undefined
  private wallClockByTimestamp = new Map<number, number>()
  private pendingTrigger: WorkerTrigger | null = null
  private triggerSafetyTimer: ReturnType<typeof setTimeout> | null = null
  private frameCounter = 0
  private framesSinceStatus = 0
  private lastStatusAt = 0
  private stopped = false
  private mismatchCount = 0
  private mismatchWidth = 0
  private mismatchHeight = 0
  private workedCodec: { codec: string; hardwareAcceleration: HardwareAcceleration } | null = null
  /** Offset to add to worker's performance.now() to align with renderer clock. */
  private timeOffset = 0
  private lastFrameAt = 0
  private stallTimer: ReturnType<typeof setInterval> | null = null

  async start(config: WorkerInit): Promise<void> {
    this.config = config
    this.ring = new ChunkRing(config.retentionMs)
    this.timeOffset = config.rendererNowMs - performance.now()
    this.lastFrameAt = performance.now()

    this.stallTimer = setInterval(() => {
      if (this.stopped) return
      const gap = performance.now() - this.lastFrameAt
      if (gap >= STALL_DETECT_MS && this.frameCounter > 0) {
        console.warn(`[WORKER ${this.config.cameraId.slice(0, 8)}] stream stalled for ${(gap / 1000).toFixed(1)}s — notifying controller`)
        post({ type: 'stream-stalled', cameraId: this.config.cameraId, stallMs: gap })
        this.stop()
      }
    }, STALL_DETECT_MS)

    const reader = config.frames.getReader()
    this.lastStatusAt = performance.now()

    for (;;) {
      const { done, value: frame } = await reader.read()
      if (done || this.stopped) {
        frame?.close()
        if (done && !this.stopped) {
          console.warn(`[WORKER ${this.config.cameraId.slice(0, 8)}] ReadableStream ended unexpectedly (ring=${this.ring.size} frames=${this.frameCounter})`)
          post({ type: 'stream-ended', cameraId: this.config.cameraId })
        }
        break
      }
      this.handleFrame(frame)
    }

    if (this.pendingTrigger) {
      await this.finishTrigger(this.pendingTrigger)
    }
  }

  private createEncoder(width: number, height: number): void {
    try { this.encoder?.close() } catch { /* already closed */ }
    this.encoder = null
    this.width = width
    this.height = height
    this.frameCounter = 0
    this.ring.clear()
    this.wallClockByTimestamp.clear()

    const candidates = this.workedCodec ? [this.workedCodec, ...CODEC_LADDER] : CODEC_LADDER

    for (const candidate of candidates) {
      try {
        const encoder = new VideoEncoder({
          output: (chunk, meta) => this.onChunk(chunk, meta),
          error: (error) => {
            console.error(`[WORKER ${this.config.cameraId.slice(0, 8)}] ENCODER ERROR: ${error}`)
            post({ type: 'error', cameraId: this.config.cameraId, message: String(error), fatal: true })
          }
        })
        encoder.configure({
          codec: candidate.codec,
          width,
          height,
          bitrate: this.config.bitrate,
          framerate: this.config.fps,
          hardwareAcceleration: candidate.hardwareAcceleration,
          latencyMode: 'realtime',
          avc: { format: 'avc' }
        })
        this.encoder = encoder
        this.workedCodec = candidate
        console.log(`[WORKER ${this.config.cameraId.slice(0, 8)}] encoder created at ${width}x${height} (${candidate.codec}, ${candidate.hardwareAcceleration})`)
        return
      } catch {
        continue
      }
    }
    console.error(`[WORKER ${this.config.cameraId.slice(0, 8)}] no supported encoder for ${width}x${height}`)
  }

  /** performance.now() aligned to the renderer's clock. */
  private rendererNow(): number {
    return performance.now() + this.timeOffset
  }

  private handleFrame(frame: VideoFrame): void {
    this.lastFrameAt = performance.now()
    const wallMs = this.rendererNow()
    const fw = frame.displayWidth
    const fh = frame.displayHeight

    if (!this.encoder) {
      console.log(`[WORKER ${this.config.cameraId.slice(0, 8)}] first frame: ${fw}x${fh}, creating encoder`)
      this.createEncoder(fw, fh)
      if (!this.encoder) {
        frame.close()
        return
      }
    }

    if (fw !== this.width || fh !== this.height) {
      if (fw === this.mismatchWidth && fh === this.mismatchHeight) {
        this.mismatchCount++
      } else {
        this.mismatchWidth = fw
        this.mismatchHeight = fh
        this.mismatchCount = 1
      }
      if (this.mismatchCount >= MISMATCH_TOLERANCE) {
        console.log(`[WORKER ${this.config.cameraId.slice(0, 8)}] resolution change ${this.width}x${this.height} → ${fw}x${fh} (sustained ${this.mismatchCount} frames, recreating encoder)`)
        this.mismatchCount = 0
        this.createEncoder(fw, fh)
        if (!this.encoder) {
          frame.close()
          return
        }
      } else {
        frame.close()
        return
      }
    } else {
      this.mismatchCount = 0
    }

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

  private onChunk(chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata | undefined): void {
    if (meta?.decoderConfig?.description) {
      this.description = meta.decoderConfig.description
    }
    const wallClockMs = this.wallClockByTimestamp.get(chunk.timestamp) ?? this.rendererNow()
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
      console.log(`[WORKER ${this.config.cameraId.slice(0, 8)}] post-roll complete (waited ${(wallClockMs - trigger.triggerWallMs).toFixed(0)}ms)`)
      this.pendingTrigger = null
      if (this.triggerSafetyTimer) { clearTimeout(this.triggerSafetyTimer); this.triggerSafetyTimer = null }
      void this.finishTrigger(trigger)
    }
  }

  trigger(message: WorkerTrigger): void {
    if (this.pendingTrigger) return
    console.log(`[WORKER ${this.config.cameraId.slice(0, 8)}] trigger received postRoll=${message.postRollMs}ms ring=${this.ring.size} chunks dims=${this.width}x${this.height}`)
    this.pendingTrigger = message
    this.triggerSafetyTimer = setTimeout(() => {
      if (this.pendingTrigger) {
        console.warn(`[WORKER ${this.config.cameraId.slice(0, 8)}] safety timeout — frames stalled, muxing what we have`)
        const t = this.pendingTrigger
        this.pendingTrigger = null
        void this.finishTrigger(t)
      }
    }, message.postRollMs + 3000)
  }

  private async finishTrigger(trigger: WorkerTrigger): Promise<void> {
    try {
      if (!this.encoder) return
      const t0 = performance.now()
      await this.encoder.flush()
      const flushMs = performance.now() - t0
      const head = this.ring.peekHead()
      const tail = this.ring.peekTail()
      const sliceTarget = trigger.triggerWallMs - trigger.preRollMs
      console.log(`[WORKER ${this.config.cameraId.slice(0, 8)}] finishTrigger: ring=${this.ring.size} triggerWallMs=${trigger.triggerWallMs.toFixed(0)} sliceTarget=${sliceTarget.toFixed(0)} head.wall=${head?.wallClockMs.toFixed(0)} tail.wall=${tail?.wallClockMs.toFixed(0)} dims=${this.width}x${this.height}`)
      const slice = this.ring.sliceFrom(sliceTarget)
      if (slice.length === 0) {
        post({
          type: 'error',
          cameraId: this.config.cameraId,
          message: 'no buffered frames at trigger time',
          fatal: false
        })
        return
      }
      console.log(`[WORKER ${this.config.cameraId.slice(0, 8)}] slice: ${slice.length} frames, first.wall=${slice[0].wallClockMs.toFixed(0)} last.wall=${slice[slice.length - 1].wallClockMs.toFixed(0)} span=${((slice[slice.length - 1].wallClockMs - slice[0].wallClockMs) / 1000).toFixed(2)}s`)
      const t1 = performance.now()
      const mp4 = muxChunksToMp4(slice, this.width, this.height, this.description)
      const muxMs = performance.now() - t1
      console.log(`[WORKER ${this.config.cameraId.slice(0, 8)}] muxed ${slice.length} frames → ${(mp4.byteLength / 1_048_576).toFixed(2)}MB (flush=${flushMs.toFixed(0)}ms mux=${muxMs.toFixed(0)}ms)`)
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
    if (this.stallTimer) { clearInterval(this.stallTimer); this.stallTimer = null }
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
