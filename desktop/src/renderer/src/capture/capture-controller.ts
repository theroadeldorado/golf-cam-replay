/**
 * Orchestrates the live capture graph: one encoder worker per camera, all
 * buffering continuously into their ChunkRings. A trigger (manual or audio)
 * broadcasts a shared wall-clock timestamp to every worker, collects the
 * resulting MP4s, and hands them to main for disk writes.
 */
import type { ClipMeta, Settings } from '@shared/types'
import type { FromWorkerMessage, WorkerInit } from './worker-protocol'
import { openUsbCamera } from '../cameras/usb'
import { AudioTrigger, type AudioSampleEvent } from '../trigger/audio-trigger'

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

interface CollectedClip {
  cameraId: string
  mp4: ArrayBuffer
  firstFrameWallMs: number
}

interface PendingCapture {
  triggerWallMs: number
  source: 'manual' | 'audio'
  confidence?: number
  expected: Set<string>
  collected: CollectedClip[]
  thumbnailJpeg: ArrayBuffer | null
  timeout: ReturnType<typeof setTimeout>
}

interface ControllerEvents {
  camerasChanged: (cameras: ActiveCamera[]) => void
  clipSaved: (meta: ClipMeta, primaryMp4: ArrayBuffer) => void
  captureStateChanged: (capturing: boolean) => void
  audioEvent: (event: AudioSampleEvent) => void
}

export class CaptureController {
  private cameras = new Map<string, ActiveCamera>()
  private workers = new Map<string, Worker>()
  private encoderTracks = new Map<string, MediaStreamTrack>()
  private thumbnailVideo: HTMLVideoElement | null = null
  private pending: PendingCapture | null = null
  private listeners: Partial<ControllerEvents> = {}
  private audioTrigger: AudioTrigger | null = null

  constructor(private settings: Settings) {}

  /** Arm/disarm the auto trigger. Manual trigger works regardless. */
  setArmed(armed: boolean): void {
    this.audioTrigger?.stop()
    this.audioTrigger = null
    if (armed && this.settings.triggerMode === 'audio') {
      const cooldownMs = Math.max(
        this.settings.cooldownSec * 1000,
        this.settings.postRollSec * 1000 + 2000
      )
      this.startAudioTrigger(cooldownMs)
    }
  }

  private startAudioTrigger(cooldownMs: number): void {
    const trigger = new AudioTrigger({
      threshold: this.settings.audioThreshold,
      cooldownMs
    })
    this.audioTrigger = trigger

    const source = this.resolveAudioSource()

    const callbacks = {
      onSample: (event: import('../trigger/audio-trigger').AudioSampleEvent) =>
        this.listeners.audioEvent?.(event),
      onFire: (atMs: number) => {
        if (!this.pending) this.triggerNow('audio', undefined, atMs)
      }
    }

    void trigger
      .start(source, callbacks)
      .catch((error) => {
        // Local mic failed — try falling back to a phone camera's mic.
        const phoneMic = this.findPhoneAudioStream()
        if (phoneMic && !(source instanceof MediaStream)) {
          console.warn('[AUDIO] Local mic failed, falling back to phone mic')
          return trigger.start(phoneMic, callbacks)
        }
        throw error
      })
      .catch((error) => {
        console.error('[AUDIO] Failed to start:', error)
        this.audioTrigger = null
        this.listeners.audioEvent?.({
          state: 'disarmed',
          level: 0,
          threshold: this.settings.audioThreshold,
          peak: 0,
          error: 'No microphone available — connect a phone or plug in a mic'
        })
      })
  }

  private resolveAudioSource(): string | MediaStream | null {
    const micId = this.settings.micDeviceId
    if (!micId) return null
    const phoneCamera = this.cameras.get(micId)
    if (phoneCamera?.kind === 'phone') {
      const audioTrack = phoneCamera.stream?.getAudioTracks()[0]
      if (audioTrack) return new MediaStream([audioTrack])
      return null
    }
    return micId
  }

  private findPhoneAudioStream(): MediaStream | null {
    for (const camera of this.cameras.values()) {
      if (camera.kind === 'phone' && camera.state === 'live' && camera.stream) {
        const audioTrack = camera.stream.getAudioTracks()[0]
        if (audioTrack) return new MediaStream([audioTrack])
      }
    }
    return null
  }

  get isArmed(): boolean {
    return this.audioTrigger !== null
  }

  on<K extends keyof ControllerEvents>(event: K, listener: ControllerEvents[K]): void {
    this.listeners[event] = listener
  }

