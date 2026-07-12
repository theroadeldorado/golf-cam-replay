import { useCallback, useState } from 'react'

export function FeedbackDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const submit = useCallback(async () => {
    if (!title.trim()) return
    setStatus('sending')
    try {
      const result = await window.api.invoke('feedback:submit', title.trim(), body.trim())
      if (result.success) {
        setStatus('success')
        setTimeout(onClose, 1500)
      } else {
        setErrorMsg(result.error ?? 'Something went wrong.')
        setStatus('error')
      }
    } catch {
      setErrorMsg('Could not submit feedback. Please try again.')
      setStatus('error')
    }
  }, [title, body, onClose])

  return (
    <div className="scrim" onClick={onClose}>
      <div className="dialog feedback-dialog" onClick={(e) => e.stopPropagation()}>
        {status === 'success' ? (
          <div style={{ padding: '30px 0', textAlign: 'center' }}>
            <p style={{ fontSize: 16 }}>Feedback submitted — thank you!</p>
          </div>
        ) : (
          <>
            <h2>Submit Feedback</h2>
            <p className="hint" style={{ marginBottom: 12 }}>
              Report a bug or suggest a feature. Your system info is attached automatically.
            </p>
            <div className="field">
              <label>Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Brief summary of the issue or idea"
                autoFocus
              />
            </div>
            <div className="field">
              <label>Description</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Steps to reproduce, expected behavior, or feature details…"
                rows={5}
                style={{
                  width: '100%',
                  background: 'var(--panel-raised)',
                  color: 'var(--fg)',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontFamily: 'var(--font-body)',
                  resize: 'vertical'
                }}
              />
            </div>
            {status === 'error' && (
              <p style={{ color: '#e55', fontSize: 13, margin: '8px 0 0' }}>{errorMsg}</p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={submit} disabled={!title.trim() || status === 'sending'}>
                {status === 'sending' ? 'Submitting…' : 'Submit'}
              </button>
              <button onClick={onClose} style={{ opacity: 0.7 }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
