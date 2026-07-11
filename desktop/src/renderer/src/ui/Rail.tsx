import type { ClipMeta, SessionInfo } from '@shared/types'

function clipUrl(sessionId: string, fileName: string): string {
  return `clip://media/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileName)}`
}

export function Rail({
  sessions,
  selectedSession,
  clips,
  activeFile,
  onSelectSession,
  onPlay,
  onPin,
  onDelete
}: {
  sessions: SessionInfo[]
  selectedSession: string | null
  clips: ClipMeta[]
  activeFile: string | null
  onSelectSession: (id: string) => void
  onPlay: (clip: ClipMeta) => void
  onPin: (index: number, pinned: boolean) => void
  onDelete: (index: number) => void
}): React.JSX.Element {
  return (
    <aside className="rail">
      <div className="rail-header">
        <span>Shots</span>
        {sessions.length > 0 && (
          <select
            value={selectedSession ?? ''}
            onChange={(event) => onSelectSession(event.target.value)}
            style={{
              background: 'transparent',
              color: 'var(--muted)',
              border: 'none',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              maxWidth: 130
            }}
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.id.replace('_', ' ')}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="rail-list">
        {clips.length === 0 ? (
          <p className="rail-empty">
            No shots yet.
            <br />
            Arm and swing — clips land here.
          </p>
        ) : (
          [...clips].reverse().map((clip, reverseIndex) => {
            const index = clips.length - 1 - reverseIndex
            const shotNumber = clip.file.match(/shot_(\d+)/)?.[1] ?? String(index)
            return (
              <button key={clip.file} className={`shot-card${clip.file === activeFile ? ' active' : ''}`} onClick={() => onPlay(clip)}>
                {clip.thumbnail && selectedSession && (
                  <img src={clipUrl(selectedSession, clip.thumbnail)} alt="" />
                )}
                <span className="shot-label">
                  <span>SHOT {shotNumber}</span>
                  <span>
                    {new Date(clip.timestamp * 1000).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </span>
                <span
                  className="pin"
                  data-pinned={clip.pinned === true}
                  title={clip.pinned ? 'Unpin' : 'Pin'}
                  onClick={(event) => {
                    event.stopPropagation()
                    onPin(index, !clip.pinned)
                  }}
                >
                  {clip.pinned ? '★' : '☆'}
                </span>
                <span
                  className="pin"
                  style={{ top: 28 }}
                  title="Delete shot"
                  onClick={(event) => {
                    event.stopPropagation()
                    onDelete(index)
                  }}
                >
                  ✕
                </span>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}

export { clipUrl }
