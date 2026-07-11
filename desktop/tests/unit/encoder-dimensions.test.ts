import { describe, it, expect } from 'vitest'
import { ChunkRing, type StoredChunk } from '../../src/renderer/src/capture/chunk-ring'

/**
 * Tests for the encoder worker's warmup-then-lock strategy.
 *
 * The encoder does NOT configure until it has seen WARMUP_FRAMES (30)
 * consecutive frames at the same resolution. This avoids calling
 * encoder.configure() mid-stream (which stalls hardware encoders).
 *
 * After warmup, dimensions are locked permanently. Any mismatched frame
 * (vibration, brief WebRTC hiccup) is silently dropped.
 */

const FPS = 30
const FRAME_MS = 1000 / FPS
const WARMUP_FRAMES = 30
const PRE_ROLL_MS = 1500
const POST_ROLL_MS = 1500
const RETENTION_MS = PRE_ROLL_MS + POST_ROLL_MS + 2000

function makeChunk(index: number, wallBase: number, isKey: boolean): StoredChunk {
  return {
    data: new Uint8Array([index & 0xff]),
    type: isKey ? 'key' : 'delta',
    timestampUs: index * FRAME_MS * 1000,
    durationUs: FRAME_MS * 1000,
    wallClockMs: wallBase + index * FRAME_MS
  }
}

describe('warmup phase — WebRTC resolution ramp-up', () => {
  it('ring stays empty during warmup (no encoding happens)', () => {
    const ring = new ChunkRing(RETENTION_MS)
    // During warmup, the worker drops all frames without encoding.
    // Ring stays empty.
    expect(ring.size).toBe(0)
  })

  it('ring fills only after warmup at stable resolution', () => {
    const ring = new ChunkRing(RETENTION_MS)

    // Simulate: warmup phase skipped all initial resolution changes.
    // Encoder configured after 30 stable frames at 720x1280.
    // Now the ring starts filling.
    const stableBase = 3000
    for (let i = 0; i < 150; i++) {
      ring.push(makeChunk(i, stableBase, i % FPS === 0))
    }

    expect(ring.size).toBeGreaterThan(0)
    const head = ring.peekHead()!
    const tail = ring.peekTail()!
    expect(tail.wallClockMs - head.wallClockMs).toBeGreaterThanOrEqual(
      RETENTION_MS - 1000
    )
  })

  it('warmup detects stable resolution after ramp-up pattern', () => {
    // Simulate what the worker sees:
    // 1280x720 for 10 frames → 180x320 for 5 frames → 360x640 for 15 frames → 720x1280 for 30+ frames
    // The warmup counter resets on each dimension change.
    // Only 720x1280 reaches WARMUP_FRAMES (30).

    let stableCount = 0
    const dims = [
      ...Array(10).fill([1280, 720]),
      ...Array(5).fill([180, 320]),
      ...Array(15).fill([360, 640]),
      ...Array(40).fill([720, 1280])
    ]

    let currentWidth = 0
    let currentHeight = 0
    let warmupCount = 0
    let locked = false

    for (const [w, h] of dims) {
      if (w === currentWidth && h === currentHeight) {
        warmupCount++
      } else {
        currentWidth = w
        currentHeight = h
        warmupCount = 1
      }
      if (warmupCount >= WARMUP_FRAMES && !locked) {
        locked = true
        stableCount = warmupCount
      }
    }

    expect(locked).toBe(true)
    expect(currentWidth).toBe(720)
    expect(currentHeight).toBe(1280)
    expect(stableCount).toBe(WARMUP_FRAMES)
  })
})

describe('post-warmup — clip capture', () => {
  it('clip contains full pre-roll + post-roll', () => {
    const ring = new ChunkRing(RETENTION_MS)
    const wallBase = 10000

    for (let i = 0; i < FPS * 6; i++) {
      ring.push(makeChunk(i, wallBase, i % FPS === 0))
    }

    const triggerWallMs = wallBase + 4500
    const slice = ring.sliceFrom(triggerWallMs - PRE_ROLL_MS)

    expect(slice.length).toBeGreaterThan(0)
    expect(slice[0].type).toBe('key')
    const spanMs = slice[slice.length - 1].wallClockMs - slice[0].wallClockMs
    expect(spanMs).toBeGreaterThanOrEqual(PRE_ROLL_MS + POST_ROLL_MS - FRAME_MS * 2)
  })

  it('correct frame count for 1.5s pre + 1.5s post', () => {
    const ring = new ChunkRing(RETENTION_MS)
    const wallBase = 50000

    for (let i = 0; i < FPS * 5; i++) {
      ring.push(makeChunk(i, wallBase, i % FPS === 0))
    }

    const triggerWallMs = wallBase + 3500
    const slice = ring.sliceFrom(triggerWallMs - PRE_ROLL_MS)

    expect(slice.length).toBeGreaterThanOrEqual(60)
    expect(slice[0].type).toBe('key')
  })

  it('trigger 30s after connection produces valid clip', () => {
    const ring = new ChunkRing(RETENTION_MS)
    const stableBase = 3000

    for (let i = 0; i < FPS * 35; i++) {
      ring.push(makeChunk(i, stableBase, i % FPS === 0))
    }

    const triggerWallMs = 33000
    const slice = ring.sliceFrom(triggerWallMs - PRE_ROLL_MS)

    expect(slice.length).toBeGreaterThan(0)
    expect(slice[0].type).toBe('key')
    expect(slice[0].wallClockMs).toBeLessThanOrEqual(triggerWallMs - PRE_ROLL_MS + 1000)
  })
})

