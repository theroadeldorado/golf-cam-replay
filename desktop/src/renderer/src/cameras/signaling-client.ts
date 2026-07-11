/**
 * Desktop side of the polling signaling relay hosted on replayswing.com
 * (web/src/app/api/signal). A pairing exchanges a handful of tiny messages;
 * media itself is P2P on the LAN and never touches the relay.
 */

export interface SignalMessage {
  type: 'offer' | 'answer' | 'candidate' | 'bye' | 'ping'
  payload: unknown
  seq?: number
}

const POLL_INTERVAL_MS = 750

export function randomSessionId(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class SignalingClient {
  private since = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private draining = false

  constructor(
    private readonly baseUrl: string,
    private readonly sessionId: string
  ) {}

  private get endpoint(): string {
    return `${this.baseUrl}/api/signal/${this.sessionId}/desktop`
  }

  /** Drain existing messages without processing, then send a ping to request a fresh offer. */
  async flush(): Promise<void> {
    try {
      const response = await fetch(`${this.endpoint}?since=${this.since}`, { cache: 'no-store' })
      const { messages } = (await response.json()) as { messages: (SignalMessage & { seq: number })[] }
      for (const message of messages) {
        this.since = Math.max(this.since, message.seq)
      }
      await this.send('ping', null)
    } catch {
      // Best-effort — polling will start fresh either way.
    }
  }

  /** Poll the desktop inbox; messages are delivered serially and in order. */
  start(onMessage: (message: SignalMessage) => Promise<void>): void {
    this.timer = setInterval(async () => {
      if (this.draining) return
      this.draining = true
      try {
        const response = await fetch(`${this.endpoint}?since=${this.since}`, { cache: 'no-store' })
        const { messages } = (await response.json()) as { messages: (SignalMessage & { seq: number })[] }
        for (const message of messages) {
          this.since = Math.max(this.since, message.seq)
          await onMessage(message)
        }
      } catch {
        // Transient network error — next poll retries.
      } finally {
        this.draining = false
      }
    }, POLL_INTERVAL_MS)
  }

  async send(type: SignalMessage['type'], payload: unknown): Promise<void> {
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, payload })
      })
    } catch {
      // Best-effort; the phone side re-offers if signaling stalls.
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
