/**
 * Pure timing math for two-clip synchronized playback. The DOM-driving loop
 * lives in ComparisonView; everything testable is here.
 *
 * Model: video A is the master. B tracks `A.currentTime + offsetSec`, clamped
 * to B's length. A positive offset means B runs ahead of A.
 */

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Where the slave (B) should be, given the master time and alignment offset. */
export function slaveTargetTime(masterTime: number, offsetSec: number, slaveDuration: number): number {
  return clamp(masterTime + offsetSec, 0, slaveDuration)
}

/** Next/previous frame time, clamped to [0, last frame]. dir = +1 | -1. */
export function stepFrame(time: number, dir: 1 | -1, fps: number, duration: number): number {
  const frame = 1 / fps
  const lastFrame = Math.max(0, duration - frame)
  return clamp(time + dir * frame, 0, lastFrame)
}

/** Shift the alignment offset by one frame. dir = +1 | -1. */
export function nudgeOffsetFrames(offsetSec: number, dir: 1 | -1, fps: number): number {
  return offsetSec + (dir * 1) / fps
}

/**
 * True when the slave has drifted more than `thresholdMs` from its target and
 * should be corrected. When `slaveDuration` is given, the target is clamped
 * first so playback pinned at an end doesn't trigger endless corrections.
 */
export function needsCorrection(
  masterTime: number,
  slaveTime: number,
  offsetSec: number,
  thresholdMs: number,
  slaveDuration = Infinity
): boolean {
  const target = slaveTargetTime(masterTime, offsetSec, slaveDuration)
  return Math.abs(slaveTime - target) * 1000 > thresholdMs
}
