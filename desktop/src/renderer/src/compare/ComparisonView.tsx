import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipMeta } from '@shared/types'
import { needsCorrection, nudgeOffsetFrames, slaveTargetTime, stepFrame } from './sync-engine'

export interface CompareClip {
  sessionId: string
  clip: ClipMeta
}

const SPEEDS = [0.25, 0.5, 1] as const
const DRIFT_THRESHOLD_MS = 50

function clipLabel(ref: CompareClip): string {
  const shot = ref.clip.file.match(/shot_(\d+)/)?.[1] ?? ''
  return `Shot ${shot} · ${ref.sessionId.replace('_', ' ')}`
}

function fpsOf(ref: CompareClip): number {
  return ref.clip.v2?.fps ?? 30
}

/**
 * Full-stage two-clip comparison. Video A (left) is the master; B (right)
 * tracks A + an alignment offset, corrected each frame. All controls act on
 * both clips together.
 */
export function ComparisonView({
  a,
  b,
  onSwap,
  onExit
}: {
  a: CompareClip
  b: CompareClip
  onSwap: () => void
  onExit: () => void
}): React.JSX.Element {
  const videoA = useRef<HTMLVideoElement>(null)
  const videoB = useRef<HTMLVideoElement>(null)
  const [urls, setUrls] = useState<{ a: string; b: string } | null>(null)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(0.5)
  const [offsetSec, setOffsetSec] = useState(0)
  const [progress, setProgress] = useState(0)
  const offsetRef = useRef(0)
  offsetRef.current = offsetSec

  // Load both clips as blobs (same path as gallery playback).
  useEffect(() => {
    let revoked = false
    let made: { a: string; b: string } | null = null
    void (async () => {
      const [bytesA, bytesB] = await Promise.all([
        window.api.invoke('clip:read', a.sessionId, a.clip.file),
        window.api.invoke('clip:read', b.sessionId, b.clip.file)
      ])
      if (revoked) return
      made = {
        a: URL.createObjectURL(new Blob([bytesA], { type: 'video/mp4' })),
        b: URL.createObjectURL(new Blob([bytesB], { type: 'video/mp4' }))
      }
      setUrls(made)
    })()
    return () => {
      revoked = true
      if (made) {
        URL.revokeObjectURL(made.a)
        URL.revokeObjectURL(made.b)
      }
    }
  }, [a, b])

  // Drift-correction + progress loop: B chases A + offset.
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const va = videoA.current
      const vb = videoB.current
      if (va && vb && vb.duration) {
        if (needsCorrection(va.currentTime, vb.currentTime, offsetRef.current, DRIFT_THRESHOLD_MS, vb.duration)) {
          vb.currentTime = slaveTargetTime(va.currentTime, offsetRef.current, vb.duration)
        }
        if (va.duration) setProgress(va.currentTime / va.duration)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Apply play/pause + speed to both.
  useEffect(() => {
    const va = videoA.current
    const vb = videoB.current
    if (!va || !vb) return
    va.playbackRate = speed
    vb.playbackRate = speed
    if (playing) {
      void va.play().catch(() => {})
      void vb.play().catch(() => {})
    } else {
      va.pause()
      vb.pause()
    }
  }, [playing, speed, urls])

  const seekBoth = useCallback((masterTime: number) => {
    const va = videoA.current
    const vb = videoB.current
    if (!va || !vb) return
    va.currentTime = masterTime
    vb.currentTime = slaveTargetTime(masterTime, offsetRef.current, vb.duration || 0)
  }, [])

  const onScrub = useCallback(
    (fraction: number) => {
      const va = videoA.current
      if (!va || !va.duration) return
      seekBoth(fraction * va.duration)
    },
    [seekBoth]
  )

  const frameStep = useCallback(
    (dir: 1 | -1) => {
      const va = videoA.current
      if (!va) return
      setPlaying(false)
      seekBoth(stepFrame(va.currentTime, dir, fpsOf(a), va.duration || 0))
    },
    [a, seekBoth]
  )

  const nudgeOffset = useCallback(
    (dir: 1 | -1) => {
      const next = nudgeOffsetFrames(offsetRef.current, dir, fpsOf(b))
      setOffsetSec(next)
      const va = videoA.current
      const vb = videoB.current
      if (va && vb) vb.currentTime = slaveTargetTime(va.currentTime, next, vb.duration || 0)
    },
    [b]
  )

  const offsetFrames = Math.round(offsetSec * fpsOf(b))

  return (
    <div className="compare-view">
      <div className="compare-panes">
        {(['a', 'b'] as const).map((side) => {
          const ref = side === 'a' ? a : b
          return (
            <div className="compare-pane" key={side}>
              <video
                ref={side === 'a' ? videoA : videoB}
                data-testid={`compare-video-${side}`}
                src={urls?.[side]}
                muted
                playsInline
                loop
              />
              <span className="compare-label">
                {side === 'a' ? 'A' : 'B'} — {clipLabel(ref)}
              </span>
            </div>
          )
        })}
      </div>

      <div className="compare-controls">
        <button data-testid="compare-playpause" onClick={() => setPlaying((p) => !p)}>
          {playing ? '⏸' : '▶'}
        </button>
        <button title="Previous frame" onClick={() => frameStep(-1)}>
          ◀▮
        </button>
        <button title="Next frame" onClick={() => frameStep(1)}>
          ▮▶
        </button>

        <input
          className="compare-scrub"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress}
          onChange={(e) => onScrub(Number(e.target.value))}
        />

        <div className="compare-speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={speed === s ? 'on' : ''}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="compare-offset" title="Shift B relative to A">
          <button data-testid="offset-minus" onClick={() => nudgeOffset(-1)}>
            −
          </button>
          <span data-testid="offset-value">
            B {offsetFrames >= 0 ? '+' : ''}
            {offsetFrames}f
          </span>
          <button data-testid="offset-plus" onClick={() => nudgeOffset(1)}>
            ＋
          </button>
        </div>

        <button onClick={onSwap}>Swap A↔B</button>
        <button data-testid="compare-exit" onClick={onExit}>
          Back to live
        </button>
      </div>
    </div>
  )
}
