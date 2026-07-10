import { describe, it, expect } from 'vitest'
import { VisionTrigger } from '../../src/renderer/src/trigger/vision-trigger'

/**
 * Traces are [energy, ...] sampled at 15fps (66.7ms). Energies are mean abs
 * luma diffs (0–255): quiet scene noise ~0.5–1.5, waggle ~2–4, swing 15–40.
 *
 * A real swing is a brief burst that *settles*, so swing traces end with
 * trailing quiet() — the shape filter fires when the burst subsides. A trace
 * that ends mid-burst never settles and (correctly) never fires.
 */
const SAMPLE_MS = 1000 / 15

function makeTrigger(overrides: Partial<ConstructorParameters<typeof VisionTrigger>[0]> = {}) {
  return new VisionTrigger({
    sensitivity: 2,
    stillDurationMs: 1000,
    cooldownMs: 6000,
    ...overrides
  })
}

interface RunOpts {
  startMs?: number
  /** Presence per sample (array) or for all samples (boolean). Defaults true. */
  present?: boolean | boolean[]
}

/** Feed a trace; returns the wall-clock times at which the trigger fired. */
function run(trigger: VisionTrigger, energies: number[], opts: RunOpts = {}): number[] {
  const { startMs = 0, present = true } = opts
  const fired: number[] = []
  energies.forEach((energy, index) => {
    const now = startMs + index * SAMPLE_MS
    const p = Array.isArray(present) ? (present[index] ?? true) : present
    const event = trigger.sample(energy, now, p)
    if (event.fired) fired.push(event.firedAtMs!)
  })
  return fired
}

const quiet = (n: number): number[] => Array.from({ length: n }, (_, i) => 0.8 + 0.4 * ((i * 7) % 3))
const spike = (n: number, level = 25): number[] => Array(n).fill(level)
/** A swing: a brief violent burst that then settles. */
const swing = (level = 25): number[] => [...spike(4, level), ...quiet(12)]

describe('VisionTrigger', () => {
  it('does not fire while disarmed', () => {
    const trigger = makeTrigger()
    expect(run(trigger, [...quiet(30), ...swing()])).toEqual([])
  })

  it('fires on address-stillness followed by a swing (brief burst that settles)', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    const fired = run(trigger, [...quiet(30), ...swing()])
    expect(fired).toHaveLength(1)
    // Fired-at is the FIRST spike sample (impact estimate), at ~sample 30.
    expect(fired[0]).toBeGreaterThanOrEqual(30 * SAMPLE_MS)
    expect(fired[0]).toBeLessThanOrEqual(31 * SAMPLE_MS)
  })

  it('does NOT fire on sustained motion after address (walking in — never settles)', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    // Address, then 15 samples (~1s) of continuous high motion, no settle.
    expect(run(trigger, [...quiet(30), ...spike(15)])).toEqual([])
  })

  it('does not fire on a spike without a preceding still address (walk-through)', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    const walking = Array(30).fill(6)
    expect(run(trigger, [...walking, ...swing()])).toEqual([])
  })

  it('ignores a single-sample glitch (camera exposure flicker)', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    expect(run(trigger, [...quiet(30), 30, ...quiet(20)])).toEqual([])
  })

  it('respects the cooldown after firing', () => {
    const trigger = makeTrigger({ cooldownMs: 6000 })
    trigger.arm(0)
    const trace = [
      ...quiet(30),
      ...swing(), // fires (~2s)
      ...swing() // ~1s later — still inside the 6s cooldown, must NOT fire
    ]
    expect(run(trigger, trace)).toHaveLength(1)
  })

  it('re-arms after cooldown and fires again on the next address→swing', () => {
    const trigger = makeTrigger({ cooldownMs: 3000 })
    trigger.arm(0)
    const trace = [
      ...quiet(30),
      ...swing(), // fire #1
      ...quiet(75), // 5s quiet — cooldown (3s) expires, then re-address
      ...swing() // fire #2
    ]
    expect(run(trigger, trace)).toHaveLength(2)
  })

  it('adapts its baseline to a noisier camera (no false fire, still detects swing)', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    const noisyQuiet = Array.from({ length: 60 }, (_, i) => 2.5 + ((i * 3) % 2))
    const fired = run(trigger, [...noisyQuiet, ...swing(40)])
    expect(fired).toHaveLength(1)
  })

  it('waggle at address does not fire, the swing after it does', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    const waggle = [2, 3, 2.5, 3.5, 2, 3, 2.5, 3]
    const fired = run(trigger, [...quiet(30), ...waggle, ...quiet(8), ...swing()])
    expect(fired).toHaveLength(1)
  })

  it('prolonged moderate motion abandons the address (golfer stepped away)', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    const trace = [
      ...quiet(30), // address established
      ...Array(40).fill(6), // ~2.7s of walking around — address abandoned
      ...swing() // no re-established address: no fire
    ]
    expect(run(trigger, trace)).toEqual([])
  })

  // ---- Presence gating ----

  it('never reaches address on an empty scene (no person), so a spike cannot fire', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    // Quiet + a swing-shaped burst, but nobody is present the whole time.
    const fired = run(trigger, [...quiet(30), ...swing()], { present: false })
    expect(fired).toEqual([])
  })

  it('abandons address if the person leaves, so a later spike does not fire', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    const energies = [...quiet(30), ...swing()]
    // Present for the first 30 (reach address), then gone for the swing.
    const present = energies.map((_, i) => i < 30)
    expect(run(trigger, energies, { present })).toEqual([])
  })

  it('walk-out then walk-in does not record a false shot', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    // Walk out (motion, then empty+still), then walk back in (sustained motion).
    const walkOut = [...spike(6, 12), ...quiet(20)] // moving out, then empty & quiet
    const walkIn = spike(18, 15) // ~1.2s of sustained motion returning
    // Nobody present once they've walked out; present again as they walk in.
    const energies = [...walkOut, ...walkIn]
    const present = energies.map((_, i) => i < 6 || i >= walkOut.length)
    expect(run(trigger, energies, { present })).toEqual([])
  })

  it('reports state for the UI meter', () => {
    const trigger = makeTrigger()
    trigger.arm(0)
    let event = trigger.sample(1, 0)
    expect(event.state).toBe('watching')
    // ~1s of stillness (16 samples > 1000ms) establishes address.
    for (let i = 1; i <= 16; i++) event = trigger.sample(1, i * SAMPLE_MS)
    expect(event.state).toBe('address')
    expect(event.energy).toBe(1)
    expect(event.present).toBe(true)
    trigger.disarm()
    expect(trigger.sample(1, 2000).state).toBe('disarmed')
  })

  it('higher sensitivity fires on softer swings', () => {
    const gentle = [...quiet(30), ...swing(6)] // soft swing (small ROI / far camera)
    const low = makeTrigger({ sensitivity: 1 })
    low.arm(0)
    expect(run(low, gentle)).toHaveLength(0)

    const high = makeTrigger({ sensitivity: 3 })
    high.arm(0)
    expect(run(high, gentle)).toHaveLength(1)
  })
})
