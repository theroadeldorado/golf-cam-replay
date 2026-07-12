import { useEffect, useRef } from 'react'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const POSE_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 12],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
  [11, 23], [12, 24],
  [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31],
  [24, 26], [26, 28], [28, 30], [28, 32]
]

function getVideoContentRect(video: HTMLVideoElement): { x: number; y: number; w: number; h: number } {
  const rect = video.getBoundingClientRect()
  const vw = video.videoWidth || 1
  const vh = video.videoHeight || 1
  const videoAspect = vw / vh
  const elemAspect = rect.width / rect.height

  let w: number, h: number, x: number, y: number
  if (elemAspect > videoAspect) {
    h = rect.height
    w = h * videoAspect
    x = (rect.width - w) / 2
    y = 0
  } else {
    w = rect.width
    h = w / videoAspect
    x = 0
    y = (rect.height - h) / 2
  }
  return { x, y, w, h }
}

export function SkeletonOverlay({
  landmarks,
  videoRef,
  mirror = false
}: {
  landmarks: NormalizedLandmark[] | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  mirror?: boolean
}): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = video.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!landmarks || landmarks.length === 0) return

    const { x: ox, y: oy, w, h } = getVideoContentRect(video)
    const px = (lm: NormalizedLandmark): number =>
      mirror ? ox + w - lm.x * w : ox + lm.x * w
    const py = (lm: NormalizedLandmark): number => oy + lm.y * h

    ctx.strokeStyle = 'rgba(67, 176, 108, 0.7)'
    ctx.lineWidth = 2
    for (const [a, b] of POSE_CONNECTIONS) {
      const la = landmarks[a]
      const lb = landmarks[b]
      if (!la || !lb) continue
      if ((la.visibility ?? 0) < 0.3 || (lb.visibility ?? 0) < 0.3) continue
      ctx.beginPath()
      ctx.moveTo(px(la), py(la))
      ctx.lineTo(px(lb), py(lb))
      ctx.stroke()
    }

    for (const lm of landmarks) {
      if ((lm.visibility ?? 0) < 0.3) continue
      ctx.beginPath()
      ctx.arc(px(lm), py(lm), 4, 0, 2 * Math.PI)
      ctx.fillStyle = (lm.visibility ?? 0) >= 0.5 ? '#43b06c' : '#d9a13c'
      ctx.fill()
    }
  }, [landmarks, videoRef, mirror])

  return (
    <canvas
      ref={canvasRef}
      className="skeleton-overlay"
    />
  )
}
