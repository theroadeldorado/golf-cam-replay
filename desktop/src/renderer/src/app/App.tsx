import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipMeta, Settings } from '@shared/types'
import { CaptureController, type ActiveCamera } from '../capture/capture-controller'
import { listUsbCameras, onDeviceChange, type UsbCameraInfo } from '../cameras/usb'

function CameraTile({ camera }: { camera: ActiveCamera }): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && camera.stream) {
      videoRef.current.srcObject = camera.stream
    }
  }, [camera.stream])

  return (
    <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
      <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', display: 'block' }} />
      <div
        style={{
          position: 'absolute',
          left: 8,
          bottom: 8,
          fontSize: 12,
          background: 'rgba(0,0,0,0.6)',
          padding: '2px 8px',
          borderRadius: 4
        }}
      >
        {camera.label} · {camera.state === 'live' ? `${camera.measuredFps} fps` : camera.state}
        {camera.error ? ` — ${camera.error}` : ''}
      </div>
    </div>
  )
}

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [cameras, setCameras] = useState<ActiveCamera[]>([])
  const [available, setAvailable] = useState<UsbCameraInfo[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [replay, setReplay] = useState<{ url: string; meta: ClipMeta } | null>(null)
  const controllerRef = useRef<CaptureController | null>(null)

  // Boot: load settings, build the controller, reopen saved cameras.
  useEffect(() => {
    let disposed = false
    void (async () => {
      const loaded = await window.api.invoke('settings:get')
      if (disposed) return
      setSettings(loaded)

      const controller = new CaptureController(loaded)
      controllerRef.current = controller
      controller.on('camerasChanged', setCameras)
      controller.on('captureStateChanged', setCapturing)
      controller.on('clipSaved', (meta, primaryMp4) => {
        const url = URL.createObjectURL(new Blob([primaryMp4], { type: 'video/mp4' }))
        setReplay((previous) => {
          if (previous) URL.revokeObjectURL(previous.url)
          return { url, meta }
        })
      })

      for (const camera of loaded.cameras) {
        if (camera.kind === 'usb') {
          void controller.addUsbCamera(camera.id, camera.label)
        }
      }
    })()
    return () => {
      disposed = true
      controllerRef.current?.dispose()
    }
  }, [])

  const refreshAvailable = useCallback(async () => {
    const found = await listUsbCameras()
    setAvailable(found.filter((info) => !controllerRef.current?.getCameras().some((c) => c.id === info.deviceId)))
  }, [])

  useEffect(() => onDeviceChange(() => void refreshAvailable()), [refreshAvailable])

  const openPicker = useCallback(async () => {
    await refreshAvailable()
    setShowPicker(true)
  }, [refreshAvailable])

  const addCamera = useCallback(
    async (info: UsbCameraInfo) => {
      setShowPicker(false)
      const controller = controllerRef.current
      if (!controller || !settings) return
      await controller.addUsbCamera(info.deviceId, info.label)
      const updated = await window.api.invoke('settings:set', {
        cameras: [...settings.cameras, { id: info.deviceId, kind: 'usb' as const, label: info.label }],
        primaryCameraId: settings.primaryCameraId ?? info.deviceId
      })
      setSettings(updated)
      controller.updateSettings(updated)
    },
    [settings]
  )

  const removeCamera = useCallback(
    async (id: string) => {
      controllerRef.current?.removeCamera(id)
      if (!settings) return
      const remaining = settings.cameras.filter((camera) => camera.id !== id)
      const updated = await window.api.invoke('settings:set', {
        cameras: remaining,
        primaryCameraId:
          settings.primaryCameraId === id ? (remaining[0]?.id ?? null) : settings.primaryCameraId
      })
      setSettings(updated)
      controllerRef.current?.updateSettings(updated)
    },
    [settings]
  )

  const recordNow = useCallback(() => {
    controllerRef.current?.triggerNow('manual')
  }, [])

  // Keyboard: T = trigger (v1 muscle memory), Esc = dismiss replay.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 't' || event.key === 'T') recordNow()
      if (event.key === 'Escape') setReplay(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recordNow])

  const gridColumns = cameras.length <= 1 ? 1 : 2

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 16, gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 18 }}>ReplaySwing</h1>
        <div style={{ flex: 1 }} />
        <button onClick={() => void openPicker()}>Add camera</button>
        <button
          onClick={recordNow}
          disabled={capturing || cameras.every((camera) => camera.state !== 'live')}
          style={{ background: capturing ? '#666' : '#12a15c', color: '#fff', padding: '8px 20px', borderRadius: 6, border: 'none' }}
        >
          {capturing ? 'Recording…' : 'Record now (T)'}
        </button>
      </header>

      {cameras.length === 0 ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
          <p>No cameras yet — click “Add camera” to get started.</p>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: `repeat(${gridColumns}, 1fr)`,
            gap: 12,
            alignContent: 'start'
          }}
        >
          {cameras.map((camera) => (
            <div key={camera.id} style={{ position: 'relative' }}>
              <CameraTile camera={camera} />
              <button
                onClick={() => void removeCamera(camera.id)}
                title="Remove camera"
                style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {showPicker && (
        <div
          onClick={() => setShowPicker(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'grid', placeItems: 'center' }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ background: '#161a17', borderRadius: 12, padding: 24, minWidth: 360 }}
          >
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Add a camera</h2>
            {available.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>No unused cameras found.</p>
            ) : (
              available.map((info) => (
                <button
                  key={info.deviceId}
                  onClick={() => void addCamera(info)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 6, background: '#22271f', color: 'inherit', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                >
                  {info.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {replay && (
        <div
          onClick={() => setReplay(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'grid', placeItems: 'center' }}
        >
          <div style={{ textAlign: 'center' }}>
            <video src={replay.url} autoPlay loop muted playsInline style={{ maxWidth: '80vw', maxHeight: '80vh', borderRadius: 8 }} />
            <p style={{ color: 'var(--muted)', marginTop: 8 }}>
              Saved {replay.meta.file} — click anywhere or press Esc to dismiss
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
