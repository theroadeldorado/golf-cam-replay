/**
 * Hybrid swing trigger — motion-gated audio FSM.
 *
 * Requires BOTH motion and audio to agree before firing:
 *   IDLE → (stillness for addressDurationMs) → ADDRESS
 *   ADDRESS → (motion spike) → SWINGING
 *   SWINGING → (audio spike within audioWindowMs) → FIRE
 *   SWINGING → (timeout) → IDLE
 *
 * Eliminates false positives from random noise (no swing motion) and
 * from walking through frame (no impact sound).
 */

export interface SwingTriggerConfig {
  stillnessThreshold: number
  motionSpikeThreshold: number
  audioConfirmThreshold: number
  addressDurationMs: number
  audioWindowMs: number
  cooldownMs: number
}

export type SwingState = 'idle' | 'address' | 'swinging' | 'cooldown'

export interface SwingTriggerEvent {
  state: SwingState
  motionEnergy: number
  audioLevel: number
  fired?: boolean
  firedAtMs?: number
}

export class SwingTrigger {
  private state: SwingState = 'idle'
  private stillSinceMs = 0
  private swingStartMs = 0
  private cooldownUntilMs = 0
  private lastMotion = 0
  private lastAudio = 0
  private onFire: ((atMs: number) => void) | null = null
  private onEvent: ((event: SwingTriggerEvent) => void) | null = null

  constructor(private config: SwingTriggerConfig) {}

  start(callbacks: {
    onFire: (atMs: number) => void
    onEvent: (event: SwingTriggerEvent) => void
  }): void {
    this.onFire = callbacks.onFire
    this.onEvent = callbacks.onEvent
    this.state = 'idle'
    this.stillSinceMs = 0
  }

  updateConfig(patch: Partial<SwingTriggerConfig>): void {
    Object.assign(this.config, patch)
  }

  getState(): SwingState {
    return this.state
  }

  feedMotion(energy: number, wallMs: number): void {
    this.lastMotion = energy
    const event: SwingTriggerEvent = {
      state: this.state,
      motionEnergy: energy,
      audioLevel: this.lastAudio
    }

    switch (this.state) {
      case 'cooldown':
        if (wallMs >= this.cooldownUntilMs) {
          this.state = 'idle'
          this.stillSinceMs = 0
        }
        break

      case 'idle':
        if (energy < this.config.stillnessThreshold) {
          if (this.stillSinceMs === 0) this.stillSinceMs = wallMs
          if (wallMs - this.stillSinceMs >= this.config.addressDurationMs) {
            this.state = 'address'
          }
        } else {
          this.stillSinceMs = 0
        }
        break

      case 'address':
        if (energy >= this.config.motionSpikeThreshold) {
          this.state = 'swinging'
          this.swingStartMs = wallMs
        } else if (energy >= this.config.stillnessThreshold) {
          this.state = 'idle'
          this.stillSinceMs = 0
        }
        break

      case 'swinging':
        if (wallMs - this.swingStartMs > this.config.audioWindowMs) {
          this.state = 'idle'
          this.stillSinceMs = 0
        }
        break
    }

    event.state = this.state
    this.onEvent?.(event)
  }

  feedAudio(level: number, wallMs: number): void {
    this.lastAudio = level
    if (this.state !== 'swinging') return

    if (level >= this.config.audioConfirmThreshold) {
      console.log(`[SWING] FIRED motion+audio confirmed at ${wallMs.toFixed(0)}ms (swingStart=${this.swingStartMs.toFixed(0)} delay=${(wallMs - this.swingStartMs).toFixed(0)}ms)`)
      const firedAtMs = this.swingStartMs
      this.state = 'cooldown'
      this.cooldownUntilMs = wallMs + this.config.cooldownMs

      this.onEvent?.({
        state: this.state,
        motionEnergy: this.lastMotion,
        audioLevel: level,
        fired: true,
        firedAtMs
      })
      this.onFire?.(firedAtMs)
    }
  }

  stop(): void {
    this.state = 'idle'
    this.onFire = null
    this.onEvent = null
  }
}
