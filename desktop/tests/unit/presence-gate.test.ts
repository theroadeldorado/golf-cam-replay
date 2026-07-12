import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockDetectForVideo, mockClose } = vi.hoisted(() => ({
  mockDetectForVideo: vi.fn(),
  mockClose: vi.fn()
}))

vi.mock('../../src/renderer/src/trigger/mediapipe-assets', () => ({
  loadMediapipeFileset: vi.fn().mockResolvedValue({
    wasmLoaderPath: 'blob:mock-loader',
    wasmBinaryPath: 'blob:mock-binary'
  }),
  loadPoseModelBytes: vi.fn().mockResolvedValue(new ArrayBuffer(8))
}))

vi.mock('@mediapipe/tasks-vision', () => ({
  PoseLandmarker: {
    createFromOptions: vi.fn().mockResolvedValue({
      detectForVideo: mockDetectForVideo,
      close: mockClose
    })
  }
}))

import { PresenceGate } from '../../src/renderer/src/trigger/presence-gate'

function makeVideoStub(): HTMLVideoElement {
  return { readyState: 4, videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement
}

function makeLandmarks(): Array<{ x: number; y: number; z: number; visibility: number }> {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }))
}

describe('PresenceGate FSM', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockDetectForVideo.mockReset()
    mockClose.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('transitions absent → entering → present after sustained detection', async () => {
    const gate = new PresenceGate({ detectionFps: 5, enterDurationMs: 1500, leaveDurationMs: 5000, minConfidence: 0.5 })
    await gate.load()
    expect(gate.status).toBe('absent')

    const onChange = vi.fn()
    gate.onStatusChange = onChange

    mockDetectForVideo.mockReturnValue({ landmarks: [makeLandmarks()] })
    gate.start(makeVideoStub())

    // First detection tick at 200ms — enters 'entering' (transitionStartMs=200)
    vi.advanceTimersByTime(200)
    expect(gate.status).toBe('entering')

    // Not yet present at 1400ms (1400-200=1200 < 1500)
    vi.advanceTimersByTime(1200)
    expect(gate.status).toBe('entering')

    // At 1800ms: 1800-200=1600 >= 1500 → transitions to 'present'
    vi.advanceTimersByTime(400)
    expect(gate.status).toBe('present')
    expect(gate.isPresent).toBe(true)

    gate.stop()
    gate.dispose()
  })

  it('transitions present → leaving → absent after sustained absence', async () => {
    const gate = new PresenceGate({ detectionFps: 5, enterDurationMs: 1500, leaveDurationMs: 5000, minConfidence: 0.5 })
    await gate.load()

    mockDetectForVideo.mockReturnValue({ landmarks: [makeLandmarks()] })
    gate.start(makeVideoStub())

    // Get to 'present'
    vi.advanceTimersByTime(1800)
    expect(gate.status).toBe('present')

    // Person leaves
    mockDetectForVideo.mockReturnValue({ landmarks: [] })
    vi.advanceTimersByTime(200)
    expect(gate.status).toBe('leaving')

    // Not yet absent (need 5000ms)
    vi.advanceTimersByTime(3000)
    expect(gate.status).toBe('leaving')
    expect(gate.isPresent).toBe(true)

    // After 5000ms — transitions to 'absent'
    vi.advanceTimersByTime(2000)
    expect(gate.status).toBe('absent')
    expect(gate.isPresent).toBe(false)

    gate.stop()
    gate.dispose()
  })

  it('resets entering counter if person disappears briefly', async () => {
    const gate = new PresenceGate({ detectionFps: 5, enterDurationMs: 1500, leaveDurationMs: 5000, minConfidence: 0.5 })
    await gate.load()

    mockDetectForVideo.mockReturnValue({ landmarks: [makeLandmarks()] })
    gate.start(makeVideoStub())

    // Start entering at 200ms
    vi.advanceTimersByTime(800)
    expect(gate.status).toBe('entering')

    // Person disappears
    mockDetectForVideo.mockReturnValue({ landmarks: [] })
    vi.advanceTimersByTime(200)
    expect(gate.status).toBe('absent')

    // Person returns — must wait full 1500ms again from this new detection
    mockDetectForVideo.mockReturnValue({ landmarks: [makeLandmarks()] })
    // Next tick sees person → entering again (transitionStartMs = currentTime)
    vi.advanceTimersByTime(200)
    expect(gate.status).toBe('entering')

    // Need 1500ms+ from the new transitionStart at the 200ms-aligned tick
    vi.advanceTimersByTime(1200)
    expect(gate.status).toBe('entering')

    vi.advanceTimersByTime(400)
    expect(gate.status).toBe('present')

    gate.stop()
    gate.dispose()
  })

  it('resets leaving counter if person reappears', async () => {
    const gate = new PresenceGate({ detectionFps: 5, enterDurationMs: 1500, leaveDurationMs: 5000, minConfidence: 0.5 })
    await gate.load()

    mockDetectForVideo.mockReturnValue({ landmarks: [makeLandmarks()] })
    gate.start(makeVideoStub())

    // Get to present
    vi.advanceTimersByTime(1800)
    expect(gate.status).toBe('present')

    // Person starts leaving
    mockDetectForVideo.mockReturnValue({ landmarks: [] })
    vi.advanceTimersByTime(3000)
    expect(gate.status).toBe('leaving')

    // Person reappears — back to present instantly
    mockDetectForVideo.mockReturnValue({ landmarks: [makeLandmarks()] })
    vi.advanceTimersByTime(200)
    expect(gate.status).toBe('present')

    gate.stop()
    gate.dispose()
  })

  it('stays absent when confidence is below threshold', async () => {
    const gate = new PresenceGate({ detectionFps: 5, enterDurationMs: 1500, leaveDurationMs: 5000, minConfidence: 0.5 })
    await gate.load()

    const lowConfLandmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 }))
    mockDetectForVideo.mockReturnValue({ landmarks: [lowConfLandmarks] })
    gate.start(makeVideoStub())

    vi.advanceTimersByTime(3000)
    expect(gate.status).toBe('absent')

    gate.stop()
    gate.dispose()
  })

  it('detects person even with partial body but reports bodyVisibility as partial', async () => {
    const gate = new PresenceGate({ detectionFps: 5, enterDurationMs: 1500, leaveDurationMs: 5000, minConfidence: 0.5 })
    await gate.load()

    // Upper body visible but ankles (27, 28) are below frame
    const partialLandmarks = Array.from({ length: 33 }, (_, i) => {
      if (i === 27 || i === 28) return { x: 0.5, y: 1.05, z: 0, visibility: 0.9 }
      return { x: 0.5, y: 0.5, z: 0, visibility: 0.9 }
    })
    mockDetectForVideo.mockReturnValue({ landmarks: [partialLandmarks] })
    gate.start(makeVideoStub())

    // Person still detected (confidence is fine), just partial body
    vi.advanceTimersByTime(1800)
    expect(gate.status).toBe('present')
    expect(gate.bodyVisibility).toBe('partial')

    gate.stop()
    gate.dispose()
  })

  it('emits bodyVisibility in status change events', async () => {
    const gate = new PresenceGate({ detectionFps: 5, enterDurationMs: 1500, leaveDurationMs: 5000, minConfidence: 0.5 })
    await gate.load()

    const onChange = vi.fn()
    gate.onStatusChange = onChange

    mockDetectForVideo.mockReturnValue({ landmarks: [makeLandmarks()] })
    gate.start(makeVideoStub())

    vi.advanceTimersByTime(1800)
    const statuses = onChange.mock.calls.map((c) => c[0].status)
    expect(statuses).toContain('entering')
    expect(statuses).toContain('present')

    const presentEvent = onChange.mock.calls.find((c) => c[0].status === 'present')
    expect(presentEvent[0].bodyVisibility).toBe('full')

    gate.stop()
    gate.dispose()
  })
})
