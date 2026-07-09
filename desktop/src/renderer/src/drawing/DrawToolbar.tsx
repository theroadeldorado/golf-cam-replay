import { SHAPE_COLORS } from './shapes'
import type { DrawTool } from './DrawingOverlay'

/**
 * Floating draw-mode toolbar. The pencil button is always visible on the
 * stage; the tools expand when draw mode is on.
 */
export function DrawToolbar({
  active,
  tool,
  color,
  hasSelection,
  onToggle,
  onTool,
  onColor,
  onDelete
}: {
  active: boolean
  tool: DrawTool
  color: string
  hasSelection: boolean
  onToggle: () => void
  onTool: (tool: DrawTool) => void
  onColor: (color: string) => void
  onDelete: () => void
}): React.JSX.Element {
  return (
    <div className="draw-toolbar" data-active={active}>
      <button
        data-testid="draw-toggle"
        title={active ? 'Done drawing (Esc)' : 'Draw on the video'}
        className={active ? 'tool-btn on' : 'tool-btn'}
        onClick={onToggle}
      >
        ✏
      </button>
      {active && (
        <>
          <span className="draw-sep" />
          {(
            [
              ['select', '⇱', 'Select & edit'],
              ['line', '╱', 'Draw a line'],
              ['circle', '◯', 'Draw a circle']
            ] as [DrawTool, string, string][]
          ).map(([id, glyph, label]) => (
            <button
              key={id}
              data-testid={`tool-${id}`}
              title={label}
              className={tool === id ? 'tool-btn on' : 'tool-btn'}
              onClick={() => onTool(id)}
            >
              {glyph}
            </button>
          ))}
          <span className="draw-sep" />
          {SHAPE_COLORS.map((swatch) => (
            <button
              key={swatch}
              data-testid={`color-${swatch}`}
              title="Set color"
              className={color === swatch ? 'swatch on' : 'swatch'}
              style={{ background: swatch }}
              onClick={() => onColor(swatch)}
            />
          ))}
          <span className="draw-sep" />
          <button
            data-testid="draw-delete"
            title="Delete selected shape (Del)"
            className="tool-btn"
            disabled={!hasSelection}
            onClick={onDelete}
          >
            🗑
          </button>
        </>
      )}
    </div>
  )
}
