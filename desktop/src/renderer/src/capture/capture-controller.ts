/**
 * Orchestrates the live capture graph: one encoder worker per camera, all
 * buffering continuously into their ChunkRings. A trigger (manual now,
 * vision in M3) broadcasts a shared wall-clock timestamp to every worker,
 * collects the resulting MP4s, and hands them to main for disk writes.
 */
import type { ClipMeta, Settings } from '@shared/types'
import type { FromWorkerMessage, WorkerInit } from './worker-protocol'
import { openUsbCamera } from '../cameras/usb'
import {
  VisionTrigger,
  STILL_DURATION_DEFAULT_MS,
  type VisionSampleEvent
} from '../trigger/vision-trigger'
import { PresenceDetector } from '../trigger/presence-detector'

const BITRATE = 7_000_000
const CLIP_COLLECT_TIMEOUT_MS = 12_000
const RING_SLACK_MS = 2_000

export interface ActiveCamera {
  id: string
  kind: 'usb' | 'phone'
  label: string
  state: 'connecting' | 'live' | 'ended' | 'error'
  stream: MediaStream | null
  measuredFps: number
  error?: string
}

export interface MotionSample {
  cameraId: string
  wallClockMs: number
  energy: number
}

interface CollectedClip {
  cameraId: string
  mp4: ArrayBuffer
  firstFrameWallMs: number
}

interface PendingCapture {
  triggerWallMs: number
  source: 'manual' | 'vision'
  confidence?: number
  expected: Set<string>
  collected: CollectedClip[]
  thumbnailJpeg: ArrayBuffer | null
  timeout: ReturnType<typeof setTimeout>
}

interface ControllerEvents {
  camerasChanged: (cameras: ActiveCamera[]) => void
  clipSaved: (meta: ClipMeta, primaryMp4: ArrayBuffer) => void
  motion: (sample: MotionSample) => void
  captureStateChanged: (capturing: boolean) => void
  visionEvent: (event: VisionSampleEvent) => void
}

export class CaptureController {
  private cameras = new Map<string, ActiveCamera>()
  private workers = new Map<string, Worker>()
  private encoderTracks = new Map<string, MediaStreamTrack>()
  private thumbnailVideo: HTMLVideoElement | null = null
  private pending: PendingCapture | null = null
  private listeners: Partial<ControllerEvents> = {}
  private visionTrigger: VisionTrigger | null = null
  private presenceDetector: PresenceDetector | null = null
  /** Latest presence; defaults true so a missing/failed model degrades to shape-only. */
  private presentNow = true

  constructor(
    private settings: Settings,
    private readonly disablePresence = false
  ) {}

  /** Arm/disarm the vision trigger. Manual trigger works regardless. */
  setArmed(armed: boolean): void {
    if (armed) {
      this.visionTrigger = new VisionTrigger({
        sensitivity: this.settings.sensitivity,
        stillDurationMs: STILL_DURATION_DEFAULT_MS,
        cooldownMs: Math.max(
          this.settings.cooldownSec * 1000,
          this.settings.postRollSec * 1000 + 2000
        )
      })
      this.visionTrigger.arm(performance.now())
      this.startPresence()
    } else {
      this.visionTrigger?.disarm()
      this.visionTrigger = null
      this.stopPresence()
    }
  }

  /** Load + run the person detector on the primary camera while armed. Any
   * failure leaves presentNow = true (shape-filter-only). */
  private startPresence(): void {
    this.presentNow = true
    if (this.disablePresence || !this.settings.requirePresence) return
    const detector = new PresenceDetector()
    this.presenceDetector = detector
    void detector
      .load()
      .then(() => {
        if (this.presenceDetector !== detector) return // disarmed during load
        if (this.thumbnailVideo) detector.start(this.thumbnailVideo)
        this.presencePoll = setInterval(() => {
          this.presentNow = detector.latest.present
        }, 100)
      })
      .catch((error) => {
        this.presentNow = true
        console.warn('Presence model unavailable — using shape-filter only:', error)
      })
  }

  private stopPresence(): void {
    if (this.presencePoll) clearInterval(this.presencePoll)
    this.presencePoll = null
    this.presenceDetector?.dispose()
    this.presenceDetector = null
    this.presentNow = true
  }

  private presencePoll: ReturnType<typeof setInterval> | null = null

  get isArmed(): boolean {
    return this.visionTrigger !== null
  }

