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
  /** Renderer's performance.now() at init time — used to sync clocks. */
  rendererNowMs: number
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

export interface WorkerError {
  type: 'error'
  cameraId: string
  message: string
  fatal: boolean
}

export interface WorkerStreamEnded {
  type: 'stream-ended'
  cameraId: string
}

export interface WorkerStreamStalled {
  type: 'stream-stalled'
  cameraId: string
  stallMs: number
}

export type FromWorkerMessage = WorkerClip | WorkerStatus | WorkerError | WorkerStreamEnded | WorkerStreamStalled
