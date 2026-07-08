import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ClipMeta, SessionInfo } from '@shared/types'
import { golfDir } from './paths'

/** Session folders are named with the v1 timestamp convention, e.g. 2026-07-08_14-30-00. */
const SESSION_FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/

/**
 * Read side of session/clip storage. Shares the v1 on-disk format:
 * ~/GolfSwings/{timestamp}/ containing clips.json, MP4s, and JPG thumbnails.
 * The write side (saving new clips) arrives with the capture core.
 */
export function listSessions(): SessionInfo[] {
  const root = golfDir()
  if (!existsSync(root)) return []

  const sessions: SessionInfo[] = []
  for (const name of readdirSync(root)) {
    if (!SESSION_FOLDER_PATTERN.test(name)) continue
    const path = join(root, name)
    try {
      if (!statSync(path).isDirectory()) continue
      sessions.push({
        id: name,
        path,
        clipCount: readClips(name).length,
        createdAt: statSync(path).birthtimeMs
      })
    } catch {
      continue
    }
  }
  return sessions.sort((a, b) => b.id.localeCompare(a.id))
}

export function readClips(sessionId: string): ClipMeta[] {
  const clipsFile = join(golfDir(), sessionId, 'clips.json')
  if (!existsSync(clipsFile)) return []
  try {
    const parsed = JSON.parse(readFileSync(clipsFile, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeClips(sessionId: string, clips: ClipMeta[]): void {
  const clipsFile = join(golfDir(), sessionId, 'clips.json')
  const tempFile = `${clipsFile}.tmp`
  writeFileSync(tempFile, JSON.stringify(clips, null, 2), 'utf-8')
  renameSync(tempFile, clipsFile)
}

export function pinClip(sessionId: string, index: number, pinned: boolean): ClipMeta[] {
  const clips = readClips(sessionId)
  if (clips[index]) {
    clips[index].pinned = pinned
    writeClips(sessionId, clips)
  }
  return clips
}

/** Delete a clip's files and metadata entry — mirrors v1's delete_clip. */
export function deleteClip(sessionId: string, index: number): ClipMeta[] {
  const clips = readClips(sessionId)
  const clip = clips[index]
  if (!clip) return clips
  const folder = join(golfDir(), sessionId)
  for (const fileName of Object.values(clip.camera_files ?? { primary: clip.file })) {
    rmSync(join(folder, fileName), { force: true })
  }
  if (clip.thumbnail) rmSync(join(folder, clip.thumbnail), { force: true })
  clips.splice(index, 1)
  writeClips(sessionId, clips)
  return clips
}
