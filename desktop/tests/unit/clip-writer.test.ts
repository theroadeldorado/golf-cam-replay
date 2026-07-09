import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClipWriter } from '../../src/main/clip-writer'
import type { SaveClipRequest } from '@shared/types'

function makeRequest(overrides: Partial<SaveClipRequest> = {}): SaveClipRequest {
  return {
    cameras: [
      { cameraId: 'cam-a', label: 'Face On', mp4: new Uint8Array([1, 2, 3]).buffer, firstFrameWallMs: 980 },
      { cameraId: 'cam-b', label: 'Down Line', mp4: new Uint8Array([4, 5]).buffer, firstFrameWallMs: 1010 }
    ],
    primaryCameraId: 'cam-a',
    thumbnailJpeg: new Uint8Array([9, 9]).buffer,
    triggerWallMs: 3000,
    trigger: { source: 'manual' },
    preRollMs: 2000,
    postRollMs: 4000,
    fps: 30,
    ...overrides
  }
}

describe('ClipWriter', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rs-clips-'))
    process.env['REPLAYSWING_DATA_DIR'] = dir
  })

  afterEach(() => {
    delete process.env['REPLAYSWING_DATA_DIR']
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates a v1-style session folder lazily and writes shot files', () => {
    const writer = new ClipWriter()
    expect(writer.currentSessionId).toBeNull()

    const meta = writer.saveClip(makeRequest())

    const sessionId = writer.currentSessionId!
    expect(sessionId).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/)
    const files = readdirSync(join(dir, sessionId)).sort()
    expect(files).toEqual(['clips.json', 'shot_0000.jpg', 'shot_0000.mp4', 'shot_0000_cam1.mp4'])
    expect(meta.file).toBe('shot_0000.mp4')
    expect(meta.thumbnail).toBe('shot_0000.jpg')
  })

  it('writes v1-compatible clips.json with a v2 extension block', () => {
    const writer = new ClipWriter()
    writer.saveClip(makeRequest())

    const clips = JSON.parse(
      readFileSync(join(dir, writer.currentSessionId!, 'clips.json'), 'utf-8')
    )
    expect(clips).toHaveLength(1)
    const clip = clips[0]
    // v1 reader contract (app/recording.py):
    expect(clip.file).toBe('shot_0000.mp4')
    expect(clip.cameras).toBe(2)
    expect(clip.camera_files['cam-a']).toBe('shot_0000.mp4')
    expect(clip.camera_files['cam-b']).toBe('shot_0000_cam1.mp4')
    expect(clip.camera_labels['cam-b']).toBe('Down Line')
    expect(typeof clip.timestamp).toBe('number')
    // v2 extension:
    expect(clip.v2.trigger.source).toBe('manual')
    expect(clip.v2.cameraOffsets['cam-a']).toBe(-20) // 980 − (3000 − 2000)
    expect(clip.v2.cameraOffsets['cam-b']).toBe(10)
  })

  it('numbers shots sequentially within a session', () => {
    const writer = new ClipWriter()
    writer.saveClip(makeRequest())
    const meta = writer.saveClip(makeRequest())
    expect(meta.file).toBe('shot_0001.mp4')
    const files = readdirSync(join(dir, writer.currentSessionId!))
    expect(files).toContain('shot_0001_cam1.mp4')
  })

  it('promotes the first camera when the requested primary produced no clip', () => {
    const writer = new ClipWriter()
    const request = makeRequest({ primaryCameraId: 'cam-gone' })
    const meta = writer.saveClip(request)
    expect(meta.cameras).toBe(2)
    // meta.file must always name a file that exists.
    expect(existsSync(join(dir, writer.currentSessionId!, meta.file))).toBe(true)
    expect(meta.camera_files['cam-a']).toBe('shot_0000.mp4')
    expect(meta.camera_files['cam-b']).toBe('shot_0000_cam1.mp4')
  })

  it('omits thumbnail when none was captured', () => {
    const writer = new ClipWriter()
    const meta = writer.saveClip(makeRequest({ thumbnailJpeg: null }))
    expect(meta.thumbnail).toBeUndefined()
  })
})
