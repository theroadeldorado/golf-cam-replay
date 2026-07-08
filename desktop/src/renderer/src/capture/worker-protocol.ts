/** Message contract between capture-controller and encoder.worker. */

export interface WorkerInit {
  type: 'init'
  cameraId: string
  /** Transferred from the renderer's MediaStreamTrackProcessor — tracks
   * themselves aren't transferable in Electron's Chromium. */
  frames: ReadableStream<VideoFrame>
  width: number
  height: number
  fps: number
  bitrate: number
  retentionMs: number
  /** Detection sampling: 0 = disabled (non-primary cameras). */
  motionSampleFps: number
  /** Normalized 0–1 region of interest for motion sampling; null = full frame. */
  motionRoi: { x: number; y: number; w: number; h: number } | null
}

export interface WorkerTrigger {
  type: 'trigger'
  /** performance.now() timestamp of the trigger event (shared clock). */
  triggerWallMs: number
  preRollMs: number
  postRollMs: number
}

export interface WorkerStop {
  type: 'stop'
}

export type ToWorkerMessage = WorkerInit | WorkerTrigger | WorkerStop

export interface WorkerClip {
  type: 'clip'
  cameraId: string
  mp4: ArrayBuffer
  width: number
  height: number
  /** Wall-clock ms of the first frame actually included in the clip. */
  firstFrameWallMs: number
  triggerWallMs: number
}

export interface WorkerStatus {
  type: 'status'
  cameraId: string
  measuredFps: number
  encodeQueueDepth: number
  ringChunks: number
}

/** Downscaled motion-energy sample for the vision trigger (primary camera only). */
export interface WorkerMotion {
  type: 'motion'
  cameraId: string
  wallClockMs: number
  /** Mean absolute luma difference vs the previous sample, 0–255. */
  energy: number
}

export interface WorkerError {
  type: 'error'
  cameraId: string
  message: string
  fatal: boolean
}

export type FromWorkerMessage = WorkerClip | WorkerStatus | WorkerMotion | WorkerError
