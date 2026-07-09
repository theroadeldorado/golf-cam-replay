import { randomSessionId, SignalingClient } from './signaling-client'

/**
 * A phone camera slot. The phone (offerer) opens replayswing.com/camera?s=…,
 * grants camera access, and offers; we answer. Media flows P2P over the LAN.
 * The phone re-offers on the same session after locking/unlocking — each new
 * offer tears down and rebuilds the peer connection.
 */

export type PhoneSourceState = 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'stopped'

export interface PhoneSourceCallbacks {
  onState: (state: PhoneSourceState) => void
  onStream: (stream: MediaStream) => void
}

const HEARTBEAT_STALE_MS = 8000

export class PhoneCameraSource {
  readonly sessionId = randomSessionId()
  private readonly signaling: SignalingClient
  private peer: RTCPeerConnection | null = null
  private lastHeartbeatAt = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private state: PhoneSourceState = 'waiting'

  constructor(
    baseUrl: string,
    private readonly callbacks: PhoneSourceCallbacks
  ) {
    this.signaling = new SignalingClient(baseUrl, this.sessionId)
  }

  cameraPageUrl(webBaseUrl: string): string {
    return `${webBaseUrl}/camera?s=${this.sessionId}`
  }

  start(): void {
    this.signaling.start(async (message) => {
      if (message.type === 'offer') {
        await this.handleOffer((message.payload as { sdp: string }).sdp)
      } else if (message.type === 'candidate' && message.payload && this.peer) {
        try {
          await this.peer.addIceCandidate(message.payload as RTCIceCandidateInit)
        } catch {
          // Stale candidate from a torn-down peer generation — ignore.
        }
      } else if (message.type === 'bye') {
        this.setState('waiting')
        this.teardownPeer()
      }
    })
  }

  private async handleOffer(sdp: string): Promise<void> {
    this.teardownPeer()
    this.setState('connecting')

    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })
    this.peer = peer

    peer.onicecandidate = (event) => {
      void this.signaling.send('candidate', event.candidate ? event.candidate.toJSON() : null)
    }
    peer.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      this.callbacks.onStream(stream)
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') this.setState('connected')
      else if (['disconnected', 'failed'].includes(peer.connectionState)) {
        this.setState('reconnecting')
      }
    }
    peer.ondatachannel = (event) => {
      event.channel.onmessage = () => {
        this.lastHeartbeatAt = performance.now()
      }
    }

    await peer.setRemoteDescription({ type: 'offer', sdp })
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    await this.signaling.send('answer', { sdp: answer.sdp })

    this.lastHeartbeatAt = performance.now()
    this.heartbeatTimer ??= setInterval(() => {
      if (
        this.state === 'connected' &&
        performance.now() - this.lastHeartbeatAt > HEARTBEAT_STALE_MS
      ) {
        this.setState('reconnecting') // phone locked or backgrounded
      }
    }, 2000)
  }

  private setState(state: PhoneSourceState): void {
    this.state = state
    this.callbacks.onState(state)
  }

  private teardownPeer(): void {
    this.peer?.close()
    this.peer = null
  }

  stop(): void {
    void this.signaling.send('bye', null)
    this.signaling.stop()
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.teardownPeer()
    this.setState('stopped')
  }
}
