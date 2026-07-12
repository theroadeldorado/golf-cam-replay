import { useCallback, useState } from 'react'

export function FeedbackDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const submit = useCallback(() => {
    if (!title.trim()) return
    void window.api.invoke('feedback:submit', title.trim(), body.trim())
    setSubmitted(true)
    setTimeout(onClose, 1500)
  }, [title, body, onClose])

  return (
    <div className="scrim" onClick={onClose}>
      <div className="dialog feedback-dialog" onClick={(e) => e.stopPropagation()}>
        {submitted ? (
          <div style={{ padding: '30px 0', textAlign: 'center' }}>
            <p style={{ fontSize: 16 }}>Opening GitHub — thanks for the feedback!</p>
          </div>
        ) : (
          <>
            <h2>Submit Feedback</h2>
            <p className="hint" style={{ marginBottom: 12 }}>
              Opens a GitHub issue with your feedback and system info attached.
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
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={submit} disabled={!title.trim()}>
                Submit
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
