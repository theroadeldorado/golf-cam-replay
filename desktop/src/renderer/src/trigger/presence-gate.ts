import { PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { loadMediapipeFileset, loadPoseModelBytes } from './mediapipe-assets'

export interface PresenceGateConfig {
  detectionFps: number
  enterDurationMs: number
  leaveDurationMs: number
  minConfidence: number
}

export type PresenceStatus = 'loading' | 'absent' | 'entering' | 'present' | 'leaving' | 'error'

export type BodyVisibility = 'full' | 'partial' | 'none'

export interface PresenceEvent {
  status: PresenceStatus
  confidence: number
  landmarks: NormalizedLandmark[] | null
  bodyVisibility: BodyVisibility
  atMs: number
}

const DEFAULT_CONFIG: PresenceGateConfig = {
  detectionFps: 5,
  enterDurationMs: 1500,
  leaveDurationMs: 5000,
  minConfidence: 0.5
}

// Landmark indices for full-body check
const FULL_BODY_LANDMARKS = [
  0,        // nose (head)
  11, 12,   // shoulders
  23, 24,   // hips
  27, 28    // ankles
]

const FRAME_MARGIN = 0.02
const LANDMARK_VIS_THRESHOLD = 0.5

function checkBodyVisibility(landmarks: NormalizedLandmark[]): BodyVisibility {
  let inFrame = 0
  for (const idx of FULL_BODY_LANDMARKS) {
    const lm = landmarks[idx]
    if (!lm) continue
    const vis = lm.visibility ?? 0
    const xInFrame = lm.x > FRAME_MARGIN && lm.x < (1 - FRAME_MARGIN)
    const yInFrame = lm.y > FRAME_MARGIN && lm.y < (1 - FRAME_MARGIN)
    if (vis >= LANDMARK_VIS_THRESHOLD && xInFrame && yInFrame) {
      inFrame++
    }
  }
  if (inFrame === FULL_BODY_LANDMARKS.length) return 'full'
  if (inFrame >= 3) return 'partial'
  return 'none'
}

export class PresenceGate {
  private config: PresenceGateConfig
  private landmarker: PoseLandmarker | null = null
  private video: HTMLVideoElement | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private _status: PresenceStatus = 'loading'
  private _bodyVisibility: BodyVisibility = 'none'
  private transitionStartMs = 0
  private lastConfidence = 0
  private lastLandmarks: NormalizedLandmark[] | null = null

  onStatusChange: ((event: PresenceEvent) => void) | null = null
  onDetection: ((landmarks: NormalizedLandmark[] | null, bodyVisibility: BodyVisibility) => void) | null = null

  constructor(config?: Partial<PresenceGateConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  get status(): PresenceStatus {
    return this._status
  }

  get bodyVisibility(): BodyVisibility {
    return this._bodyVisibility
  }

  get isPresent(): boolean {
    return this._status === 'present' || this._status === 'leaving'
  }

  async load(): Promise<void> {
    try {
      const [fileset, modelBytes] = await Promise.all([
        loadMediapipeFileset(),
        loadPoseModelBytes()
      ])

      this.landmarker = await PoseLandmarker.createFromOptions(
        { wasmLoaderPath: fileset.wasmLoaderPath, wasmBinaryPath: fileset.wasmBinaryPath } as never,
        {
          baseOptions: {
            modelAssetBuffer: new Uint8Array(modelBytes),
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: this.config.minConfidence,
          minTrackingConfidence: 0.5
        }
      )

      this.setStatus('absent', 0)
    } catch (err) {
      console.error('[PRESENCE] Failed to load PoseLandmarker:', err)
      try {
        const [fileset, modelBytes] = await Promise.all([
          loadMediapipeFileset(),
          loadPoseModelBytes()
        ])

        this.landmarker = await PoseLandmarker.createFromOptions(
          { wasmLoaderPath: fileset.wasmLoaderPath, wasmBinaryPath: fileset.wasmBinaryPath } as never,
          {
            baseOptions: {
              modelAssetBuffer: new Uint8Array(modelBytes),
              delegate: 'CPU'
            },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: this.config.minConfidence,
            minTrackingConfidence: 0.5
          }
        )

        this.setStatus('absent', 0)
        console.warn('[PRESENCE] Loaded with CPU fallback')
      } catch (cpuErr) {
        console.error('[PRESENCE] CPU fallback also failed:', cpuErr)
        this.setStatus('error', 0)
      }
    }
  }

  start(video: HTMLVideoElement): void {
    this.video = video
    if (!this.landmarker || this._status === 'error') return
    this.startDetectionLoop()
  }

  rebind(video: HTMLVideoElement): void {
    this.video = video
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  dispose(): void {
    this.stop()
    this.landmarker?.close()
    this.landmarker = null
    this.video = null
  }

  private startDetectionLoop(): void {
    if (this.timer) clearInterval(this.timer)
    const intervalMs = 1000 / this.config.detectionFps
    this.timer = setInterval(() => this.detect(), intervalMs)
  }

  private detect(): void {
    const video = this.video
    if (!video || !this.landmarker) return
    if (video.readyState < 2 || video.videoWidth === 0) return

    const nowMs = performance.now()
    let fullBodyDetected = false
    let confidence = 0
    let landmarks: NormalizedLandmark[] | null = null
    let bodyVis: BodyVisibility = 'none'

    try {
      const result = this.landmarker.detectForVideo(video, nowMs)
      if (result.landmarks.length > 0) {
        landmarks = result.landmarks[0]
        bodyVis = checkBodyVisibility(landmarks)

        const keyIndices = [0, 11, 12, 23, 24]
        let visSum = 0
        for (const idx of keyIndices) {
          visSum += landmarks[idx]?.visibility ?? 0
        }
        confidence = visSum / keyIndices.length

        // Arm based on confidence (person detected), full-body is advisory only
        fullBodyDetected = confidence >= this.config.minConfidence
      }
    } catch {
      return
    }

    this.lastConfidence = confidence
    this.lastLandmarks = landmarks
    this._bodyVisibility = bodyVis
    this.onDetection?.(landmarks, bodyVis)
    this.updateFsm(fullBodyDetected, nowMs)
  }

  private updateFsm(personDetected: boolean, nowMs: number): void {
    switch (this._status) {
      case 'absent':
        if (personDetected) {
          this.transitionStartMs = nowMs
          this.setStatus('entering', nowMs)
        }
        break

      case 'entering':
        if (!personDetected) {
          this.setStatus('absent', nowMs)
        } else if (nowMs - this.transitionStartMs >= this.config.enterDurationMs) {
          this.setStatus('present', nowMs)
        }
        break

      case 'present':
        if (!personDetected) {
          this.transitionStartMs = nowMs
          this.setStatus('leaving', nowMs)
        }
        break

      case 'leaving':
        if (personDetected) {
          this.setStatus('present', nowMs)
        } else if (nowMs - this.transitionStartMs >= this.config.leaveDurationMs) {
          this.setStatus('absent', nowMs)
        }
        break
    }
  }

  private setStatus(status: PresenceStatus, atMs: number): void {
    if (status === this._status) return
    this._status = status
    this.onStatusChange?.({
      status,
      confidence: this.lastConfidence,
      landmarks: this.lastLandmarks,
      bodyVisibility: this._bodyVisibility,
      atMs
    })
  }
}
