/**
 * Drawing shapes: pure geometry, coordinate mapping, and a canvas renderer.
 *
 * Shapes are stored in normalized 0–1 coordinates relative to the video
 * IMAGE (its letterboxed content box), so they stick to the picture through
 * window resizes and render identically on live tiles, the replay stage, and
 * the PiP composite. Circle radii normalize against box height so circles
 * stay round regardless of aspect ratio.
 */

import type { DrawnCircle, DrawnLine, DrawnShape } from '@shared/types'

export type LineShape = DrawnLine
export type CircleShape = DrawnCircle
export type Shape = DrawnShape

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** Palette — the app's semantic colors plus white. */
export const SHAPE_COLORS = ['#d6483c', '#d9a13c', '#43b06c', '#e9ede9'] as const

export const STROKE_PX = 3

/** Where a video image actually renders inside a container (object-fit: contain). */
export function contentBox(
  container: { width: number; height: number },
  video: { width: number; height: number }
): Rect {
  if (video.width <= 0 || video.height <= 0) {
    return { x: 0, y: 0, width: container.width, height: container.height }
  }
  const scale = Math.min(container.width / video.width, container.height / video.height)
  const width = video.width * scale
  const height = video.height * scale
  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** Container-relative pixels → normalized content-box coordinates (clamped). */
export function toNormalized(point: Point, box: Rect): Point {
  return {
    x: clamp01((point.x - box.x) / box.width),
    y: clamp01((point.y - box.y) / box.height)
  }
}

export function toPixels(point: Point, box: Rect): Point {
  return { x: box.x + point.x * box.width, y: box.y + point.y * box.height }
}

export function radiusToPixels(r: number, box: Rect): number {
  return r * box.height
}

export function radiusToNormalized(rPx: number, box: Rect): number {
  return rPx / box.height
}

/** Translate a shape by normalized deltas. Pure — returns a new shape. */
export function movedShape<S extends Shape>(shape: S, dx: number, dy: number): S {
  if (shape.kind === 'line') {
    return {
      ...shape,
      x1: clamp01(shape.x1 + dx),
      y1: clamp01(shape.y1 + dy),
      x2: clamp01(shape.x2 + dx),
      y2: clamp01(shape.y2 + dy)
    }
  }
  return { ...shape, cx: clamp01(shape.cx + dx), cy: clamp01(shape.cy + dy) }
}

/** Render shapes into a canvas context — shared by the PiP program bus. */
export function drawShapesToCanvas(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  box: Rect,
  strokePx: number = STROKE_PX
): void {
  ctx.lineWidth = strokePx
  ctx.lineCap = 'round'
  for (const shape of shapes) {
    ctx.strokeStyle = shape.color
    ctx.beginPath()
    if (shape.kind === 'line') {
      const a = toPixels({ x: shape.x1, y: shape.y1 }, box)
      const b = toPixels({ x: shape.x2, y: shape.y2 }, box)
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    } else {
      const center = toPixels({ x: shape.cx, y: shape.cy }, box)
      ctx.arc(center.x, center.y, radiusToPixels(shape.r, box), 0, Math.PI * 2)
    }
    ctx.stroke()
  }
}

export function newShapeId(): string {
  return Math.random().toString(36).slice(2, 10)
}
