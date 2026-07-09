import { useCallback, useEffect, useRef, useState } from 'react'
import {
  contentBox,
  toNormalized,
  toPixels,
  radiusToPixels,
  radiusToNormalized,
  movedShape,
  newShapeId,
  STROKE_PX,
  type Point,
  type Rect,
  type Shape
} from './shapes'

export type DrawTool = 'select' | 'line' | 'circle'

interface DragState {
  kind: 'create' | 'move' | 'handle'
  shapeId: string
  handle?: 'p1' | 'p2' | 'r'
  /** Last pointer position in normalized coords (for move deltas). */
  last: Point
  moved: boolean
}

/**
 * Transparent SVG editing layer over a <video>. Inactive → pointer-events
 * none (pure display). Active → draw/select/edit with the current tool.
 * All persistence goes through onChange; commit=true fires at gesture end.
 */
export function DrawingOverlay({
  shapes,
  active,
  tool,
  color,
  videoRef,
  selectedId,
  onSelect,
  onChange
}: {
  shapes: Shape[]
  active: boolean
  tool: DrawTool
  color: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (shapes: Shape[], commit: boolean) => void
}): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [, forceRender] = useState(0)

  // Re-render when the container resizes or the video learns its dimensions.
  useEffect(() => {
    const svg = svgRef.current
    const video = videoRef.current
    if (!svg) return
    const bump = (): void => forceRender((n) => n + 1)
    const observer = new ResizeObserver(bump)
    observer.observe(svg)
    video?.addEventListener('loadedmetadata', bump)
    return () => {
      observer.disconnect()
      video?.removeEventListener('loadedmetadata', bump)
    }
  }, [videoRef])

  const getBox = useCallback((): Rect => {
    const svg = svgRef.current
    const video = videoRef.current
    const width = svg?.clientWidth ?? 0
    const height = svg?.clientHeight ?? 0
    return contentBox(
      { width, height },
      { width: video?.videoWidth ?? 0, height: video?.videoHeight ?? 0 }
    )
  }, [videoRef])

  const pointerPoint = useCallback(
    (event: React.PointerEvent): Point => {
      const rect = svgRef.current!.getBoundingClientRect()
      return toNormalized({ x: event.clientX - rect.left, y: event.clientY - rect.top }, getBox())
    },
    [getBox]
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!active) return
      event.preventDefault()
      svgRef.current!.setPointerCapture(event.pointerId)
      const point = pointerPoint(event)
      const target = event.target as SVGElement
      const hitShapeId = target.getAttribute('data-shape-id')
      const handle = target.getAttribute('data-handle') as DragState['handle'] | null

      if (tool === 'select') {
        if (handle && selectedId) {
          dragRef.current = { kind: 'handle', shapeId: selectedId, handle, last: point, moved: false }
        } else if (hitShapeId) {
          onSelect(hitShapeId)
          dragRef.current = { kind: 'move', shapeId: hitShapeId, last: point, moved: false }
        } else {
          onSelect(null)
        }
        return
      }

      // Creation tools: seed a zero-size shape and grow it during the drag.
      const id = newShapeId()
      const shape: Shape =
        tool === 'line'
          ? { id, kind: 'line', color, x1: point.x, y1: point.y, x2: point.x, y2: point.y }
          : { id, kind: 'circle', color, cx: point.x, cy: point.y, r: 0 }
      onChange([...shapes, shape], false)
      dragRef.current = { kind: 'create', shapeId: id, last: point, moved: false }
    },
    [active, tool, color, shapes, selectedId, pointerPoint, onSelect, onChange]
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const point = pointerPoint(event)
      const box = getBox()
      drag.moved = true

      const updated = shapes.map((shape) => {
        if (shape.id !== drag.shapeId) return shape
        if (drag.kind === 'move') {
          return movedShape(shape, point.x - drag.last.x, point.y - drag.last.y)
        }
        if (shape.kind === 'line') {
          const handle = drag.kind === 'create' ? 'p2' : drag.handle
          return handle === 'p1'
            ? { ...shape, x1: point.x, y1: point.y }
            : { ...shape, x2: point.x, y2: point.y }
        }
        // Circle: creating or dragging the radius handle resizes from center.
        const centerPx = toPixels({ x: shape.cx, y: shape.cy }, box)
        const pointPx = toPixels(point, box)
        const rPx = Math.hypot(pointPx.x - centerPx.x, pointPx.y - centerPx.y)
        return { ...shape, r: radiusToNormalized(rPx, box) }
      })
      drag.last = point
      onChange(updated, false)
    },
    [shapes, pointerPoint, getBox, onChange]
  )

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return

    // Discard accidental zero-size creations (a stray click with a draw tool).
    if (drag.kind === 'create') {
      const shape = shapes.find((s) => s.id === drag.shapeId)
      const tooSmall =
        !shape ||
        (shape.kind === 'line'
          ? Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) < 0.01
          : shape.r < 0.01)
      if (tooSmall) {
        onChange(
          shapes.filter((s) => s.id !== drag.shapeId),
          true
        )
        return
      }
      onSelect(drag.shapeId)
    }
    onChange(shapes, true)
  }, [shapes, onChange, onSelect])

  const box = getBox()

  return (
    <svg
      ref={svgRef}
      className="drawing-overlay"
      data-active={active}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: active ? 'auto' : 'none',
        cursor: tool === 'select' ? 'default' : 'crosshair',
        touchAction: 'none'
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {shapes.map((shape) => {
        const isSelected = shape.id === selectedId
        if (shape.kind === 'line') {
          const a = toPixels({ x: shape.x1, y: shape.y1 }, box)
          const b = toPixels({ x: shape.x2, y: shape.y2 }, box)
          return (
            <g key={shape.id}>
              {/* Fat invisible stroke so thin lines are easy to grab. */}
              <line
                data-shape-id={shape.id}
                data-testid="drawn-line"
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={14}
                style={{ pointerEvents: active && tool === 'select' ? 'stroke' : 'none' }}
              />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={shape.color}
                strokeWidth={STROKE_PX}
                strokeLinecap="round"
                pointerEvents="none"
              />
              {isSelected && (
                <>
                  <Handle x={a.x} y={a.y} handle="p1" />
                  <Handle x={b.x} y={b.y} handle="p2" />
                </>
              )}
            </g>
          )
        }
        const center = toPixels({ x: shape.cx, y: shape.cy }, box)
        const rPx = radiusToPixels(shape.r, box)
        return (
          <g key={shape.id}>
            <circle
              data-shape-id={shape.id}
              data-testid="drawn-circle"
              cx={center.x}
              cy={center.y}
              r={rPx}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              style={{ pointerEvents: active && tool === 'select' ? 'stroke' : 'none' }}
            />
            <circle
              cx={center.x}
              cy={center.y}
              r={rPx}
              fill="none"
              stroke={shape.color}
              strokeWidth={STROKE_PX}
              pointerEvents="none"
            />
            {isSelected && <Handle x={center.x + rPx} y={center.y} handle="r" />}
          </g>
        )
      })}
    </svg>
  )
}

function Handle({ x, y, handle }: { x: number; y: number; handle: string }): React.JSX.Element {
  return (
    <circle
      data-handle={handle}
      data-testid={`handle-${handle}`}
      cx={x}
      cy={y}
      r={7}
      fill="#0b0d0c"
      stroke="#e9ede9"
      strokeWidth={2}
      style={{ cursor: 'grab', pointerEvents: 'all' }}
    />
  )
}
