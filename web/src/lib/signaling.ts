/**
 * WebRTC signaling relay for phone-camera pairing.
 *
 * A pairing session exchanges ~5–15 small messages (offer/answer/ICE) between
 * the desktop app and the phone camera page, both polling over HTTPS. Media
 * then flows peer-to-peer on the LAN — nothing but signaling touches this
 * server.
 *
 * Storage: Upstash Redis via REST when UPSTASH_REDIS_REST_URL is configured
 * (production), else an in-memory Map (local dev only — serverless instances
 * don't share memory).
 */

export type SignalRole = 'desktop' | 'phone'

export interface SignalMessage {
  type: 'offer' | 'answer' | 'candidate' | 'bye' | 'ping'
  payload: unknown
  sentAt: number
}

export interface StoredMessage extends SignalMessage {
  seq: number
}

/** Sessions (and everything in them) expire after this many seconds. */
export const SESSION_TTL_SECONDS = 600

export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

export function otherRole(role: SignalRole): SignalRole {
  return role === 'desktop' ? 'phone' : 'desktop'
}

function inboxKey(sessionId: string, recipient: SignalRole): string {
  return `signal:${sessionId}:${recipient}`
}

interface SignalStore {
  append(key: string, message: SignalMessage): Promise<void>
  /** Return messages at 0-based index >= since, with seq = index + 1. */
  readFrom(key: string, since: number): Promise<StoredMessage[]>
}

class MemoryStore implements SignalStore {
  private lists = new Map<string, { messages: SignalMessage[]; expiresAt: number }>()

  async append(key: string, message: SignalMessage): Promise<void> {
    this.prune()
    const entry = this.lists.get(key) ?? { messages: [], expiresAt: 0 }
    entry.messages.push(message)
    entry.expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000
    this.lists.set(key, entry)
  }

  async readFrom(key: string, since: number): Promise<StoredMessage[]> {
    this.prune()
    const entry = this.lists.get(key)
    if (!entry) return []
    return entry.messages.slice(since).map((message, i) => ({ ...message, seq: since + i + 1 }))
  }

  private prune(): void {
    const now = Date.now()
    for (const [key, entry] of this.lists) {
      if (entry.expiresAt < now) this.lists.delete(key)
    }
  }
}

class UpstashStore implements SignalStore {
  constructor(
    private readonly url: string,
    private readonly token: string
  ) {}

  private async pipeline(commands: (string | number)[][]): Promise<unknown[]> {
    const response = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(commands),
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error(`Upstash pipeline failed: ${response.status}`)
    }
    const results = (await response.json()) as { result: unknown; error?: string }[]
    for (const entry of results) {
      if (entry.error) throw new Error(`Upstash command failed: ${entry.error}`)
    }
    return results.map((entry) => entry.result)
  }

  async append(key: string, message: SignalMessage): Promise<void> {
    await this.pipeline([
      ['RPUSH', key, JSON.stringify(message)],
      ['EXPIRE', key, SESSION_TTL_SECONDS],
    ])
  }

  async readFrom(key: string, since: number): Promise<StoredMessage[]> {
    const [raw] = await this.pipeline([['LRANGE', key, since, -1]])
    return ((raw as string[]) ?? []).map((item, i) => ({
      ...(JSON.parse(item) as SignalMessage),
      seq: since + i + 1,
    }))
  }
}

// Module-scope singleton; survives across invocations on a warm instance.
let store: SignalStore | null = null

function getStore(): SignalStore {
  if (!store) {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    store = url && token ? new UpstashStore(url, token) : new MemoryStore()
  }
  return store
}

/** Called by `sender` to leave a message for the other side. */
export async function sendSignal(
  sessionId: string,
  sender: SignalRole,
  message: SignalMessage
): Promise<void> {
  await getStore().append(inboxKey(sessionId, otherRole(sender)), message)
}

/** Called by `recipient` to drain its own inbox past `since`. */
export async function receiveSignals(
  sessionId: string,
  recipient: SignalRole,
  since: number
): Promise<StoredMessage[]> {
  return getStore().readFrom(inboxKey(sessionId, recipient), since)
}
