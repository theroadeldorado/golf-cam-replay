import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import type { StoredChunk } from './chunk-ring'

/**
 * Mux a keyframe-aligned slice of encoded H.264 chunks into an MP4.
 * `description` is the avcC decoder config captured from the encoder's first
 * output metadata. Timestamps are rebased so the file starts at zero.
 */
export function muxChunksToMp4(
  chunks: StoredChunk[],
  width: number,
  height: number,
  description: AllowSharedBufferSource | undefined
): ArrayBuffer {
  if (chunks.length === 0 || chunks[0].type !== 'key') {
    throw new Error('mux slice must start with a keyframe')
  }

  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height },
    fastStart: 'in-memory'
  })

  const baseTimestampUs = chunks[0].timestampUs
  chunks.forEach((chunk, index) => {
    muxer.addVideoChunkRaw(
      chunk.data,
      chunk.type,
      chunk.timestampUs - baseTimestampUs,
      chunk.durationUs,
      index === 0 && description ? { decoderConfig: { codec: 'avc', description } } : undefined
    )
  })

  muxer.finalize()
  return target.buffer
}
