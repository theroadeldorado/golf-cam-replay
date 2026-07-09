/**
 * Vision trigger state machine — replaces v1's microphone trigger.
 *
 * The golf swing has a clean motion signature: long stillness at address,
 * then a violent spike. The FSM requires that sequence, which is what
 * rejects walk-throughs, waggles, and camera noise without any hand-tuned
 * absolute thresholds: the noise baseline is learned per-scene via an EMA,
 * so a grainy webcam in a dim garage and a clean phone camera both work.
 *
 * Pure logic — no DOM, no workers — driven by motion-energy samples
 * (mean abs luma diff, 0–255) from the primary camera's encoder worker.
 */

export type VisionState = 'disarmed' | 'watching' | 'address' | 'cooldown'

export interface VisionTriggerConfig {
  /** 1 = low (needs a hard spike), 2 = medium, 3 = high (fires on soft spikes). */
  sensitivity: 1 | 2 | 3
  /** Continuous stillness required to establish address. */
  stillDurationMs: number
  /** Refractory period after firing; should exceed postRoll + follow-through. */
  cooldownMs: number
}

export interface VisionSampleEvent {
  state: VisionState
  energy: number
  baseline: number
  spikeThreshold: number
  fired?: boolean
  /** Wall-clock of the first spike sample (impact estimate), set when fired. */
  firedAtMs?: number
}

/** Spike multiplier over baseline, by sensitivity. */
const SPIKE_FACTOR: Record<1 | 2 | 3, number> = { 1: 14, 2: 9, 3: 5 }
/** Consecutive spike samples required to fire (rejects one-frame glitches). */
const SPIKE_CONFIRM_SAMPLES = 2
/** Moderate motion longer than this abandons the address. */
const UNSTILL_ABANDON_MS = 1500
/** Baseline EMA smoothing. */
const BASELINE_ALPHA = 0.05
const BASELINE_FLOOR = 0.5

export class VisionTrigger {
  private state: VisionState = 'disarmed'
  private baseline = BASELINE_FLOOR
  private stillSinceMs: number | null = null
  private unstillSinceMs: number | null = null
  private spikeRun = 0
  private firstSpikeMs = 0
  private cooldownUntilMs = 0

  constructor(private readonly config: VisionTriggerConfig) {}

  arm(nowMs: number): void {
    this.state = 'watching'
    this.stillSinceMs = null
    this.unstillSinceMs = null
    this.spikeRun = 0
    this.cooldownUntilMs = nowMs
  }

  disarm(): void {
    this.state = 'disarmed'
  }

  getState(): VisionState {
    return this.state
  }

  sample(energy: number, nowMs: number): VisionSampleEvent {
    const spikeThreshold = SPIKE_FACTOR[this.config.sensitivity] * Math.max(this.baseline, BASELINE_FLOOR)
    const stillLimit = Math.max(2 * this.baseline, 1.5)

    // Learn scene noise from every non-spike sample so the baseline tracks
    // lighting/grain changes but never absorbs swings.
    if (energy < spikeThreshold) {
      this.baseline = Math.max(
        BASELINE_FLOOR,
        this.baseline + BASELINE_ALPHA * (energy - this.baseline)
      )
    }

    const event: VisionSampleEvent = {
      state: this.state,
      energy,
      baseline: this.baseline,
      spikeThreshold
    }

    switch (this.state) {
      case 'disarmed':
        return event

      case 'cooldown':
        if (nowMs >= this.cooldownUntilMs) {
          this.state = 'watching'
          this.stillSinceMs = null
        }
        event.state = this.state
        return event

      case 'watching':
        if (energy <= stillLimit) {
          this.stillSinceMs ??= nowMs
          if (nowMs - this.stillSinceMs >= this.config.stillDurationMs) {
            this.state = 'address'
            this.unstillSinceMs = null
            this.spikeRun = 0
          }
        } else {
          this.stillSinceMs = null
        }
        event.state = this.state
        return event

      case 'address':
        if (energy >= spikeThreshold) {
          if (this.spikeRun === 0) this.firstSpikeMs = nowMs
          this.spikeRun++
          if (this.spikeRun >= SPIKE_CONFIRM_SAMPLES) {
            this.state = 'cooldown'
            this.cooldownUntilMs = nowMs + this.config.cooldownMs
            event.state = 'cooldown'
            event.fired = true
            event.firedAtMs = this.firstSpikeMs
          }
        } else {
          this.spikeRun = 0
          if (energy > stillLimit) {
            // Moderate motion: waggles are brief, walking away is not.
            this.unstillSinceMs ??= nowMs
            if (nowMs - this.unstillSinceMs >= UNSTILL_ABANDON_MS) {
              this.state = 'watching'
              this.stillSinceMs = null
            }
          } else {
            this.unstillSinceMs = null
          }
        }
        event.state = this.state
        return event
    }
  }
}
