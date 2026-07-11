/**
 * Vision trigger state machine — replaces v1's microphone trigger.
 *
 * The golf swing has a clean motion signature: long stillness at address,
 * then a violent spike that quickly subsides. The FSM requires that whole
 * shape, which is what rejects walk-throughs, waggles, and camera noise
 * without hand-tuned absolute thresholds: the noise baseline is learned
 * per-scene via an EMA, so a grainy garage webcam and a clean phone camera
 * both work.
 *
 * Two guards keep it from firing on non-swings:
 *  - `personPresent` gates address, so an empty static frame never "arms"
 *    and a walk-through never fires (supplied by the presence detector).
 *  - the `confirming` phase requires the spike to be a *brief burst that
 *    settles* — sustained motion (walking in/around, big fidgets) never
 *    settles within the window and is discarded. The fire decision is
 *    delayed up to BURST_MAX_MS, but `firedAtMs` stays pinned to the first
 *    spike sample (impact estimate) and the pre-roll buffer covers the gap.
 *
 * Pure logic — no DOM, no workers — driven by motion-energy samples
 * (mean abs luma diff, 0–255) from the primary camera's encoder worker.
 */

export type VisionState = 'disarmed' | 'watching' | 'address' | 'confirming' | 'cooldown'

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
  stillLimit: number
  fired?: boolean
  /** Wall-clock of the first spike sample (impact estimate), set when fired. */
  firedAtMs?: number
  /** Whether a person was detected in view for this sample. */
  present?: boolean
}

/** Spike multiplier over baseline, by sensitivity. */
const SPIKE_FACTOR: Record<1 | 2 | 3, number> = { 1: 14, 2: 9, 3: 5 }
/** Consecutive spike samples required to enter the confirm phase (rejects one-frame glitches). */
const SPIKE_CONFIRM_SAMPLES = 2
/** Moderate motion longer than this abandons the address. */
const UNSTILL_ABANDON_MS = 1500
/** In `confirming`: fire once energy drops below this fraction of the spike
 * threshold (the burst has clearly subsided — a real swing). */
const SETTLE_FRACTION = 0.6
/** In `confirming`: if the burst hasn't settled within this long of the first
 * spike, it's sustained motion (walking, big fidget), not a swing — discard.
 * (~9 samples at 15fps. Tune against real swings.) */
const BURST_MAX_MS = 600
/** Baseline EMA smoothing. */
const BASELINE_ALPHA = 0.05
const BASELINE_FLOOR = 0.5

/** Default address-stillness requirement, carried by the controller. */
export const STILL_DURATION_DEFAULT_MS = 1000

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

  /**
   * @param personPresent whether a person is detected in the trigger view.
   *   Defaults to true so callers without a presence detector (and unit tests)
   *   behave as before, and so a failed/absent model degrades to shape-only.
   */
  sample(energy: number, nowMs: number, personPresent = true): VisionSampleEvent {
    const spikeThreshold = SPIKE_FACTOR[this.config.sensitivity] * Math.max(this.baseline, BASELINE_FLOOR)
    const stillLimit = Math.max(2 * this.baseline, 1.5)

    // Learn scene noise from every non-spike sample so the baseline tracks
    // lighting/grain changes but never absorbs swings. Never learn during
    // `confirming` — those samples are the swing's own decay.
    if (energy < spikeThreshold && this.state !== 'confirming') {
      this.baseline = Math.max(
        BASELINE_FLOOR,
        this.baseline + BASELINE_ALPHA * (energy - this.baseline)
      )
    }

    const event: VisionSampleEvent = {
      state: this.state,
      energy,
      baseline: this.baseline,
      spikeThreshold,
      stillLimit,
      present: personPresent
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
        // Address requires both stillness AND a person in view — an empty
        // static frame is quiet but must never arm.
        if (personPresent && energy <= stillLimit) {
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
        if (!personPresent) {
          // Person left the frame — abandon address, wait for them to re-settle.
          this.state = 'watching'
          this.stillSinceMs = null
        } else if (energy >= spikeThreshold) {
          if (this.spikeRun === 0) this.firstSpikeMs = nowMs
          this.spikeRun++
          if (this.spikeRun >= SPIKE_CONFIRM_SAMPLES) {
            // A spike — but don't fire yet; confirm it's a brief burst.
            this.state = 'confirming'
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

      case 'confirming':
        if (energy < spikeThreshold * SETTLE_FRACTION) {
          // Burst subsided within the window — a real swing. Fire, timestamped
          // at the first spike (impact estimate).
          this.state = 'cooldown'
          this.cooldownUntilMs = nowMs + this.config.cooldownMs
          event.fired = true
          event.firedAtMs = this.firstSpikeMs
        } else if (nowMs - this.firstSpikeMs > BURST_MAX_MS) {
          // Never settled — sustained motion (walking in/around, big fidget).
          // Discard and re-watch; the golfer must re-settle into address.
          this.state = 'watching'
          this.stillSinceMs = null
        }
        event.state = this.state
        return event
    }
  }
}