  on<K extends keyof ControllerEvents>(event: K, listener: ControllerEvents[K]): void {
    this.listeners[event] = listener
  }

  updateSettings(settings: Settings): void {
    this.settings = settings
  }

  getCameras(): ActiveCamera[] {
    return [...this.cameras.values()]
  }

  get isCapturing(): boolean {
    return this.pending !== null
  }

  async addUsbCamera(deviceId: string, label: string): Promise<void> {
    if (this.cameras.has(deviceId)) return
    const camera: ActiveCamera = {
      id: deviceId,
      kind: 'usb',
      label,
      state: 'connecting',
      stream: null,
      measuredFps: 0
    }
    this.cameras.set(deviceId, camera)
    this.emitCameras()

    try {
      const stream = await openUsbCamera(deviceId, this.settings.fps)
      this.attachStream(camera, stream)
    } catch (error) {
      camera.state = 'error'
      camera.error = String(error)
      this.emitCameras()
    }
  }

  /** Used by the phone source (M4): hand a connected WebRTC track over. */
  attachExternalStream(id: string, label: string, stream: MediaStream): void {
    const existing = this.cameras.get(id)
    const camera: ActiveCamera = existing ?? {
      id,
      kind: 'phone',
      label,
      state: 'connecting',
      stream: null,
      measuredFps: 0
    }
    this.cameras.set(id, camera)
    this.attachStream(camera, stream)
  }

  private attachStream(camera: ActiveCamera, stream: MediaStream): void {
    // Re-attach (phone reconnect): retire the previous worker and track.
    const oldWorker = this.workers.get(camera.id)
    if (oldWorker) {
      oldWorker.postMessage({ type: 'stop' })
      this.workers.delete(camera.id)
      this.encoderTracks.get(camera.id)?.stop()
      this.encoderTracks.delete(camera.id)
    }

    camera.stream = stream
    camera.state = 'live'

    // Encode from a cloned track; the original renders in the UI. Tracks
    // aren't transferable, so the frame ReadableStream crosses to the worker.
    const track = stream.getVideoTracks()[0]
    const encoderTrack = track.clone()
    this.encoderTracks.set(camera.id, encoderTrack)
    track.addEventListener('ended', () => {
      camera.state = 'ended'
      this.emitCameras()
    })

    const worker = new Worker(new URL('./encoder.worker.ts', import.meta.url), { type: 'module' })
    this.workers.set(camera.id, worker)
    worker.onmessage = (event: MessageEvent<FromWorkerMessage>) => this.onWorkerMessage(event.data)
    worker.onerror = (event) => {
      camera.state = 'error'
      camera.error = event.message
      this.emitCameras()
    }

    const settings = encoderTrack.getSettings()
    const processor = new MediaStreamTrackProcessor({ track: encoderTrack })
    const isPrimary = this.primaryCameraId === camera.id
    const init: WorkerInit = {
      type: 'init',
      cameraId: camera.id,
      frames: processor.readable,
      width: settings.width ?? 1280,
      height: settings.height ?? 720,
      fps: this.settings.fps,
      bitrate: BITRATE,
      retentionMs: (this.settings.preRollSec + this.settings.postRollSec) * 1000 + RING_SLACK_MS,
      motionSampleFps: isPrimary ? 15 : 0,
      motionRoi: isPrimary ? this.settings.roi : null
    }
    worker.postMessage(init, [processor.readable as unknown as Transferable])

    if (isPrimary) this.setupThumbnailSource(stream)
    this.emitCameras()
  }

  private get primaryCameraId(): string {
    return this.settings.primaryCameraId ?? [...this.cameras.keys()][0] ?? ''
  }

  private setupThumbnailSource(stream: MediaStream): void {
    this.thumbnailVideo = document.createElement('video')
    this.thumbnailVideo.muted = true
    this.thumbnailVideo.srcObject = stream
    void this.thumbnailVideo.play().catch(() => {})
    // If the primary camera (re)connected while armed, point presence at it.
    if (this.presenceDetector?.available) this.presenceDetector.rebind(this.thumbnailVideo)
  }

  removeCamera(id: string): void {
    this.workers.get(id)?.postMessage({ type: 'stop' })
    this.workers.delete(id)
    this.encoderTracks.get(id)?.stop()
    this.encoderTracks.delete(id)
    const camera = this.cameras.get(id)
    camera?.stream?.getTracks().forEach((track) => track.stop())
    this.cameras.delete(id)
    this.emitCameras()
  }

