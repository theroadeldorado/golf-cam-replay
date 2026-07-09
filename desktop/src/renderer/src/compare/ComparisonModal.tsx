import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipMeta } from '@shared/types'
import { needsCorrection, nudgeOffsetFrames, slaveTargetTime, stepFrame } from './sync-engine'

export interface CompareOption {
  sessionId: string
  clip: ClipMeta
  label: string
}

const SPEEDS = [0.25, 0.5, 1] as const
const DRIFT_THRESHOLD_MS = 50

function fpsOf(option: CompareOption | null): number {
  return option?.clip.v2?.fps ?? 30
}

/** Load a clip as an object URL, revoking the previous one. */
function useClipUrl(option: CompareOption | null): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!option) {
      setUrl(undefined)
      return
    }
    let made: string | null = null
    let cancelled = false
    void window.api.invoke('clip:read', option.sessionId, option.clip.file).then((bytes) => {
      if (cancelled) return
      made = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
      setUrl(made)
    })
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [option])
  return url
}

/**
 * Self-contained comparison popup: a dropdown over each pane picks the clip.
 * Left pane (A) is the master; right (B) tracks A + an alignment offset,
 * drift-corrected each frame. Nothing here touches the rest of the app.
 */
export function ComparisonModal({
  options,
  onClose
}: {
  options: CompareOption[]
  onClose: () => void
}): React.JSX.Element {
  // Default to the two most recent clips.
  const [indexA, setIndexA] = useState(options.length > 1 ? 1 : 0)
  const [indexB, setIndexB] = useState(0)
  const optionA = options[indexA] ?? null
  const optionB = options[indexB] ?? null
  const urlA = useClipUrl(optionA)
  const urlB = useClipUrl(optionB)

  const videoA = useRef<HTMLVideoElement>(null)
  const videoB = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(0.5)
  const [offsetSec, setOffsetSec] = useState(0)
  const [progress, setProgress] = useState(0)
  const offsetRef = useRef(0)
  offsetRef.current = offsetSec

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
  }, [playing, speed, urlA, urlB])

  // Esc closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
      seekBoth(stepFrame(va.currentTime, dir, fpsOf(optionA), va.duration || 0))
    },
    [optionA, seekBoth]
  )

  const nudgeOffset = useCallback(
    (dir: 1 | -1) => {
      const next = nudgeOffsetFrames(offsetRef.current, dir, fpsOf(optionB))
      setOffsetSec(next)
      const va = videoA.current
      const vb = videoB.current
      if (va && vb) vb.currentTime = slaveTargetTime(va.currentTime, next, vb.duration || 0)
    },
    [optionB]
  )

  const offsetFrames = Math.round(offsetSec * fpsOf(optionB))

  const pane = (
    side: 'a' | 'b',
    index: number,
    setIndex: (n: number) => void,
    url: string | undefined,
    ref: React.RefObject<HTMLVideoElement | null>
  ): React.JSX.Element => (
    <div className="compare-pane">
      <select
        className="compare-select"
        data-testid={`compare-select-${side}`}
        value={index}
        onChange={(e) => setIndex(Number(e.target.value))}
      >
        {options.map((option, i) => (
          <option key={`${option.sessionId}/${option.clip.file}`} value={i}>
            {side === 'a' ? 'A' : 'B'} · {option.label}
          </option>
        ))}
      </select>
      <div className="compare-video-wrap">
        <video ref={ref} data-testid={`compare-video-${side}`} src={url} muted playsInline loop />
      </div>
    </div>
  )

  return (
    <div className="scrim" onClick={onClose}>
      <div className="compare-modal" onClick={(e) => e.stopPropagation()}>
        <div className="compare-modal-head">
          <h2>Compare swings</h2>
          <button data-testid="compare-close" onClick={onClose}>
            Close
          </button>
        </div>

        {options.length < 2 ? (
          <p className="hint" style={{ padding: '40px 0', textAlign: 'center' }}>
            Record at least two shots to compare.
          </p>
        ) : (
          <>
            <div className="compare-panes">
              {pane('a', indexA, setIndexA, urlA, videoA)}
              {pane('b', indexB, setIndexB, urlB, videoB)}
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
                  <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
                    {s}×
                  </button>
                ))}
              </div>

              <div className="compare-offset" title="Shift B relative to A to line up the swings">
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
            </div>
          </>
        )}
      </div>
    </div>
  )
}
