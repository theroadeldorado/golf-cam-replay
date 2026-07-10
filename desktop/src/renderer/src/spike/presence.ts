/**
 * Spike: validate offline MediaPipe loading + inference.
 *
 * The hard gate under Stage B — proves the bundled wasm + model load over the
 * `asset://` scheme under CSP (no internet) and that inference runs, on THIS
 * machine (esp. Windows). Run: ReplaySwing --spike=presence
 */
import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision'

async function main(): Promise<void> {
  const report: Record<string, unknown> = { spike: 'presence', userAgent: navigator.userAgent }
  try {
    const base = location.protocol === 'file:' ? 'asset://mediapipe' : '/mediapipe'
    const t0 = performance.now()
    const fileset = await FilesetResolver.forVisionTasks(`${base}/wasm`)

    let delegate: 'GPU' | 'CPU' = 'GPU'
    let detector: ObjectDetector
    try {
      detector = await ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}/efficientdet_lite0.tflite`, delegate: 'GPU' },
        runningMode: 'IMAGE',
        categoryAllowlist: ['person'],
        maxResults: 1
      })
    } catch {
      delegate = 'CPU'
      detector = await ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}/efficientdet_lite0.tflite`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        categoryAllowlist: ['person'],
        maxResults: 1
      })
    }
    report['loaded'] = true
    report['delegate'] = delegate
    report['loadMs'] = Math.round(performance.now() - t0)

    // One inference on a synthetic frame — proves the graph runs end to end.
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 320
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#4a5a3a'
    ctx.fillRect(0, 0, 320, 320)
    ctx.fillStyle = '#c8b088'
    ctx.fillRect(120, 60, 80, 220) // a vaguely person-ish blob
    const t1 = performance.now()
    const result = detector.detect(canvas)
    report['inferenceMs'] = Math.round(performance.now() - t1)
    report['detections'] = result.detections.length

    detector.close()
    report['ok'] = true
  } catch (error) {
    report['ok'] = false
    report['fatal'] = String(error instanceof Error ? (error.stack ?? error.message) : error)
  }

  await window.api.invoke('spike:report', report)
}

void main()