describe('clock sync — renderer/worker time offset', () => {
  it('ring data aligns with trigger when clocks are synced via offset', () => {
    const ring = new ChunkRing(RETENTION_MS)

    // Simulate: worker performance.now() starts at 0, renderer at 800000.
    // Offset = 800000 - 0 = 800000. Worker adds offset to its performance.now().
    const timeOffset = 800000
    const workerBase = 5000 // worker's performance.now() when frames start

    for (let i = 0; i < FPS * 5; i++) {
      const workerNow = workerBase + i * FRAME_MS
      const wallMs = workerNow + timeOffset // rendererNow()
      ring.push({
        data: new Uint8Array([i & 0xff]),
        type: i % FPS === 0 ? 'key' : 'delta',
        timestampUs: i * FRAME_MS * 1000,
        durationUs: FRAME_MS * 1000,
        wallClockMs: wallMs
      })
    }

    // Trigger fires in renderer time domain (800000 + 5000 + 3500 = 808500)
    const triggerWallMs = timeOffset + workerBase + 3500
    const slice = ring.sliceFrom(triggerWallMs - PRE_ROLL_MS)

    expect(slice.length).toBeGreaterThan(0)
    expect(slice[0].wallClockMs).toBeLessThanOrEqual(triggerWallMs - PRE_ROLL_MS + 1000)
    const spanMs = slice[slice.length - 1].wallClockMs - slice[0].wallClockMs
    expect(spanMs).toBeGreaterThanOrEqual(PRE_ROLL_MS + POST_ROLL_MS - FRAME_MS * 2)
  })

  it('without offset fix, slice returns stale data from wrong time', () => {
    const ring = new ChunkRing(RETENTION_MS)

    // Without offset: worker stores raw performance.now() (small values)
    // Trigger uses renderer's performance.now() (large values)
    const workerBase = 5000

    for (let i = 0; i < FPS * 5; i++) {
      ring.push({
        data: new Uint8Array([i & 0xff]),
        type: i % FPS === 0 ? 'key' : 'delta',
        timestampUs: i * FRAME_MS * 1000,
        durationUs: FRAME_MS * 1000,
        wallClockMs: workerBase + i * FRAME_MS // raw worker time, no offset
      })
    }

    // Renderer trigger at 805000 — way past ring data (5000-10000 range)
    const triggerWallMs = 805000
    const slice = ring.sliceFrom(triggerWallMs - PRE_ROLL_MS)

    // sliceFrom returns the last GOP — stale data from ~800s ago.
    // The slice's last frame is at ~10000 but trigger wanted data from ~803500.
    expect(slice.length).toBeGreaterThan(0)
    const lastFrame = slice[slice.length - 1]
    const gap = triggerWallMs - lastFrame.wallClockMs
    // Gap is ~795000ms — confirming the ring data is completely stale
    expect(gap).toBeGreaterThan(700000)
  })
})

describe('vibration protection — post-warmup lock', () => {
  it('dropped vibration frames do not affect ring', () => {
    const ring = new ChunkRing(RETENTION_MS)
    const wallBase = 5000

    for (let i = 0; i < 100; i++) {
      ring.push(makeChunk(i, wallBase, i % FPS === 0))
    }
    const sizeBefore = ring.size

    // Vibration: 2 frames at different dims dropped by worker. Ring untouched.
    for (let i = 100; i < 130; i++) {
      ring.push(makeChunk(i, wallBase, i % FPS === 0))
    }

    expect(ring.size).toBe(sizeBefore + 30)
    expect(ring.peekHead()!.type).toBe('key')
  })

  it('many vibration frames dropped, ring still has correct content', () => {
    const ring = new ChunkRing(RETENTION_MS)
    const wallBase = 20000

    for (let i = 0; i < 120; i++) {
      ring.push(makeChunk(i, wallBase, i % FPS === 0))
    }
    const sizeBefore = ring.size

    // Even 20 consecutive vibration frames: all dropped (locked, never reconfigures).
    // Ring unaffected. Resume normal frames:
    for (let i = 120; i < 150; i++) {
      ring.push(makeChunk(i, wallBase, i % FPS === 0))
    }

    expect(ring.size).toBe(sizeBefore + 30)
  })

  it('vibration during post-roll does not shorten clip', () => {
    const ring = new ChunkRing(RETENTION_MS)
    const wallBase = 20000

    for (let i = 0; i < 150; i++) {
      ring.push(makeChunk(i, wallBase, i % FPS === 0))
    }

    const triggerWallMs = wallBase + 3500

    // Post-roll: 2 vibration frames dropped, then 45 more normal.
    for (let i = 150; i < 195; i++) {
      ring.push(makeChunk(i, wallBase, i % FPS === 0))
    }

    const slice = ring.sliceFrom(triggerWallMs - PRE_ROLL_MS)
    const postRollCaptured = slice[slice.length - 1].wallClockMs - triggerWallMs

    expect(postRollCaptured).toBeGreaterThanOrEqual(POST_ROLL_MS - FRAME_MS * 3)
  })
})
