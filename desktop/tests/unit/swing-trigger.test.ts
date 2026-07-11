import { describe, it, expect, vi } from 'vitest'
import { SwingTrigger } from '../../src/renderer/src/trigger/swing-trigger'

function makeTrigger(overrides?: Partial<Parameters<typeof SwingTrigger.prototype.updateConfig>[0]>) {
  return new SwingTrigger({
    stillnessThreshold: 0.01,
    motionSpikeThreshold: 0.04,
    audioConfirmThreshold: 0.05,
    addressDurationMs: 1500,
    audioWindowMs: 500,
    cooldownMs: 3000,
    ...overrides
  })
}

describe('SwingTrigger FSM', () => {
  it('fires on stillness → motion spike → audio confirmation', () => {
    const trigger = makeTrigger()
    const onFire = vi.fn()
    const onEvent = vi.fn()
    trigger.start({ onFire, onEvent })

    for (let t = 0; t <= 2000; t += 33) {
      trigger.feedMotion(0.005, t)
    }
    expect(trigger.getState()).toBe('address')

    trigger.feedMotion(0.08, 2033)
    expect(trigger.getState()).toBe('swinging')

    trigger.feedAudio(0.1, 2100)
    expect(onFire).toHaveBeenCalledOnce()
    expect(trigger.getState()).toBe('cooldown')
  })

  it('does NOT fire on audio without motion spike', () => {
    const trigger = makeTrigger()
    const onFire = vi.fn()
    trigger.start({ onFire, onEvent: vi.fn() })

    for (let t = 0; t <= 2000; t += 33) {
      trigger.feedMotion(0.005, t)
    }
    expect(trigger.getState()).toBe('address')

    trigger.feedAudio(0.2, 2100)
    expect(onFire).not.toHaveBeenCalled()
    expect(trigger.getState()).toBe('address')
  })

  it('does NOT fire if audio arrives after window expires', () => {
    const trigger = makeTrigger()
    const onFire = vi.fn()
    trigger.start({ onFire, onEvent: vi.fn() })

    for (let t = 0; t <= 2000; t += 33) {
      trigger.feedMotion(0.005, t)
    }

    trigger.feedMotion(0.08, 2033)
    expect(trigger.getState()).toBe('swinging')

    trigger.feedMotion(0.005, 2600)
    expect(trigger.getState()).toBe('idle')

    trigger.feedAudio(0.2, 2650)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('does NOT fire without prior stillness (no address)', () => {
    const trigger = makeTrigger()
    const onFire = vi.fn()
    trigger.start({ onFire, onEvent: vi.fn() })

    trigger.feedMotion(0.02, 0)
    trigger.feedMotion(0.08, 100)
    trigger.feedAudio(0.2, 150)

    expect(onFire).not.toHaveBeenCalled()
    expect(trigger.getState()).toBe('idle')
  })

  it('resets from address if motion is above stillness but below spike', () => {
    const trigger = makeTrigger()
    const onFire = vi.fn()
    trigger.start({ onFire, onEvent: vi.fn() })

    for (let t = 0; t <= 2000; t += 33) {
      trigger.feedMotion(0.005, t)
    }
    expect(trigger.getState()).toBe('address')

    trigger.feedMotion(0.02, 2100)
    expect(trigger.getState()).toBe('idle')
  })

  it('respects cooldown period after firing', () => {
    const trigger = makeTrigger()
    const onFire = vi.fn()
    trigger.start({ onFire, onEvent: vi.fn() })

    for (let t = 0; t <= 2000; t += 33) trigger.feedMotion(0.005, t)
    trigger.feedMotion(0.08, 2033)
    trigger.feedAudio(0.1, 2100)
    expect(onFire).toHaveBeenCalledOnce()
    expect(trigger.getState()).toBe('cooldown')

    for (let t = 2200; t <= 4000; t += 33) trigger.feedMotion(0.005, t)
    expect(trigger.getState()).toBe('cooldown')

    trigger.feedMotion(0.005, 4500)
    expect(trigger.getState()).toBe('cooldown')

    trigger.feedMotion(0.005, 5200)
    expect(trigger.getState()).toBe('idle')
  })

  it('fires with the swing start time, not the audio confirmation time', () => {
    const trigger = makeTrigger()
    const onFire = vi.fn()
    trigger.start({ onFire, onEvent: vi.fn() })

    for (let t = 0; t <= 2000; t += 33) trigger.feedMotion(0.005, t)
    trigger.feedMotion(0.08, 2033)
    trigger.feedAudio(0.1, 2300)

    expect(onFire).toHaveBeenCalledWith(2033)
  })
})
