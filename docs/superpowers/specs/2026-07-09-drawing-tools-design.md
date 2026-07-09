# Drawing Tools — Design

**Date:** 2026-07-09 · **Status:** approved by John

Per-camera screen-overlay annotations for ReplaySwing v2 (the first v1
fast-follow). Lines and circles, four colors, constant stroke width,
handle-based editing, no separate rotate mode.

## Data model

Shapes are stored in settings, keyed by camera id, in normalized 0–1
coordinates relative to the **video image content box** (not the window), so
they track the picture through resizes:

```ts
type Shape =
  | { id: string; kind: 'line'; color: string; x1: number; y1: number; x2: number; y2: number }
  | { id: string; kind: 'circle'; color: string; cx: number; cy: number; r: number }

Settings.drawings: Record<string /* cameraId */, Shape[]>
```

- Circle `r` is normalized against frame **height** (circles stay round).
- Colors: the app palette — red `#d6483c`, amber `#d9a13c`, green `#43b06c`,
  white `#e9ede9`.
- Stroke: constant 3px in screen space at any window size; the PiP canvas
  uses the equivalent at its 1280×720 resolution.
- Persistence: existing atomic settings store (`settings.v2.json`), saved on
  gesture end (pointer up), not per-move.
- Removing a camera deletes its shape list.

## Interaction

- A pencil button on the stage toggles **draw mode**. Off → the overlay has
  `pointer-events: none` and cannot interfere with the app. On → a small
  toolbar appears: Select / Line / Circle tools, four swatches, delete.
- **Line**: drag start→end. **Circle**: drag outward from center.
- **Select**: click a shape → handles. Line: drag either endpoint (covers
  move/rescale/rotate in one gesture — no rotate gizmo by design) or drag the
  body to move. Circle: drag body/center to move, one edge handle to resize.
- Swatch click with a selection recolors it. `Delete`/`Backspace` removes the
  selection. `Esc` exits draw mode and takes priority over dismissing the
  replay while draw mode is active.
- New shapes take the active color.

## Rendering surfaces

One shape list per camera, three places it renders:

1. **Live camera tiles** — each tile hosts an overlay bound to its camera id.
2. **Replay stage** — bound to the camera whose clip is playing (primary
   camera for instant replays; reverse lookup via `camera_files` for gallery
   playback). Editable here too — drawing on a looping swing is the main use.
3. **PiP** — the program bus burns each camera's shapes into that camera's
   cell of the composite (and over the replay when replaying).

## Structure

- `renderer/src/drawing/shapes.ts` — pure: types, normalize/denormalize
  mapping (letterbox content-box math), shape geometry ops, and a
  canvas-context renderer shared with the program bus. Unit-tested.
- `renderer/src/drawing/DrawingOverlay.tsx` — the SVG layer: tools, handles,
  pointer logic. Emits `onChange(shapes)`.
- `renderer/src/drawing/DrawToolbar.tsx` — tool/color/delete UI.
- `App.tsx` wires overlays to tiles + replay stage and persists via
  `settings:set`; `program-bus.ts` calls the canvas renderer per cell.

## Testing

- vitest: content-box mapping both directions (letterboxed wide/tall cases),
  circle roundness across aspect ratios, shape move/resize ops.
- Playwright E2E: enable draw mode on the fake camera, drag a line (SVG line
  appears), drag an endpoint, recolor, delete, and assert shapes persist into
  `settings.v2.json`.
