import { describe, it, expect } from 'vitest'
import { ChunkRing, type StoredChunk } from '../../src/renderer/src/capture/chunk-ring'

/** Build a chunk: keyframe every `gopSize` frames, one frame per `frameMs`. */
function makeChunk(index: number, frameMs: number, gopSize: number): StoredChunk {
  return {
    data: new Uint8Array([index & 0xff]),
    type: index % gopSize === 0 ? 'key' : 'delta',
    timestampUs: index * frameMs * 1000,
    durationUs: frameMs * 1000,
    wallClockMs: 100_000 + index * frameMs
  }
}

function fill(ring: ChunkRing, count: number, frameMs = 33, gopSize = 30): StoredChunk[] {
  const chunks = Array.from({ length: count }, (_, i) => makeChunk(i, frameMs, gopSize))
  for (const chunk of chunks) ring.push(chunk)
  return chunks
}

describe('ChunkRing', () => {
  it('keeps everything while under the retention window', () => {
    const ring = new ChunkRing(10_000)
    fill(ring, 60) // ~2s of 30fps
    expect(ring.size).toBe(60)
  })

  it('evicts whole GOPs from the head once the window is exceeded', () => {
    const ring = new ChunkRing(3_000)
    fill(ring, 300) // ~10s at 30fps, 1s GOPs
    // Head must still be a keyframe — never a mid-GOP cut.
    expect(ring.peekHead()!.type).toBe('key')
    // Retention: newest wallClock − oldest wallClock stays >= window (we only
    // drop a GOP when the *second* keyframe is old enough to cover the window).
    const spanMs = ring.peekTail()!.wallClockMs - ring.peekHead()!.wallClockMs
    expect(spanMs).toBeGreaterThanOrEqual(3_000)
    // But it must not hoard: span stays under window + 2 GOPs of slack.
    expect(spanMs).toBeLessThan(3_000 + 2_000)
  })

  it('never evicts the only keyframe', () => {
    const ring = new ChunkRing(1_000)
    fill(ring, 29, 33, 1000) // single keyframe at index 0, all others delta
    expect(ring.peekHead()!.type).toBe('key')
    expect(ring.size).toBe(29)
  })

  it('sliceFrom starts at the last keyframe at/before the requested time', () => {
    const ring = new ChunkRing(60_000)
    const chunks = fill(ring, 300)
    // Request a slice starting mid-GOP: t lands at frame 155 (keyframes at 150/180).
    const target = chunks[155].wallClockMs
    const slice = ring.sliceFrom(target)
    expect(slice[0].type).toBe('key')
    expect(slice[0].timestampUs).toBe(chunks[150].timestampUs)
    expect(slice[slice.length - 1].timestampUs).toBe(chunks[299].timestampUs)
  })

  it('sliceFrom before the first chunk returns everything from the first keyframe', () => {
    const ring = new ChunkRing(60_000)
    fill(ring, 90)
    const slice = ring.sliceFrom(0)
    expect(slice).toHaveLength(90)
    expect(slice[0].type).toBe('key')
  })

  it('sliceFrom exactly on a keyframe starts at that keyframe', () => {
    const ring = new ChunkRing(60_000)
    const chunks = fill(ring, 300)
    const slice = ring.sliceFrom(chunks[180].wallClockMs)
    expect(slice[0].timestampUs).toBe(chunks[180].timestampUs)
  })

  it('returns an empty slice when the ring is empty', () => {
    const ring = new ChunkRing(5_000)
    expect(ring.sliceFrom(123)).toEqual([])
  })

  it('clear empties the ring', () => {
    const ring = new ChunkRing(5_000)
    fill(ring, 60)
    ring.clear()
    expect(ring.size).toBe(0)
    expect(ring.sliceFrom(0)).toEqual([])
  })

  it('handles irregular keyframe cadence (network camera hiccups)', () => {
    const ring = new ChunkRing(2_000)
    let wall = 0
    // GOPs of wildly varying length.
    for (let gop = 0; gop < 20; gop++) {
      const gopLength = 5 + ((gop * 13) % 45)
      for (let i = 0; i < gopLength; i++) {
        wall += 33
        ring.push({
          data: new Uint8Array(1),
          type: i === 0 ? 'key' : 'delta',
          timestampUs: wall * 1000,
          durationUs: 33_000,
          wallClockMs: wall
        })
      }
    }
    expect(ring.peekHead()!.type).toBe('key')
    const span = ring.peekTail()!.wallClockMs - ring.peekHead()!.wallClockMs
    expect(span).toBeGreaterThanOrEqual(2_000)
  })
})
