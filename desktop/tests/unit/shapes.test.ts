import { describe, it, expect, vi } from 'vitest'
import {
  contentBox,
  toNormalized,
  toPixels,
  radiusToPixels,
  radiusToNormalized,
  movedShape,
  drawShapesToCanvas,
  type LineShape,
  type CircleShape
} from '../../src/renderer/src/drawing/shapes'

const line: LineShape = { id: 'l1', kind: 'line', color: '#d6483c', x1: 0.25, y1: 0.5, x2: 0.75, y2: 0.5 }
const circle: CircleShape = { id: 'c1', kind: 'circle', color: '#43b06c', cx: 0.5, cy: 0.5, r: 0.25 }

describe('contentBox', () => {
  it('pillarboxes a 16:9 video in a wider container', () => {
    const box = contentBox({ width: 2000, height: 720 }, { width: 1280, height: 720 })
    expect(box).toEqual({ x: (2000 - 1280) / 2, y: 0, width: 1280, height: 720 })
  })

  it('letterboxes a 16:9 video in a taller container', () => {
    const box = contentBox({ width: 1280, height: 1000 }, { width: 1280, height: 720 })
    expect(box).toEqual({ x: 0, y: 140, width: 1280, height: 720 })
  })

  it('scales down to fit exactly', () => {
    const box = contentBox({ width: 640, height: 360 }, { width: 1280, height: 720 })
    expect(box).toEqual({ x: 0, y: 0, width: 640, height: 360 })
  })

  it('falls back to the container when video dimensions are unknown (0)', () => {
    const box = contentBox({ width: 800, height: 600 }, { width: 0, height: 0 })
    expect(box).toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })
})

describe('coordinate mapping', () => {
  const box = { x: 100, y: 50, width: 800, height: 450 }

  it('round-trips a point', () => {
    const n = toNormalized({ x: 500, y: 275 }, box)
    expect(n).toEqual({ x: 0.5, y: 0.5 })
    expect(toPixels(n, box)).toEqual({ x: 500, y: 275 })
  })

  it('clamps points outside the content box to its edges', () => {
    expect(toNormalized({ x: 0, y: 0 }, box)).toEqual({ x: 0, y: 0 })
    expect(toNormalized({ x: 2000, y: 2000 }, box)).toEqual({ x: 1, y: 1 })
  })

  it('round-trips a circle radius against box height', () => {
    const rPx = radiusToPixels(0.25, box)
    expect(rPx).toBe(112.5)
    expect(radiusToNormalized(rPx, box)).toBe(0.25)
  })
})

describe('movedShape', () => {
  it('moves a line by normalized deltas without mutating the original', () => {
    const moved = movedShape(line, 0.1, -0.2)
    expect(moved).toMatchObject({ x1: 0.35, y1: 0.3, x2: 0.85, y2: 0.3 })
    expect(line.x1).toBe(0.25)
  })

  it('moves a circle center, radius unchanged', () => {
    const moved = movedShape(circle, -0.1, 0.1)
    expect(moved).toMatchObject({ cx: 0.4, cy: 0.6, r: 0.25 })
  })
})

describe('drawShapesToCanvas', () => {
  function mockCtx() {
    return {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      set strokeStyle(v: string) {
        this.strokes.push(v)
      },
      strokes: [] as string[],
      lineWidth: 0,
      lineCap: ''
    }
  }

  it('renders lines and circles at pixel positions inside the box', () => {
    const ctx = mockCtx()
    const box = { x: 0, y: 0, width: 1000, height: 500 }
    drawShapesToCanvas(ctx as unknown as CanvasRenderingContext2D, [line, circle], box, 3)

    expect(ctx.moveTo).toHaveBeenCalledWith(250, 250)
    expect(ctx.lineTo).toHaveBeenCalledWith(750, 250)
    expect(ctx.arc).toHaveBeenCalledWith(500, 250, 125, 0, Math.PI * 2)
    expect(ctx.stroke).toHaveBeenCalledTimes(2)
    expect(ctx.strokes).toEqual(['#d6483c', '#43b06c'])
    expect(ctx.lineWidth).toBe(3)
  })

  it('offsets by the box origin (grid cells in the PiP composite)', () => {
    const ctx = mockCtx()
    const box = { x: 640, y: 360, width: 640, height: 360 }
    drawShapesToCanvas(ctx as unknown as CanvasRenderingContext2D, [circle], box, 3)
    expect(ctx.arc).toHaveBeenCalledWith(640 + 320, 360 + 180, 90, 0, Math.PI * 2)
  })
})
