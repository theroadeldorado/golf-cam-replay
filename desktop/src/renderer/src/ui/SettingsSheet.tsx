import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings, TriggerMode } from '@shared/types'
import type { ActiveCamera } from '../capture/capture-controller'

interface MicInfo {
  deviceId: string
  label: string
}

async function listMics(): Promise<MicInfo[]> {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    return []
  }
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || `Mic ${d.deviceId.slice(0, 8)}` }))
}

function MicPreview({
  micDeviceId,
  cameras
}: {
  micDeviceId: string | null
  cameras: ActiveCamera[]
}): React.JSX.Element {
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const startPreview = useCallback(async () => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setLevel(0)
    setError(null)

    let stream: MediaStream
    let ownsStream = true
    try {
      if (micDeviceId) {
        const phoneCamera = cameras.find(
          (c) => c.id === micDeviceId && c.kind === 'phone' && c.state === 'live' && c.stream
        )
        if (phoneCamera?.stream) {
          const audioTrack = phoneCamera.stream.getAudioTracks()[0]
          if (audioTrack) {
            stream = new MediaStream([audioTrack])
            ownsStream = false
          } else {
            setError('Phone has no audio — reconnect with mic permission')
            return
          }
        } else {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: micDeviceId } },
            video: false
          })
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      }
    } catch {
      setError('No mic available')
      return
    }

    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    let raf = 0
    let closed = false

    const poll = (): void => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      setLevel(Math.sqrt(sum / buf.length))
      raf = requestAnimationFrame(poll)
    }
    raf = requestAnimationFrame(poll)

    cleanupRef.current = () => {
      if (closed) return
      closed = true
      cancelAnimationFrame(raf)
      source.disconnect()
      ctx.close().catch(() => {})
      if (ownsStream) stream.getTracks().forEach((t) => t.stop())
    }
  }, [micDeviceId, cameras])

  useEffect(() => {
    void startPreview()
    return () => cleanupRef.current?.()
  }, [startPreview])

  if (error) {
    return (
      <div style={{ fontSize: 12, color: 'var(--error, #e55)', marginTop: 6 }}>{error}</div>
    )
  }

  return (
    <div
      style={{
        marginTop: 6,
        height: 8,
        borderRadius: 4,
        background: 'var(--panel)',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${Math.min(100, level * 500)}%`,
          background: 'var(--watch)',
          transition: 'width 50ms linear'
        }}
      />
    </div>
  )
}

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
  const [mics, setMics] = useState<MicInfo[]>([])
  const [dataDir, setDataDir] = useState<string>('')
  const [dataDirChanged, setDataDirChanged] = useState(false)

  useEffect(() => {
    void listMics().then(setMics)
    void window.api.invoke('dataDir:get').then(setDataDir)
  }, [])

  const chooseDataDir = async (): Promise<void> => {
    const chosen = await window.api.invoke('dataDir:choose')
    if (chosen) {
      setDataDir(chosen)
      setDataDirChanged(true)
    }
  }

  const needsMic = settings.triggerMode === 'audio' || settings.triggerMode === 'hybrid'

  return (
    <>
      <div className="scrim" onClick={onClose} style={{ background: 'rgba(5,7,6,0.4)' }} />
      <div className="sheet">
        <h2>Settings</h2>

        <div className="field">
          <label>Shots folder</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, opacity: 0.8, wordBreak: 'break-all', flex: 1 }}>
              {dataDir}
            </span>
            <button onClick={() => void chooseDataDir()} style={{ flexShrink: 0 }}>
              Change…
            </button>
          </div>
          {dataDirChanged && (
            <p className="hint" style={{ marginTop: 6, color: 'var(--watch)' }}>
              Restart the app for this to take effect.
            </p>
          )}
        </div>

        <div className="field">
          <label>Trigger mode</label>
          <select
            value={settings.triggerMode}
            onChange={(event) => onChange({ triggerMode: event.target.value as TriggerMode })}
          >
            <option value="hybrid">Hybrid — swing motion + impact sound (Recommended)</option>
            <option value="audio">Audio only — listens for any loud sound</option>
            <option value="manual">Manual only</option>
          </select>
          {settings.triggerMode === 'hybrid' && (
            <p className="hint" style={{ marginTop: 6 }}>
              Detects address position, then swing motion, then confirms with impact sound.
              Requires a camera pointed at the golfer.
            </p>
          )}
        </div>

        {needsMic && (
          <>
            <div className="field">
              <label>Microphone</label>
              <select
                value={settings.micDeviceId ?? ''}
                onChange={(event) => onChange({ micDeviceId: event.target.value || null })}
              >
                <option value="">Default microphone</option>
                {cameras
                  .filter((c) => c.kind === 'phone')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} (phone mic{c.state !== 'live' ? ' — reconnecting…' : ''})
                    </option>
                  ))}
                {mics.map((mic) => (
                  <option key={mic.deviceId} value={mic.deviceId}>
                    {mic.label}
                  </option>
                ))}
              </select>
              <MicPreview micDeviceId={settings.micDeviceId} cameras={cameras} />
            </div>

            <div className="field">
              <label>Trigger threshold</label>
              <input
                type="range"
                min={0.01}
                max={0.4}
                step={0.005}
                value={settings.audioThreshold}
                onChange={(event) => onChange({ audioThreshold: Number(event.target.value) })}
              />
              <span className="value">{settings.audioThreshold.toFixed(3)}</span>
              <p className="hint" style={{ marginTop: 6 }}>
                Adjust until the threshold sits above the preview bar&apos;s ambient level. Lower = more
                sensitive.
              </p>
            </div>
          </>
        )}

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
          <label>Primary camera</label>
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
            The camera whose footage is used as the primary replay angle.
          </p>
        </div>

        <button onClick={onClose} style={{ marginTop: 8 }}>
          Done
        </button>
      </div>
    </>
  )
}
