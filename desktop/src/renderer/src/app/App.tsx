import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipMeta, SessionInfo, Settings } from '@shared/types'
import { CaptureController, type ActiveCamera } from '../capture/capture-controller'
import { listUsbCameras, onDeviceChange, type UsbCameraInfo } from '../cameras/usb'
import { PhoneCameraSource } from '../cameras/phone-source'
import type { VisionSampleEvent } from '../trigger/vision-trigger'
import { ProgramBus } from '../playback/program-bus'
import { PairingDialog, type PairingInfo } from '../ui/PairingDialog'
import { Rail } from '../ui/Rail'
import { SettingsSheet } from '../ui/SettingsSheet'
import { DrawingOverlay, type DrawTool } from '../drawing/DrawingOverlay'
import { DrawToolbar } from '../drawing/DrawToolbar'
import { SHAPE_COLORS, type Shape } from '../drawing/shapes'
import QRCode from 'qrcode'

type TallyState = 'off' | 'watching' | 'address' | 'capturing'

const STATE_WORD: Record<TallyState, string> = {
  off: 'Standby',
  watching: 'Watching',
  address: 'Set',
  capturing: 'Capture'
}

interface ReplayInfo {
  url: string
  label: string
  /** Object URLs need revoking; clip:// URLs don't. */
  objectUrl: boolean
  /** Which camera's footage this is — binds the replay to that camera's drawings. */
  cameraId: string | null
}

interface DrawState {
  active: boolean
  tool: DrawTool
  color: string
}

interface DrawSelection {
  cameraId: string
  shapeId: string
}

/** The camera whose file is the clip's primary MP4. */
function clipPrimaryCameraId(meta: ClipMeta): string | null {
  return Object.entries(meta.camera_files).find(([, file]) => file === meta.file)?.[0] ?? null
}

function ReplayStage({
  replay,
  shapes,
  draw,
  selectedId,
  onSelect,
  onShapesChange,
  onDismiss
}: {
  replay: ReplayInfo
  shapes: Shape[]
  draw: DrawState
  selectedId: string | null
  onSelect: (id: string | null) => void
  onShapesChange: (shapes: Shape[], commit: boolean) => void
  onDismiss: () => void
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)

  return (
    <div className="replay-stage">
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
        <video ref={videoRef} src={replay.url} autoPlay loop muted playsInline />
        <DrawingOverlay
          shapes={shapes}
          active={draw.active}
          tool={draw.tool}
          color={draw.color}
          videoRef={videoRef}
          selectedId={selectedId}
          onSelect={onSelect}
          onChange={onShapesChange}
        />
      </div>
      <div className="replay-caption">
        <strong>{replay.label}</strong>
        <span>looping — Esc or Back to live</span>
        <div style={{ flex: 1 }} />
        <button onClick={onDismiss}>Back to live</button>
      </div>
    </div>
  )
}