  updateSettings(settings: Settings): void {
    this.settings = settings
    this.audioTrigger?.updateThreshold(settings.audioThreshold)
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

  /** Used by the phone source: hand a connected WebRTC track over. */
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
    const oldWorker = this.workers.get(camera.id)
    if (oldWorker) {
      oldWorker.postMessage({ type: 'stop' })
      this.workers.delete(camera.id)
      this.encoderTracks.get(camera.id)?.stop()
      this.encoderTracks.delete(camera.id)
    }

    camera.stream = stream
    camera.state = 'live'

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

    const trackSettings = encoderTrack.getSettings()
    const processor = new MediaStreamTrackProcessor({ track: encoderTrack })
    const init: WorkerInit = {
      type: 'init',
      cameraId: camera.id,
      frames: processor.readable,
      width: trackSettings.width ?? 1280,
      height: trackSettings.height ?? 720,
      fps: this.settings.fps,
      bitrate: BITRATE,
      retentionMs: (this.settings.preRollSec + this.settings.postRollSec) * 1000 + RING_SLACK_MS,
      rendererNowMs: performance.now()
    }
    worker.postMessage(init, [processor.readable as unknown as Transferable])

    const isPrimary = this.primaryCameraId === camera.id
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
  triggerNow(source: 'manual' | 'audio', confidence?: number, atWallMs?: number): boolean {
    if (this.pending) return false
    const liveCameraIds = [...this.cameras.values()]
      .filter((camera) => camera.state === 'live')
      .map((camera) => camera.id)
    if (liveCameraIds.length === 0) return false

    const triggerWallMs = atWallMs ?? performance.now()
    console.log(`[CAPTURE] trigger fired source=${source} cameras=${liveCameraIds.length} postRoll=${this.settings.postRollSec}s`)
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
      case 'clip': {
        const elapsed = this.pending ? performance.now() - this.pending.triggerWallMs : 0
        const sizeMb = (message.mp4.byteLength / 1_048_576).toFixed(2)
        console.log(`[CAPTURE] clip received camera=${message.cameraId.slice(0, 8)} size=${sizeMb}MB elapsed=${(elapsed / 1000).toFixed(1)}s remaining=${this.pending?.expected.size ?? 0}`)
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
      }
      case 'error':
        console.warn(`[CAPTURE] worker error camera=${message.cameraId.slice(0, 8)} fatal=${message.fatal} msg=${message.message}`)
        if (camera && message.fatal) {
          camera.state = 'error'
          camera.error = message.message
          this.emitCameras()
        }
        if (this.pending?.expected.has(message.cameraId) && message.fatal) {
          this.pending.expected.delete(message.cameraId)
          if (this.pending.expected.size === 0) void this.finishCapture()
        }
        break
      case 'stream-ended':
        if (camera?.stream && camera.state === 'live') {
          console.warn(`[CAPTURE] stream ended for camera=${message.cameraId.slice(0, 8)}, re-attaching`)
          this.attachStream(camera, camera.stream)
        }
        break
      case 'stream-stalled':
        if (camera?.stream && camera.state === 'live') {
          console.warn(`[CAPTURE] stream stalled for camera=${message.cameraId.slice(0, 8)} (${(message.stallMs / 1000).toFixed(1)}s), re-cloning track`)
          this.attachStream(camera, camera.stream)
        }
        break
    }
  }

  private async finishCapture(): Promise<void> {
    const pending = this.pending
    if (!pending) return
    const totalElapsed = performance.now() - pending.triggerWallMs
    console.log(`[CAPTURE] all clips collected (${pending.collected.length}) in ${(totalElapsed / 1000).toFixed(1)}s — saving to disk`)
    this.pending = null
    clearTimeout(pending.timeout)
    this.listeners.captureStateChanged?.(false)

    if (pending.collected.length === 0) return

    const primaryId = pending.collected.some((clip) => clip.cameraId === this.primaryCameraId)
      ? this.primaryCameraId
      : pending.collected[0].cameraId

    const saveStart = performance.now()
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
    console.log(`[CAPTURE] saved to disk in ${(performance.now() - saveStart).toFixed(0)}ms — clip ready`)

    const primaryMp4 = pending.collected.find((clip) => clip.cameraId === primaryId)!.mp4
    this.listeners.clipSaved?.(meta, primaryMp4)
  }

  private emitCameras(): void {
    this.listeners.camerasChanged?.(this.getCameras())
  }

  dispose(): void {
    this.audioTrigger?.stop()
    this.audioTrigger = null
    for (const id of [...this.cameras.keys()]) this.removeCamera(id)
  }
}
