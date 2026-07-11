/**
 * Audio-based swing trigger — detects the sharp transient of club impact.
 *
 * Uses a simple fixed RMS threshold: when level crosses threshold, a spike
 * is detected. If the level drops back below 40% of threshold within
 * BURST_MAX_MS, we fire (the burst has settled — it was a real impact, not
 * sustained noise). The threshold is user-adjustable via a slider.
 */

export interface AudioTriggerConfig {
  threshold: number
  cooldownMs: number
}

export type AudioTriggerState = 'disarmed' | 'listening' | 'cooldown'

export interface AudioSampleEvent {
  state: AudioTriggerState
  level: number
  threshold: number
  peak: number
  fired?: boolean
  firedAtMs?: number
  error?: string
}

const POLL_INTERVAL_MS = 16
const BURST_MAX_MS = 300

export class AudioTrigger {
  private state: AudioTriggerState = 'disarmed'
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private cooldownUntilMs = 0
  private spikeAtMs = 0
  private spikeDetected = false
  private peak = 0
  private onSample: ((event: AudioSampleEvent) => void) | null = null
  private onFire: ((atMs: number) => void) | null = null

  constructor(private config: AudioTriggerConfig) {}

  updateThreshold(threshold: number): void {
    this.config.threshold = threshold
  }

  /**
   * Start listening for impact sounds.
   * @param source Either a deviceId string (local mic) or a MediaStream (e.g. phone WebRTC audio).
   *   Pass null to use the system default mic.
   */
  async start(
    source: string | MediaStream | null,
    callbacks: {
      onSample: (event: AudioSampleEvent) => void
      onFire: (atMs: number) => void
    }
  ): Promise<void> {
    this.onSample = callbacks.onSample
    this.onFire = callbacks.onFire

    let stream: MediaStream
    if (source instanceof MediaStream) {
      stream = source
    } else {
      const constraints: MediaStreamConstraints = {
        audio: source ? { deviceId: { exact: source } } : true,
        video: false
      }
      stream = await navigator.mediaDevices.getUserMedia(constraints)
      this.stream = stream
    }

    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(stream)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 2048
    this.source.connect(this.analyser)

    this.state = 'listening'
    this.cooldownUntilMs = 0
    this.spikeDetected = false
    this.peak = 0

    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
  }

  private poll(): void {
    if (!this.analyser) return
    const nowMs = performance.now()

    const data = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
    const level = Math.sqrt(sum / data.length)

    if (level > this.peak) this.peak = level
    const threshold = this.config.threshold

    const event: AudioSampleEvent = {
      state: this.state,
      level,
      threshold,
      peak: this.peak
    }

    switch (this.state) {
      case 'cooldown':
        if (nowMs >= this.cooldownUntilMs) {
          this.state = 'listening'
          this.spikeDetected = false
          this.peak = 0
        }
        break

      case 'listening':
        if (this.spikeDetected) {
          if (level < threshold * 0.4) {
            this.state = 'cooldown'
            this.cooldownUntilMs = nowMs + this.config.cooldownMs
            event.fired = true
            event.firedAtMs = this.spikeAtMs
            this.onFire?.(this.spikeAtMs)
            this.spikeDetected = false
          } else if (nowMs - this.spikeAtMs > BURST_MAX_MS) {
            this.spikeDetected = false
          }
        } else if (level >= threshold) {
          this.spikeAtMs = nowMs
          this.spikeDetected = true
        }
        break
    }

    event.state = this.state
    this.onSample?.(event)
  }

  getState(): AudioTriggerState {
    return this.state
  }

  stop(): void {
    this.state = 'disarmed'
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.source?.disconnect()
    this.source = null
    this.analyser = null
    void this.context?.close()
    this.context = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }
}
