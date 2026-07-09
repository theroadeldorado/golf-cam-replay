# Swing Comparison — Design

**Date:** 2026-07-09 · **Status:** approved by John

Side-by-side synchronized playback of two clips — the last v1 fast-follow.

## Entering & picking

_(Revised after live feedback: a self-contained modal with per-pane dropdowns
replaced the original rail pick-mode, which felt awkward. Swap A↔B removed.)_

- **Compare** button in the top toolbar opens a modal popup, decoupled from
  the main stage. The app is dimmed behind a scrim; Close or Esc dismisses it.
- Each pane has a **dropdown** listing every clip across all sessions
  (`{session date} · Shot N`), so you pick and switch A and B freely. Opens
  defaulted to the two most recent clips. Fewer than two clips → a hint.

## Comparison view

- Two videos side by side inside the modal: left = A, right = B, each with its
  dropdown above it.
- Both clips load as in-memory blobs via the existing `clip:read` IPC; the
  App flattens `session:list` × `session:clips` into the dropdown options.

## Synced playback + alignment

- One shared timeline. Video **A is master**; B follows at
  `A.currentTime + offsetSec`, clamped to `[0, B.duration]`.
- Controls: play/pause, shared scrubber, speed (0.25× / 0.5× / 1×), frame
  step (◀ ▮ ▶, pause + nudge both one frame), **alignment offset** (−/＋ shift
  B relative to A by one frame, current offset shown), close.
- Smoothness: both videos `play()` natively at the chosen `playbackRate`; a
  per-frame drift-correction loop nudges B back onto `A + offset` when
  `|B − (A+offset)| > 50ms`. Both loop; when A wraps to 0, B follows.
- fps for frame math comes from clip metadata (`v2.fps`), default 30.

## Structure

- `renderer/src/compare/sync-engine.ts` — pure math, unit-tested:
  - `slaveTargetTime(masterTime, offsetSec, slaveDuration)` → clamped.
  - `stepFrame(time, dir, fps, duration)` → clamped next/prev frame time.
  - `nudgeOffsetFrames(offsetSec, dir, fps)` → new offset.
  - `needsCorrection(masterTime, slaveTime, offsetSec, thresholdMs)` → bool.
- `renderer/src/compare/ComparisonView.tsx` — full-stage UI, two `<video>`s,
  drift loop, controls.
- `App.tsx` — Compare button, pick-mode state (`comparePick`), rail-click
  routing to A/B, and the open comparison `{ a, b }`.

## Out of scope

- Drawings do not render in the comparison view (overlays are per-camera;
  layering two panes is deferred). Annotation stays on the single-clip replay.

## Testing

- **vitest** (`sync-engine.test.ts`): slave clamp at both ends and mid-range;
  frame step forward/back with clamping; offset nudge; correction threshold.
- **Playwright E2E**: enter compare, pick two shots (incl. one from the
  gallery), assert both videos load (`videoWidth > 0`) and advance while
  playing, and that a `＋` offset nudge shifts B's time relative to A.
