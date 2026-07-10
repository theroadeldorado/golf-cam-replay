import {
  ObjectDetector,
  type ObjectDetectorOptions,
  type ObjectDetectorResult
} from '@mediapipe/tasks-vision'
import { loadMediapipeFileset, readAssetBytes } from './mediapipe-assets'

/**
 * Person-presence detector for the trigger camera. Runs MediaPipe's
 * ObjectDetector (EfficientDet-Lite0, 'person' class only) on the primary
 * camera's video at a low frame rate, exposing a simple `present` boolean the
 * vision trigger gates address on. Everything is best-effort: if the model
 * can't load, `available` is false and the trigger degrades to shape-only.
 *
 * Assets are bundled and served over the `asset://` scheme in production
 * (file://) and over the dev server in development.
 */

export interface PresenceState {
  present: boolean
  /** Normalized bounding box of the highest-scoring person, if any. */
  box: { x: number; y: number; w: number; h: number } | null
  atMs: number
}

const DEFAULT_FPS = 7
const DEFAULT_MIN_SCORE = 0.4

export class PresenceDetector {
  private detector: ObjectDetector | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private video: HTMLVideoElement | null = null
  private state: PresenceState = { present: true, box: null, atMs: 0 }
  private loaded = false

  constructor(
    private readonly fps = DEFAULT_FPS,
    private readonly minScore = DEFAULT_MIN_SCORE
  ) {}

  /** Load the model. Throws on failure (caller degrades to shape-only). */
  async load(): Promise<void> {
    // Read the bundled wasm + model as blobs (a file:// page can't fetch them,
    // and a custom scheme would change the app origin — see mediapipe-assets).
    const fileset = await loadMediapipeFileset()
    const modelBytes = await readAssetBytes('mediapipe/efficientdet_lite0.tflite')
    const options = (delegate: 'GPU' | 'CPU'): ObjectDetectorOptions => ({
      baseOptions: { modelAssetBuffer: new Uint8Array(modelBytes), delegate },
      runningMode: 'VIDEO',
      categoryAllowlist: ['person'],
      scoreThreshold: this.minScore,
      maxResults: 1
    })
    try {
      this.detector = await ObjectDetector.createFromOptions(fileset, options('GPU'))
    } catch {
      // Some machines lack a working WebGL2/GPU delegate — fall back to CPU.
      this.detector = await ObjectDetector.createFromOptions(fileset, options('CPU'))
    }
    this.loaded = true
  }

  get available(): boolean {
    return this.loaded
  }

  get latest(): PresenceState {
    return this.state
  }

  /** Begin detecting on a playing video element at the configured fps. */
  start(video: HTMLVideoElement): void {
    this.video = video
    if (this.timer) return
    const intervalMs = 1000 / this.fps
    this.timer = setInterval(() => this.detectOnce(), intervalMs)
  }

  /** Point at a different stream (primary camera changed) without reloading. */
  rebind(video: HTMLVideoElement): void {
    this.video = video
  }

  private detectOnce(): void {
    const video = this.video
    const detector = this.detector
    if (!video || !detector || video.readyState < 2 || video.videoWidth === 0) return
    try {
      const result: ObjectDetectorResult = detector.detectForVideo(video, performance.now())
      const person = result.detections[0]
      if (person?.boundingBox) {
        const bb = person.boundingBox
        this.state = {
          present: true,
          box: {
            x: bb.originX / video.videoWidth,
            y: bb.originY / video.videoHeight,
            w: bb.width / video.videoWidth,
            h: bb.height / video.videoHeight
          },
          atMs: performance.now()
        }
      } else {
        this.state = { present: false, box: null, atMs: performance.now() }
      }
    } catch {
      // A transient inference error shouldn't flip presence off (which would
      // wrongly block the trigger); hold the last state and try next tick.
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  dispose(): void {
    this.stop()
    this.detector?.close()
    this.detector = null
    this.video = null
    this.loaded = false
  }
}
