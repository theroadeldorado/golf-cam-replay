export interface ShareInfo {
  qrDataUrl: string
  url: string
}

export function ShareDialog({
  share,
  onStop,
  onClose
}: {
  share: ShareInfo
  onStop: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="scrim">
      <div className="dialog" style={{ textAlign: 'center' }}>
        <h2>Send to your phone</h2>
        <p className="hint" style={{ marginBottom: 14 }}>
          Scan with your phone&apos;s camera. Keep it on the same Wi-Fi as this PC. Shots you share
          stay on this page — scan once, share more as you go.
        </p>
        <img
          src={share.qrDataUrl}
          alt="Share QR code"
          style={{ width: 220, height: 220, borderRadius: 8, background: '#fff' }}
        />
        <p
          data-testid="share-url"
          className="hint"
          style={{ margin: '12px 0', wordBreak: 'break-all', fontFamily: 'var(--font-mono)', fontSize: 11 }}
        >
          {share.url}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
          <button onClick={onClose}>Done</button>
          <button data-testid="stop-sharing" onClick={onStop}>
            Stop sharing
          </button>
        </div>
      </div>
    </div>
  )
}
