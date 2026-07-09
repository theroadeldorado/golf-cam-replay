/**
 * Circular buffer of encoded video chunks with GOP-granular eviction.
 *
 * Invariants:
 *  - The head is always a keyframe, so any slice taken from the ring is
 *    independently decodable.
 *  - A head GOP is evicted only when the *second* keyframe is old enough to
 *    still cover the retention window — the ring never underflows the window.
 *
 * Memory: at ~8 Mbps a 2s+4s+slack window is ~10 MB per camera.
 */

export interface StoredChunk {
  data: Uint8Array
  type: 'key' | 'delta'
  /** Encoder-timeline timestamp (from VideoFrame.timestamp). */
  timestampUs: number
  durationUs: number
  /** performance.now() when the source frame was read — the shared clock
   * that trigger events are expressed in. */
  wallClockMs: number
}

export class ChunkRing {
  private chunks: StoredChunk[] = []
  /** Indexes into `chunks` of every keyframe, ascending. */
  private keyframeIndexes: number[] = []

  constructor(private readonly retentionMs: number) {}

  get size(): number {
    return this.chunks.length
  }

  peekHead(): StoredChunk | null {
    return this.chunks[0] ?? null
  }

  peekTail(): StoredChunk | null {
    return this.chunks[this.chunks.length - 1] ?? null
  }

  push(chunk: StoredChunk): void {
    if (chunk.type === 'key') {
      this.keyframeIndexes.push(this.chunks.length)
    }
    this.chunks.push(chunk)
    this.evict(chunk.wallClockMs)
  }

  /**
   * All chunks from the last keyframe at/before `wallClockMs` to the tail.
   * If `wallClockMs` precedes the buffer, starts at the first keyframe.
   */
  sliceFrom(wallClockMs: number): StoredChunk[] {
    if (this.keyframeIndexes.length === 0) return []
    let startIndex = this.keyframeIndexes[0]
    for (const keyIndex of this.keyframeIndexes) {
      if (this.chunks[keyIndex].wallClockMs <= wallClockMs) {
        startIndex = keyIndex
      } else {
        break
      }
    }
    return this.chunks.slice(startIndex)
  }

  clear(): void {
    this.chunks = []
    this.keyframeIndexes = []
  }

  private evict(newestWallMs: number): void {
    // Drop the head GOP while the SECOND keyframe still covers the window.
    while (
      this.keyframeIndexes.length >= 2 &&
      this.chunks[this.keyframeIndexes[1]].wallClockMs <= newestWallMs - this.retentionMs
    ) {
      const dropCount = this.keyframeIndexes[1]
      this.chunks.splice(0, dropCount)
      this.keyframeIndexes.shift()
      for (let i = 0; i < this.keyframeIndexes.length; i++) {
        this.keyframeIndexes[i] -= dropCount
      }
    }
  }
}
