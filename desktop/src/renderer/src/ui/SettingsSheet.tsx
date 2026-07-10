import type { Settings } from '@shared/types'
import type { ActiveCamera } from '../capture/capture-controller'

export function SettingsSheet({
  settings,
  cameras,
  onChange,
  onClose
}: {
  settings: Settings
  cameras: ActiveCamera[]
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <>
      <div className="scrim" onClick={onClose} style={{ background: 'rgba(5,7,6,0.4)' }} />
      <div className="sheet">
        <h2>Settings</h2>

        <div className="field">
          <label>Pre-roll — seconds kept before the trigger</label>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.5}
            value={settings.preRollSec}
            onChange={(event) => onChange({ preRollSec: Number(event.target.value) })}
          />
          <span className="value">{settings.preRollSec.toFixed(1)}s</span>
        </div>

        <div className="field">
          <label>Post-roll — seconds recorded after the trigger</label>
          <input
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={settings.postRollSec}
            onChange={(event) => onChange({ postRollSec: Number(event.target.value) })}
          />
          <span className="value">{settings.postRollSec.toFixed(1)}s</span>
        </div>

        <div className="field">
          <label>Trigger sensitivity</label>
          <select
            value={settings.sensitivity}
            onChange={(event) => onChange({ sensitivity: Number(event.target.value) as 1 | 2 | 3 })}
          >
            <option value={1}>Low — only hard swings fire</option>
            <option value={2}>Medium</option>
            <option value={3}>High — fires on soft swings</option>
          </select>
        </div>

        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0 }}>
            <input
              type="checkbox"
              checked={settings.requirePresence}
              onChange={(event) => onChange({ requirePresence: event.target.checked })}
            />
            Require a person in view
          </label>
          <p className="hint" style={{ marginTop: 6 }}>
            The trigger only arms when it sees someone in the hitting zone, so it won&apos;t fire on
            an empty bay or someone walking past. Turn off for unusual camera setups.
          </p>
        </div>

        <div className="field">
          <label>Trigger camera</label>
          <select
            value={settings.primaryCameraId ?? ''}
            onChange={(event) => onChange({ primaryCameraId: event.target.value || null })}
          >
            {cameras.map((camera) => (
              <option key={camera.id} value={camera.id}>
                {camera.label}
              </option>
            ))}
          </select>
          <p className="hint" style={{ marginTop: 6 }}>
            The camera that watches for your swing. Changes apply to newly added cameras after a
            restart.
          </p>
        </div>

        <button onClick={onClose} style={{ marginTop: 8 }}>
          Done
        </button>
      </div>
    </>
  )
}
