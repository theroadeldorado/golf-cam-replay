import { describe, it, expect } from 'vitest'
import { VisionTrigger } from '../../src/renderer/src/trigger/vision-trigger'

/**
 * Traces are [energy, ...] sampled at 15fps (66.7ms). Energies are mean abs
 * luma diffs (0–255): quiet scene noise ~0.5–1.5, waggle ~2–4, swing 15–40.
 */
const SAMPLE_MS = 1000 / 15

function makeTrigger(overrides: Partial<ConstructorParameters<typeof VisionTrigger>[0]> = {}) {
  return new VisionTrigger({
    sensitivity: 2,
    stillDurationMs: 700,
    cooldownMs: 6000,
    ...overrides
  })
}

/** Feed a trace; returns the wall-clock times at which the trigger fired. */
function run(trigger: VisionTrigger, energies: number[], startMs = 0): number[] {
  const fired: number[] = []
  energies.forEach((energy, index) => {
    const now = startMs + index * SAMPLE_MS
    const event = trigger.sample(energy, now)
    if (event.fired) fired.push(event.firedAtMs!)
  })
  return fired
}

const quiet = (n: number): number[] => Array.from({ length: n }, (_, i) => 0.8 + 0.4 * ((i * 7) % 3))
const spike = (n: number, level = 25): number[] => Array(n).fill(level)

describe('VisionTrigger', () => {
  it('does not fire while disarmed', () => {
    const trigger = makeTrigger()
    expect(run(trigger, [...quiet(30), ...spike(6)])).toEqual([])
  })

  it('fires on address-stillness followed by a swing spike', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    // 2s of quiet address, then the swing.
    const fired = run(trigger, [...quiet(30), ...spike(6)])
    expect(fired).toHaveLength(1)
    // Fired at the first spike sample (±1 sample for the 2-sample confirmation).
    expect(fired[0]).toBeGreaterThanOrEqual(30 * SAMPLE_MS)
    expect(fired[0]).toBeLessThanOrEqual(32 * SAMPLE_MS)
  })

  it('does not fire on a spike without a preceding still address (walk-through)', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    // Constant moderate motion (someone walking around), then a big spike.
    const walking = Array(30).fill(6)
    expect(run(trigger, [...walking, ...spike(6)])).toEqual([])
  })

  it('ignores a single-sample glitch (camera exposure flicker)', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    const fired = run(trigger, [...quiet(30), 30, ...quiet(20)])
    expect(fired).toEqual([])
  })

  it('respects the cooldown after firing', () => {
    const trigger = makeTrigger({ cooldownMs: 6000 })
    trigger.arm(0)
    const trace = [
      ...quiet(30),
      ...spike(6), // fires (~2s)
      ...quiet(15), // 1s — still inside cooldown
      ...spike(6) // must NOT fire
    ]
    expect(run(trigger, trace)).toHaveLength(1)
  })

  it('re-arms after cooldown and fires again on the next address→swing', () => {
    const trigger = makeTrigger({ cooldownMs: 3000 })
    trigger.arm(0)
    const trace = [
      ...quiet(30),
      ...spike(6), // fire #1
      ...quiet(60), // 4s quiet — cooldown (3s) expires, then re-address
      ...spike(6) // fire #2
    ]
    expect(run(trigger, trace)).toHaveLength(2)
  })

  it('adapts its baseline to a noisier camera (no false fire, still detects swing)', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    // Noisy camera: idle energy ~3 instead of ~1. Swing still spikes to 40.
    const noisyQuiet = Array.from({ length: 60 }, (_, i) => 2.5 + ((i * 3) % 2))
    const fired = run(trigger, [...noisyQuiet, ...spike(6, 40)])
    expect(fired).toHaveLength(1)
  })

  it('waggle at address does not fire, the swing after it does', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    const waggle = [2, 3, 2.5, 3.5, 2, 3, 2.5, 3] // small club movement
    const fired = run(trigger, [...quiet(30), ...waggle, ...quiet(8), ...spike(6)])
    expect(fired).toHaveLength(1)
  })

  it('prolonged moderate motion abandons the address (golfer stepped away)', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    const trace = [
      ...quiet(30), // address established
      ...Array(40).fill(6), // ~2.7s of walking around — address abandoned
      ...spike(6) // spike with no re-established address: no fire
    ]
    expect(run(trigger, trace)).toEqual([])
  })

  it('reports state for the UI meter', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    let event = trigger.sample(1, 0)
    expect(event.state).toBe('watching')
    for (let i = 1; i <= 15; i++) event = trigger.sample(1, i * SAMPLE_MS)
    expect(event.state).toBe('address')
    expect(event.energy).toBe(1)
    expect(event.spikeThreshold).toBeGreaterThan(0)
    trigger.disarm()
    expect(trigger.sample(1, 2000).state).toBe('disarmed')
  })

  it('higher sensitivity fires on softer spikes', () => {
    const gentle = [...quiet(30), ...spike(6, 6)] // soft swing (small ROI / far camera)
    const low = makeTrigger({ sensitivity: 1 })
    low.arm(0)
    expect(run(low, gentle)).toHaveLength(0)

    const high = makeTrigger({ sensitivity: 3 })
    high.arm(0)
    expect(run(high, gentle)).toHaveLength(1)
  })
})
