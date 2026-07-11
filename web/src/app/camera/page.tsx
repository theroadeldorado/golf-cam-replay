'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Status =
  | 'no-session'
  | 'idle'
  | 'starting-camera'
  | 'waiting-desktop'
  | 'connecting'
  | 'connected'
  | 'failed'

const POLL_INTERVAL_MS = 750
const ICE_TIMEOUT_MS = 15_000

interface SignalMessage {
  type: 'offer' | 'answer' | 'candidate' | 'bye' | 'ping'
  payload: unknown
  sentAt?: number
}

function signalUrl(sessionId: string): string {
  return `/api/signal/${sessionId}/phone`
}

async function postSignal(sessionId: string, message: SignalMessage): Promise<void> {
  await fetch(signalUrl(sessionId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  })
}

function CameraClient() {
  const sessionId = useSearchParams().get('s')
  const [status, setStatus] = useState<Status>(sessionId ? 'idle' : 'no-session')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const videoRef = useRef<HTMLVideoElement>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const lastSeqRef = useRef(0)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const gotAnswerRef = useRef(false)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const iceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const teardownPeer = useCallback(() => {
    if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current)
    iceTimeoutRef.current = null
    if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
    heartbeatTimerRef.current = null
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = null
    peerRef.current?.close()
    peerRef.current = null
  }, [])

  const cleanupConnection = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    pollTimerRef.current = null
    teardownPeer()
  }, [teardownPeer])

  const acquireWakeLock = useCallback(async () => {
    try {
      wakeLockRef.current = await navigator.wakeLock?.request('screen')
    } catch {
      // Wake lock is best-effort; the on-screen "keep this open" notice covers the rest.
    }
  }, [])

  const createPeerAndOfferRef = useRef<() => Promise<void>>(async () => {})

  const createPeerAndOffer = useCallback(async () => {
    if (!sessionId || !streamRef.current) return
    teardownPeer()
    gotAnswerRef.current = false
    setStatus('waiting-desktop')

    const stream = streamRef.current
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    peerRef.current = peer

    for (const track of stream.getTracks()) {
      if (track.readyState === 'live') {
        track.contentHint = 'motion'
        peer.addTrack(track, stream)
      }
    }

    const heartbeat = peer.createDataChannel('heartbeat')
    heartbeatTimerRef.current = setInterval(() => {
      if (heartbeat.readyState === 'open') heartbeat.send(String(Date.now()))
    }, 2000)

    peer.onicecandidate = (event) => {
      void postSignal(sessionId, {
        type: 'candidate',
        payload: event.candidate ? event.candidate.toJSON() : null,
      })
    }

    iceTimeoutRef.current = setTimeout(() => {
      if (peerRef.current !== peer || peer.connectionState === 'connected') return
      if (gotAnswerRef.current) {
        setStatus('failed')
      } else {
        setStatus('waiting-desktop')
      }
    }, ICE_TIMEOUT_MS)

    let wasConnected = false

    peer.oniceconnectionstatechange = () => {
      if (peerRef.current !== peer) return
      if (peer.iceConnectionState === 'connected') {
        if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current)
        setStatus('connected')
      }
    }

    peer.onconnectionstatechange = () => {
      if (peerRef.current !== peer) return
      if (peer.connectionState === 'connected') {
        wasConnected = true
        if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current)
        setStatus('connected')
      } else if (peer.connectionState === 'failed') {
        if (iceTimeoutRef.current) clearTimeout(iceTimeoutRef.current)
        if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
        if (wasConnected) {
          setStatus('connecting')
          reconnectTimerRef.current = setTimeout(() => {
            void createPeerAndOfferRef.current()
          }, 3000)
        } else {
          setStatus('failed')
        }
      } else if (peer.connectionState === 'disconnected') {
        setStatus('connecting')
      } else if (peer.connectionState === 'closed') {
        if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
      }
    }

    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    await postSignal(sessionId, { type: 'offer', payload: { sdp: offer.sdp } })
  }, [sessionId, teardownPeer])

  createPeerAndOfferRef.current = createPeerAndOffer

  const connect = useCallback(async () => {
    if (!sessionId) return
    setStatus('starting-camera')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, min: 30 },
        },
        audio: true,
      })
    } catch {
      setStatus('failed')
      return
    }
    streamRef.current = stream
    if (videoRef.current) videoRef.current.srcObject = stream

    await acquireWakeLock()
    await createPeerAndOffer()

    lastSeqRef.current = 0
    pollTimerRef.current = setInterval(async () => {
      try {
        const response = await fetch(`${signalUrl(sessionId)}?since=${lastSeqRef.current}`, {
          cache: 'no-store',
        })
        const { messages } = (await response.json()) as {
          messages: (SignalMessage & { seq: number })[]
        }
        for (const message of messages) {
          lastSeqRef.current = Math.max(lastSeqRef.current, message.seq)
          if (message.type === 'answer') {
            if (!gotAnswerRef.current && peerRef.current?.signalingState === 'have-local-offer') {
              gotAnswerRef.current = true
              setStatus('connecting')
              const { sdp } = message.payload as { sdp: string }
              await peerRef.current.setRemoteDescription({ type: 'answer', sdp })
            }
          } else if (message.type === 'candidate' && message.payload) {
            try {
              await peerRef.current?.addIceCandidate(message.payload as RTCIceCandidateInit)
            } catch {
              // Stale candidate from a previous peer generation — ignore.
            }
          } else if (message.type === 'ping') {
            await createPeerAndOfferRef.current()
          } else if (message.type === 'bye') {
            teardownPeer()
            setStatus('waiting-desktop')
          }
        }
      } catch {
        // Transient polling errors are fine; next tick retries.
      }
    }, POLL_INTERVAL_MS)
  }, [sessionId, facing, acquireWakeLock, cleanupConnection, createPeerAndOffer])

  const flipCamera = useCallback(async () => {
    const next = facing === 'environment' ? 'user' : 'environment'
    setFacing(next)
    const peer = peerRef.current
    if (!peer || !streamRef.current) return
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: next, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
      const newTrack = newStream.getVideoTracks()[0]
      newTrack.contentHint = 'motion'
      const sender = peer.getSenders().find((s) => s.track?.kind === 'video')
      await sender?.replaceTrack(newTrack)
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = newStream
      if (videoRef.current) videoRef.current.srcObject = newStream
    } catch {
      // Keep the current camera if the flip fails.
    }
  }, [facing])

  // Re-acquire the wake lock when the page becomes visible again.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && status === 'connected') {
        void acquireWakeLock()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [status, acquireWakeLock])

  useEffect(() => cleanupConnection, [cleanupConnection])

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center gap-6 p-6 text-center">
      {status === 'no-session' && (
        <>
          <h1 className="text-2xl font-semibold">ReplaySwing Camera</h1>
          <p className="text-neutral-400 max-w-sm">
            Open this page by scanning the QR code shown in the ReplaySwing desktop app
            (Add Camera → Phone).
          </p>
        </>
      )}

      {status === 'idle' && (
        <>
          <h1 className="text-2xl font-semibold">ReplaySwing Camera</h1>
          <p className="text-neutral-400 max-w-sm">
            Your phone is about to become a swing camera. Keep it on the same Wi-Fi as your
            simulator PC.
          </p>
          <button
            onClick={connect}
            className="rounded-full bg-emerald-500 px-8 py-4 text-lg font-semibold text-neutral-950 active:scale-95 transition"
          >
            Start camera
          </button>
        </>
      )}

      {status !== 'no-session' && status !== 'idle' && (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full max-w-md rounded-2xl bg-black aspect-video object-cover"
          />
          <div className="flex flex-col items-center gap-2">
            {status === 'starting-camera' && <p>Starting camera…</p>}
            {status === 'waiting-desktop' && <p>Waiting for the desktop app…</p>}
            {status === 'connecting' && <p>Connecting…</p>}
            {status === 'connected' && (
              <>
                <p className="text-emerald-400 font-semibold">Connected to ReplaySwing</p>
                <p className="text-neutral-400 text-sm max-w-xs">
                  Keep this screen open and the phone plugged in or awake while you practice.
                </p>
              </>
            )}
            {status === 'failed' && (
              <div className="max-w-sm space-y-2">
                <p className="text-red-400 font-semibold">Couldn&apos;t connect</p>
                <ul className="text-neutral-400 text-sm text-left list-disc pl-5 space-y-1">
                  <li>Make sure this phone is on the same Wi-Fi as your simulator PC (not cellular).</li>
                  <li>Guest networks often block devices from seeing each other.</li>
                  <li>Re-scan the QR code in the desktop app to try again.</li>
                </ul>
                <button
                  onClick={connect}
                  className="rounded-full bg-emerald-500 px-6 py-3 font-semibold text-neutral-950"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
          {(status === 'connected' || status === 'waiting-desktop') && (
            <button
              onClick={flipCamera}
              className="rounded-full border border-neutral-700 px-6 py-3 text-sm text-neutral-300"
            >
              Flip camera
            </button>
          )}
        </>
      )}
    </main>
  )
}

export default function CameraPage() {
  return (
    <Suspense>
      <CameraClient />
    </Suspense>
  )
}
