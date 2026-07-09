import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'

/**
 * PiP overlay sink: answers the main renderer's WebRTC loopback offer and
 * shows the program bus in a frameless always-on-top window over the sim.
 */

interface BusSignal {
  kind: 'offer' | 'answer' | 'candidate'
  sdp?: string
  candidate?: RTCIceCandidateInit | null
}

function Pip(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [receiving, setReceiving] = useState(false)

  useEffect(() => {
    let peer: RTCPeerConnection | null = null

    const unsubscribe = window.api.on('pip:signal', (payload) => {
      void (async () => {
        const signal = payload as BusSignal
        if (signal.kind === 'offer' && signal.sdp) {
          peer?.close()
          peer = new RTCPeerConnection()
          peer.ontrack = (event) => {
            if (videoRef.current) {
              videoRef.current.srcObject = event.streams[0] ?? new MediaStream([event.track])
              setReceiving(true)
            }
          }
          peer.onicecandidate = (event) => {
            void window.api.invoke('pip:signal', {
              kind: 'candidate',
              candidate: event.candidate ? event.candidate.toJSON() : null
            })
          }
          await peer.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
          const answer = await peer.createAnswer()
          await peer.setLocalDescription(answer)
          await window.api.invoke('pip:signal', { kind: 'answer', sdp: answer.sdp })
        } else if (signal.kind === 'candidate' && signal.candidate && peer) {
          await peer.addIceCandidate(signal.candidate)
        }
      })()
    })

    return () => {
      unsubscribe()
      peer?.close()
    }
  }, [])

  return (
    <div
      style={{
        height: '100vh',
        background: '#000',
        position: 'relative',
        border: `2px solid ${receiving ? '#43b06c' : '#232a28'}`,
        // Whole window drags; controls opt out below.
        WebkitAppRegion: 'drag'
      } as React.CSSProperties}
    >
      <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      {!receiving && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: '#7f8a83',
            fontFamily: 'ui-monospace, monospace',
            fontSize: 12
          }}
        >
          waiting for signal…
        </div>
      )}
      <button
        onClick={() => void window.api.invoke('pip:toggle')}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          background: 'rgba(11,13,12,0.8)',
          color: '#e9ede9',
          border: '1px solid #232a28',
          borderRadius: 4,
          padding: '2px 8px',
          cursor: 'pointer',
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}
      >
        ✕
      </button>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Pip />
  </React.StrictMode>
)
