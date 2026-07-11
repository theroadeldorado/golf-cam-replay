/** A configured camera. `id` is a getUserMedia deviceId for USB cameras or a
 * pairing session id for phone cameras — both stable across app restarts. */
export interface CameraConfig {
  id: string
  kind: 'usb' | 'phone'
  label: string
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Drawing annotations, stored per camera in normalized 0–1 coordinates
 * relative to the video image (see renderer/src/drawing/shapes.ts). */
export interface DrawnLine {
  id: string
  kind: 'line'
  color: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface DrawnCircle {
  id: string
  kind: 'circle'
  color: string
  cx: number
  cy: number
  r: number
}

export type DrawnShape = DrawnLine | DrawnCircle

export type TriggerMode = 'audio' | 'manual'

export interface Settings {
  preRollSec: number
  postRollSec: number
  cooldownSec: number
  fps: number
  cameras: CameraConfig[]
  primaryCameraId: string | null
  /** How auto-recording is triggered. */
  triggerMode: TriggerMode
  /** RMS level threshold for the audio trigger (0.01–1.0). */
  audioThreshold: number
  /** Microphone device id for audio trigger. null = default mic. */
  micDeviceId: string | null
  pip: { bounds: WindowBounds | null; visible: boolean }
  mainWindowBounds: WindowBounds | null
  /** Per-camera drawing annotations, keyed by camera id. */
  drawings: Record<string, DrawnShape[]>
}

/** Extra metadata v2 records per clip. Lives under the `v2` key in clips.json
 * entries so v1 readers ignore it. */
export interface ClipMetaV2 {
  trigger: { source: 'manual' | 'audio'; confidence?: number }
  preRollMs: number
  postRollMs: number
  fps: number
  /** Per-camera offset (ms) of the first saved frame relative to the nominal
   * clip start (trigger − preRoll), for future comparison-view alignment. */
  cameraOffsets: Record<string, number>
}

/** One entry in a session's clips.json. Field names match the v1 format
 * (see app/recording.py save_clip) so v1 and v2 can read each other's sessions. */
export interface ClipMeta {
  file: string
  timestamp: number
  cameras: number
  camera_files: Record<string, string>
  camera_labels: Record<string, string>
  thumbnail?: string
  pinned?: boolean
  marked_not_shot?: boolean
  v2?: ClipMetaV2
}

export interface SaveClipCamera {
  cameraId: string
  label: string
  mp4: ArrayBuffer
  firstFrameWallMs: number
}

/** Renderer → main payload carrying one triggered capture's muxed MP4s. */
export interface SaveClipRequest {
  cameras: SaveClipCamera[]
  primaryCameraId: string
  thumbnailJpeg: ArrayBuffer | null
  triggerWallMs: number
  trigger: { source: 'manual' | 'audio'; confidence?: number }
  preRollMs: number
  postRollMs: number
  fps: number
}

export interface SessionInfo {
  /** Folder name, e.g. "2026-07-08_14-30-00" */
  id: string
  path: string
  clipCount: number
  createdAt: number
}