function CameraTile({
  camera,
  onRemove,
  shapes,
  draw,
  selectedId,
  onSelect,
  onShapesChange
}: {
  camera: ActiveCamera
  onRemove: () => void
  shapes: Shape[]
  draw: DrawState
  selectedId: string | null
  onSelect: (id: string | null) => void
  onShapesChange: (shapes: Shape[], commit: boolean) => void
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (videoRef.current && camera.stream) videoRef.current.srcObject = camera.stream
  }, [camera.stream])

  return (
    <div className="camera-tile">
      <video ref={videoRef} autoPlay muted playsInline />
      <DrawingOverlay
        shapes={shapes}
        active={draw.active}
        tool={draw.tool}
        color={draw.color}
        videoRef={videoRef}
        selectedId={selectedId}
        onSelect={onSelect}
        onChange={onShapesChange}
      />
      <span className="tag">
        {camera.label} · {camera.state === 'live' ? `${camera.measuredFps} fps` : camera.state}
        {camera.error ? ` — ${camera.error}` : ''}
      </span>
      <button className="remove" title="Remove camera" onClick={onRemove}>
        ✕
      </button>
    </div>
  )
}

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [cameras, setCameras] = useState<ActiveCamera[]>([])
  const [available, setAvailable] = useState<UsbCameraInfo[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [armed, setArmed] = useState(false)
  const [vision, setVision] = useState<VisionSampleEvent | null>(null)
  const [replay, setReplay] = useState<ReplayInfo | null>(null)
  const [pairing, setPairing] = useState<PairingInfo | null>(null)
  const [draw, setDraw] = useState<DrawState>({ active: false, tool: 'line', color: SHAPE_COLORS[0] })
  const [drawSelection, setDrawSelection] = useState<DrawSelection | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [clips, setClips] = useState<ClipMeta[]>([])
  const controllerRef = useRef<CaptureController | null>(null)
  const busRef = useRef<ProgramBus | null>(null)
  const phoneSourcesRef = useRef(new Map<string, PhoneCameraSource>())

  const refreshGallery = useCallback(async (preferSession?: string) => {
    const list = await window.api.invoke('session:list')
    setSessions(list)
    const target = preferSession ?? (await window.api.invoke('session:current')) ?? list[0]?.id ?? null
    setSelectedSession(target)
    setClips(target ? await window.api.invoke('session:clips', target) : [])
  }, [])

  // Boot: settings → controller + program bus → reopen saved cameras → gallery.
  useEffect(() => {
    let disposed = false
    void (async () => {
      const loaded = await window.api.invoke('settings:get')
      if (disposed) return
      setSettings(loaded)

      const bus = new ProgramBus()
      busRef.current = bus
      window.api.on('pip:visibility', (visible) => {
        if (visible) void bus.start()
        else bus.stop()
      })

      const controller = new CaptureController(loaded)
      controllerRef.current = controller
      controller.on('camerasChanged', (list) => {
        setCameras(list)
        bus.setCameras(list)
      })
      controller.on('captureStateChanged', setCapturing)
      controller.on('visionEvent', setVision)
      controller.on('clipSaved', (meta, primaryMp4) => {
        const url = URL.createObjectURL(new Blob([primaryMp4], { type: 'video/mp4' }))
        const cameraId = clipPrimaryCameraId(meta)
        setReplay((previous) => {
          if (previous?.objectUrl) URL.revokeObjectURL(previous.url)
          return { url, label: `Saved ${meta.file}`, objectUrl: true, cameraId }
        })
        bus.setReplayUrl(url, cameraId)
        void refreshGallery()
      })

      bus.setDrawings(loaded.drawings)
      for (const camera of loaded.cameras) {
        if (camera.kind === 'usb') void controller.addUsbCamera(camera.id, camera.label)
      }
      void refreshGallery()
    })()
    return () => {
      disposed = true
      controllerRef.current?.dispose()
      busRef.current?.stop()
    }
  }, [refreshGallery])

  const refreshAvailable = useCallback(async () => {
    const found = await listUsbCameras()
    setAvailable(
      found.filter((info) => !controllerRef.current?.getCameras().some((c) => c.id === info.deviceId))
    )
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

  const addPhone = useCallback(async () => {
    const { webBaseUrl } = await window.api.invoke('app:config')
    const source = new PhoneCameraSource(webBaseUrl, {
      onState: (state) => {
        setPairing((current) => (current ? { ...current, state } : current))
        if (state === 'connected') setTimeout(() => setPairing(null), 600)
      },
      onStream: (stream) => {
        controllerRef.current?.attachExternalStream(source.sessionId, 'Phone', stream)
      }
    })
    phoneSourcesRef.current.set(source.sessionId, source)
    source.start()
    const url = source.cameraPageUrl(webBaseUrl)
    setPairing({ qrDataUrl: await QRCode.toDataURL(url, { margin: 1 }), url, state: 'waiting' })
  }, [])

  const cancelPairing = useCallback(() => {
    for (const [id, source] of phoneSourcesRef.current) {
      if (!controllerRef.current?.getCameras().some((camera) => camera.id === id)) {
        source.stop()
        phoneSourcesRef.current.delete(id)
      }
    }
    setPairing(null)
  }, [])

  const removeCamera = useCallback(
    async (id: string) => {
      phoneSourcesRef.current.get(id)?.stop()
      phoneSourcesRef.current.delete(id)
      controllerRef.current?.removeCamera(id)
      if (!settings) return
      const remaining = settings.cameras.filter((camera) => camera.id !== id)
      const { [id]: _removed, ...drawings } = settings.drawings
      const updated = await window.api.invoke('settings:set', {
        cameras: remaining,
        primaryCameraId:
          settings.primaryCameraId === id ? (remaining[0]?.id ?? null) : settings.primaryCameraId,
        drawings
      })
      setSettings(updated)
      setDrawSelection((sel) => (sel?.cameraId === id ? null : sel))
      controllerRef.current?.updateSettings(updated)
      busRef.current?.setDrawings(updated.drawings)
    },
    [settings]
  )

  /** Update one camera's shape list; persist + sync PiP when the gesture commits. */
  const updateDrawings = useCallback((cameraId: string, shapes: Shape[], commit: boolean) => {
    setSettings((previous) => {
      if (!previous) return previous
      const drawings = { ...previous.drawings, [cameraId]: shapes }
      busRef.current?.setDrawings(drawings)
      if (commit) void window.api.invoke('settings:set', { drawings })
      return { ...previous, drawings }
    })
  }, [])

  const deleteSelectedShape = useCallback(() => {
    if (!drawSelection || !settings) return
    const shapes = (settings.drawings[drawSelection.cameraId] ?? []).filter(
      (shape) => shape.id !== drawSelection.shapeId
    )
    updateDrawings(drawSelection.cameraId, shapes, true)
    setDrawSelection(null)
  }, [drawSelection, settings, updateDrawings])

  const setDrawColor = useCallback(
    (color: string) => {
      setDraw((current) => ({ ...current, color }))
      // Recolor the selection too, like every drawing app.
      if (drawSelection && settings) {
        const shapes = (settings.drawings[drawSelection.cameraId] ?? []).map((shape) =>
          shape.id === drawSelection.shapeId ? { ...shape, color } : shape
        )
        updateDrawings(drawSelection.cameraId, shapes, true)
      }
    },
    [drawSelection, settings, updateDrawings]
  )

  const toggleDraw = useCallback(() => {
    setDraw((current) => ({ ...current, active: !current.active }))
    setDrawSelection(null)
  }, [])

  const applySettings = useCallback(async (patch: Partial<Settings>) => {
    const updated = await window.api.invoke('settings:set', patch)
    setSettings(updated)
    controllerRef.current?.updateSettings(updated)
  }, [])

  const recordNow = useCallback(() => {
    controllerRef.current?.triggerNow('manual')
  }, [])

  const toggleArmed = useCallback(() => {
    setArmed((current) => {
      const next = !current
      controllerRef.current?.setArmed(next)
      if (!next) setVision(null)
      return next
    })
  }, [])

  const dismissReplay = useCallback(() => {
    setReplay((previous) => {
      if (previous?.objectUrl) URL.revokeObjectURL(previous.url)
      return null
    })
    busRef.current?.setReplayUrl(null)
  }, [])

  const playClip = useCallback(
    async (clip: ClipMeta) => {
      if (!selectedSession) return
      const cameraId = clipPrimaryCameraId(clip)
      // Play from an in-memory blob, same proven path as instant replay —
      // <video> can't stream the clip:// protocol reliably.
      const bytes = await window.api.invoke('clip:read', selectedSession, clip.file)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
      setReplay((previous) => {
        if (previous?.objectUrl) URL.revokeObjectURL(previous.url)
        return { url, label: clip.file, objectUrl: true, cameraId }
      })
      busRef.current?.setReplayUrl(url, cameraId)
    },
    [selectedSession]
  )

  // Keyboard: A = arm, T = manual trigger, P = PiP.
  // Esc exits draw mode first, then dismisses the replay. Delete removes the
  // selected shape while drawing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (event.key === 't' || event.key === 'T') recordNow()
      if (event.key === 'a' || event.key === 'A') toggleArmed()
      if (event.key === 'p' || event.key === 'P') void window.api.invoke('pip:toggle')
      if ((event.key === 'Delete' || event.key === 'Backspace') && draw.active) deleteSelectedShape()
      if (event.key === 'Escape') {
        if (draw.active) toggleDraw()
        else dismissReplay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recordNow, toggleArmed, dismissReplay, draw.active, deleteSelectedShape, toggleDraw])

  const tally: TallyState = capturing
    ? 'capturing'
    : armed
      ? vision?.state === 'address'
        ? 'address'
        : 'watching'
      : 'off'

  const anyLive = cameras.some((camera) => camera.state === 'live')
  const gridColumns = cameras.length <= 1 ? 1 : 2

  return (
    <>
      <div className="tally" data-state={tally === 'off' ? undefined : tally} />

      <header className="topbar">
        <span className="brand">
          Replay<em>Swing</em>
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => void openPicker()}>Add camera</button>
        <button onClick={() => void addPhone()}>Add phone</button>
        <button onClick={() => void window.api.invoke('pip:toggle')} title="Overlay window (P)">
          PiP
        </button>
        <button onClick={() => setShowSettings(true)} title="Settings">
          ⚙
        </button>
      </header>

      <div className="main">
        <div className="stage" style={{ position: 'relative' }}>
          {(cameras.length > 0 || replay) && (
            <DrawToolbar
              active={draw.active}
              tool={draw.tool}
              color={draw.color}
              hasSelection={drawSelection !== null}
              onToggle={toggleDraw}
              onTool={(tool) => {
                // Switching to a creation tool deselects, so the next color
                // pick applies to the new shape, not the previous selection.
                if (tool !== 'select') setDrawSelection(null)
                setDraw((current) => ({ ...current, tool }))
              }}
              onColor={setDrawColor}
              onDelete={deleteSelectedShape}
            />
          )}
          {replay ? (
            <ReplayStage
              replay={replay}
              shapes={replay.cameraId ? (settings?.drawings[replay.cameraId] ?? []) : []}
              draw={draw}
              selectedId={drawSelection?.cameraId === replay.cameraId ? drawSelection.shapeId : null}
              onSelect={(id) =>
                setDrawSelection(
                  id && replay.cameraId ? { cameraId: replay.cameraId, shapeId: id } : null
                )
              }
              onShapesChange={(shapes, commit) => {
                if (replay.cameraId) updateDrawings(replay.cameraId, shapes, commit)
              }}
              onDismiss={dismissReplay}
            />
          ) : cameras.length === 0 ? (
            <div className="empty-stage">
              <p>
                No cameras yet.
                <br />
                Add a USB camera or scan a QR with your phone.
              </p>
            </div>
          ) : (
            <div className="camera-grid" style={{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }}>
              {cameras.map((camera) => (
                <CameraTile
                  key={camera.id}
                  camera={camera}
                  onRemove={() => void removeCamera(camera.id)}
                  shapes={settings?.drawings[camera.id] ?? []}
                  draw={draw}
                  selectedId={drawSelection?.cameraId === camera.id ? drawSelection.shapeId : null}
                  onSelect={(id) =>
                    setDrawSelection(id ? { cameraId: camera.id, shapeId: id } : null)
                  }
                  onShapesChange={(shapes, commit) => updateDrawings(camera.id, shapes, commit)}
                />
              ))}
            </div>
          )}
        </div>

        <Rail
          sessions={sessions}
          selectedSession={selectedSession}
          clips={clips}
          onSelectSession={(id) => {
            setSelectedSession(id)
            void window.api.invoke('session:clips', id).then(setClips)
          }}
          onPlay={playClip}
          onPin={(index, pinned) => {
            if (selectedSession) {
              void window.api.invoke('clip:pin', selectedSession, index, pinned).then(setClips)
            }
          }}
          onDelete={(index) => {
            if (selectedSession) {
              void window.api.invoke('clip:delete', selectedSession, index).then(setClips)
            }
          }}
        />
      </div>

      <div className="console">
        <button className="arm-btn" data-armed={armed} onClick={toggleArmed} disabled={!anyLive}>
          {armed ? 'Disarm (A)' : 'Arm (A)'}
        </button>
        <div className="state-word" data-state={tally}>
          {STATE_WORD[tally]}
        </div>
        {armed && vision && (
          <>
            <div className="meter">
              <div
                style={{
                  width: `${Math.min(100, (vision.energy / Math.max(vision.spikeThreshold, 0.01)) * 100)}%`,
                  background: vision.state === 'address' ? 'var(--lock)' : 'var(--watch)'
                }}
              />
            </div>
            <span
              data-testid="vision-state"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}
            >
              {vision.state}
            </span>
          </>
        )}
        <button className="record-btn" onClick={recordNow} disabled={capturing || !anyLive}>
          {capturing ? 'Recording…' : 'Record now (T)'}
        </button>
        <div className="shot-counter">
          <strong>{clips.length}</strong> shots
          <br />
          this session
        </div>
      </div>

      {showPicker && (
        <div className="scrim" onClick={() => setShowPicker(false)}>
          <div className="dialog" onClick={(event) => event.stopPropagation()}>
            <h2>Add a camera</h2>
            {available.length === 0 ? (
              <p className="hint">No unused cameras found. Plug one in and reopen this dialog.</p>
            ) : (
              available.map((info) => (
                <button
                  key={info.deviceId}
                  data-testid="camera-option"
                  className="option-btn"
                  onClick={() => void addCamera(info)}
                >
                  {info.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {pairing && <PairingDialog pairing={pairing} onCancel={cancelPairing} />}

      {showSettings && settings && (
        <SettingsSheet
          settings={settings}
          cameras={cameras}
          onChange={(patch) => void applySettings(patch)}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  )
}
