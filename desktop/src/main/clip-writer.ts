import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { ClipMeta, SaveClipRequest } from '@shared/types'
import { golfDir } from './paths'
import { readClips } from './clip-store'

type Logger = (message: string) => void

function sessionFolderName(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  )
}

/**
 * Write side of clip storage. One session per app run (created lazily on the
 * first clip), same folder/file/clips.json conventions as v1's
 * RecordingManager so both versions can read each other's sessions.
 */
export class ClipWriter {
  private sessionId: string | null = null

  constructor(private readonly log: Logger = () => {}) {}

  get currentSessionId(): string | null {
    return this.sessionId
  }

  private ensureSession(): string {
    if (!this.sessionId || !existsSync(join(golfDir(), this.sessionId))) {
      this.sessionId = sessionFolderName(new Date())
      mkdirSync(join(golfDir(), this.sessionId), { recursive: true })
      this.log(`Started session ${this.sessionId}`)
    }
    return this.sessionId
  }

  saveClip(request: SaveClipRequest): ClipMeta {
    const sessionId = this.ensureSession()
    const folder = join(golfDir(), sessionId)
    const clips = readClips(sessionId)
    const shotName = `shot_${String(clips.length).padStart(4, '0')}`

    const cameraFiles: Record<string, string> = {}
    const cameraLabels: Record<string, string> = {}
    const cameraOffsets: Record<string, number> = {}
    const nominalStartWallMs = request.triggerWallMs - request.preRollMs

    // If the requested primary produced no clip, promote the first camera so
    // meta.file always names a file that exists (mirrors v1's fallback).
    const effectivePrimary = request.cameras.some((c) => c.cameraId === request.primaryCameraId)
      ? request.primaryCameraId
      : request.cameras[0]?.cameraId

    let secondaryIndex = 1
    for (const camera of request.cameras) {
      const isPrimary = camera.cameraId === effectivePrimary
      const fileName = isPrimary ? `${shotName}.mp4` : `${shotName}_cam${secondaryIndex++}.mp4`
      writeFileSync(join(folder, fileName), Buffer.from(camera.mp4))
      cameraFiles[camera.cameraId] = fileName
      cameraLabels[camera.cameraId] = camera.label
      cameraOffsets[camera.cameraId] = Math.round(camera.firstFrameWallMs - nominalStartWallMs)
    }

    const meta: ClipMeta = {
      file: `${shotName}.mp4`,
      timestamp: Date.now() / 1000,
      cameras: request.cameras.length,
      camera_files: cameraFiles,
      camera_labels: cameraLabels,
      v2: {
        trigger: request.trigger,
        preRollMs: request.preRollMs,
        postRollMs: request.postRollMs,
        fps: request.fps,
        cameraOffsets
      }
    }

    if (request.thumbnailJpeg) {
      writeFileSync(join(folder, `${shotName}.jpg`), Buffer.from(request.thumbnailJpeg))
      meta.thumbnail = `${shotName}.jpg`
    }

    clips.push(meta)
    const clipsFile = join(folder, 'clips.json')
    const tempFile = `${clipsFile}.tmp`
    writeFileSync(tempFile, JSON.stringify(clips, null, 2), 'utf-8')
    renameSync(tempFile, clipsFile)

    this.log(`Saved ${shotName} (${request.cameras.length} cameras, ${request.trigger.source})`)
    return meta
  }
}