  /** Fire a capture. Returns false if one is already in flight. */
  triggerNow(source: 'manual' | 'vision', confidence?: number, atWallMs?: number): boolean {
    if (this.pending) return false
    const liveCameraIds = [...this.cameras.values()]
      .filter((camera) => camera.state === 'live')
      .map((camera) => camera.id)
    if (liveCameraIds.length === 0) return false

    const triggerWallMs = atWallMs ?? performance.now()
    this.pending = {
      triggerWallMs,
      source,
      confidence,
      expected: new Set(liveCameraIds),
      collected: [],
      thumbnailJpeg: null,
      timeout: setTimeout(() => void this.finishCapture(), CLIP_COLLECT_TIMEOUT_MS)
    }
    this.listeners.captureStateChanged?.(true)

    void this.captureThumbnail()

    for (const id of liveCameraIds) {
      this.workers.get(id)?.postMessage({
        type: 'trigger',
        triggerWallMs,
        preRollMs: this.settings.preRollSec * 1000,
        postRollMs: this.settings.postRollSec * 1000
      })
    }
    return true
  }

  private async captureThumbnail(): Promise<void> {
    const video = this.thumbnailVideo
    if (!video || video.videoWidth === 0 || !this.pending) return
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = Math.round((320 * video.videoHeight) / video.videoWidth)
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    )
    if (blob && this.pending) {
      this.pending.thumbnailJpeg = await blob.arrayBuffer()
    }
  }

  private onWorkerMessage(message: FromWorkerMessage): void {
    const camera = this.cameras.get(message.cameraId)
    switch (message.type) {
      case 'status':
        if (camera) {
          camera.measuredFps = message.measuredFps
          this.emitCameras()
        }
        break
      case 'motion': {
        this.listeners.motion?.(message)
        if (this.visionTrigger) {
          const event = this.visionTrigger.sample(message.energy, message.wallClockMs, this.presentNow)
          this.listeners.visionEvent?.(event)
          if (event.fired && !this.pending) {
            this.triggerNow('vision', undefined, event.firedAtMs)
          }
        }
        break
      }
      case 'clip':
        if (this.pending?.expected.has(message.cameraId)) {
          this.pending.collected.push({
            cameraId: message.cameraId,
            mp4: message.mp4,
            firstFrameWallMs: message.firstFrameWallMs
          })
          this.pending.expected.delete(message.cameraId)
          if (this.pending.expected.size === 0) void this.finishCapture()
        }
        break
      case 'error':
        if (camera && message.fatal) {
          camera.state = 'error'
          camera.error = message.message
          this.emitCameras()
        }
        // A camera that errors mid-capture shouldn't stall the whole clip.
        if (this.pending?.expected.has(message.cameraId) && message.fatal) {
          this.pending.expected.delete(message.cameraId)
          if (this.pending.expected.size === 0) void this.finishCapture()
        }
        break
    }
  }

  private async finishCapture(): Promise<void> {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    clearTimeout(pending.timeout)
    this.listeners.captureStateChanged?.(false)

    if (pending.collected.length === 0) return

    const primaryId = pending.collected.some((clip) => clip.cameraId === this.primaryCameraId)
      ? this.primaryCameraId
      : pending.collected[0].cameraId

    const meta = await window.api.invoke('clip:save', {
      cameras: pending.collected.map((clip) => ({
        cameraId: clip.cameraId,
        label: this.cameras.get(clip.cameraId)?.label ?? clip.cameraId,
        mp4: clip.mp4,
        firstFrameWallMs: clip.firstFrameWallMs
      })),
      primaryCameraId: primaryId,
      thumbnailJpeg: pending.thumbnailJpeg,
      triggerWallMs: pending.triggerWallMs,
      trigger: { source: pending.source, confidence: pending.confidence },
      preRollMs: this.settings.preRollSec * 1000,
      postRollMs: this.settings.postRollSec * 1000,
      fps: this.settings.fps
    })

    const primaryMp4 = pending.collected.find((clip) => clip.cameraId === primaryId)!.mp4
    this.listeners.clipSaved?.(meta, primaryMp4)
  }

  private emitCameras(): void {
    this.listeners.camerasChanged?.(this.getCameras())
  }

  dispose(): void {
    this.stopPresence()
    for (const id of [...this.cameras.keys()]) this.removeCamera(id)
  }
}
