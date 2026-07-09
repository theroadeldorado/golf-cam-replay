import { describe, it, expect } from 'vitest'
import {
  slaveTargetTime,
  stepFrame,
  nudgeOffsetFrames,
  needsCorrection
} from '../../src/renderer/src/compare/sync-engine'

describe('slaveTargetTime', () => {
  it('follows the master by the offset in the normal range', () => {
    expect(slaveTargetTime(2.0, 0.5, 6)).toBeCloseTo(2.5)
    expect(slaveTargetTime(2.0, -0.5, 6)).toBeCloseTo(1.5)
  })

  it('clamps to 0 when the offset pushes before the start', () => {
    expect(slaveTargetTime(0.2, -1.0, 6)).toBe(0)
  })

  it('clamps to the slave duration at the end', () => {
    expect(slaveTargetTime(5.9, 1.0, 6)).toBe(6)
  })
})

describe('stepFrame', () => {
  const fps = 30
  it('advances one frame forward', () => {
    expect(stepFrame(1.0, 1, fps, 6)).toBeCloseTo(1 + 1 / 30)
  })

  it('steps one frame back', () => {
    expect(stepFrame(1.0, -1, fps, 6)).toBeCloseTo(1 - 1 / 30)
  })

  it('does not step before 0', () => {
    expect(stepFrame(0.01, -1, fps, 6)).toBe(0)
  })

  it('does not step past the last frame', () => {
    const last = 6 - 1 / 30
    expect(stepFrame(6, 1, fps, 6)).toBeCloseTo(last)
  })
})

describe('nudgeOffsetFrames', () => {
  it('adds and subtracts one frame of offset', () => {
    expect(nudgeOffsetFrames(0, 1, 30)).toBeCloseTo(1 / 30)
    expect(nudgeOffsetFrames(1 / 30, -1, 30)).toBeCloseTo(0)
  })

  it('accumulates across nudges', () => {
    let offset = 0
    for (let i = 0; i < 5; i++) offset = nudgeOffsetFrames(offset, 1, 30)
    expect(offset).toBeCloseTo(5 / 30)
  })
})

describe('needsCorrection', () => {
  it('is false when the slave is within threshold of its target', () => {
    // target = 2.0 + 0.5 = 2.5; slave at 2.52 → 20ms drift, under 50ms
    expect(needsCorrection(2.0, 2.52, 0.5, 50)).toBe(false)
  })

  it('is true when drift exceeds the threshold', () => {
    // target 2.5; slave at 2.6 → 100ms drift
    expect(needsCorrection(2.0, 2.6, 0.5, 50)).toBe(true)
  })

  it('accounts for clamping at the ends (no false correction)', () => {
    // master 5.9 + offset 1.0 → clamped target 6.0; slave already at 6.0
    expect(needsCorrection(5.9, 6.0, 1.0, 50, 6)).toBe(false)
  })
})
