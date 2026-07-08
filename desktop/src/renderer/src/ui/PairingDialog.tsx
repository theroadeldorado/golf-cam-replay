import type { PhoneSourceState } from '../cameras/phone-source'

export interface PairingInfo {
  qrDataUrl: string
  url: string
  state: PhoneSourceState
}

const STATUS_TEXT: Record<PhoneSourceState, string> = {
  waiting: 'Scan with your phone — it opens in the browser, no app needed.',
  connecting: 'Phone found, connecting…',
  connected: 'Connected!',
  reconnecting: 'Connection lost — waiting for the phone to come back…',
  stopped: 'Cancelled.'
}

export function PairingDialog({
  pairing,
  onCancel
}: {
  pairing: PairingInfo
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'grid',
        placeItems: 'center'
      }}
    >
      <div
        style={{
          background: '#161a17',
          borderRadius: 12,
          padding: 28,
          maxWidth: 420,
          textAlign: 'center'
        }}
      >
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>Add your phone as a camera</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
          Keep the phone on the same Wi-Fi as this PC.
        </p>
        <img
          src={pairing.qrDataUrl}
          alt="Pairing QR code"
          style={{ width: 220, height: 220, borderRadius: 8, background: '#fff' }}
        />
        <p
          data-testid="pairing-url"
          style={{ fontSize: 11, color: 'var(--muted)', margin: '12px 0', wordBreak: 'break-all' }}
        >
          {pairing.url}
        </p>
        <p style={{ fontSize: 13, minHeight: 20 }}>{STATUS_TEXT[pairing.state]}</p>
        <button onClick={onCancel} style={{ marginTop: 12 }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
