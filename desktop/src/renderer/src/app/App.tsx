import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipMeta, SessionInfo, Settings } from '@shared/types'
import { CaptureController, type ActiveCamera } from '../capture/capture-controller'
import { listUsbCameras, onDeviceChange, type UsbCameraInfo } from '../cameras/usb'
import { PhoneCameraSource } from '../cameras/phone-source'
import type { AudioSampleEvent } from '../trigger/audio-trigger'
import type { SwingTriggerEvent } from '../trigger/swing-trigger'
import type { PresenceStatus, BodyVisibility } from '../trigger/presence-gate'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { SkeletonOverlay } from '../ui/SkeletonOverlay'
import { ProgramBus } from '../playback/program-bus'
import { PairingDialog, type PairingInfo } from '../ui/PairingDialog'
import { ShareDialog, type ShareInfo } from '../ui/ShareDialog'
import { ComparisonModal, type CompareOption } from '../compare/ComparisonModal'
import { Rail } from '../ui/Rail'
import { SettingsSheet } from '../ui/SettingsSheet'
import { FeedbackDialog } from '../ui/FeedbackDialog'
import { DrawingOverlay, type DrawTool } from '../drawing/DrawingOverlay'
import { DrawToolbar } from '../drawing/DrawToolbar'
import { SHAPE_COLORS, type Shape } from '../drawing/shapes'
import QRCode from 'qrcode'

type TallyState = 'off' | 'watching' | 'capturing'

const STATE_WORD: Record<TallyState, string> = {
  off: 'Standby',
  watching: 'Listening',
  capturing: 'Capture'
}

interface ReplayCamera {
  cameraId: string
  label: string
  url: string
}

interface ReplayInfo {
  cameras: ReplayCamera[]
  label: string
  objectUrl: boolean
  primaryCameraId: string | null
  sessionId: string
  fileName: string
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
  drawings,
  draw,
  drawSelection,
  onDrawSelect,
  onShapesChange,
  onDismiss,
  onShare,
  onSave
}: {
  replay: ReplayInfo
  drawings: Record<string, Shape[]>
  draw: DrawState
  drawSelection: DrawSelection | null
  onDrawSelect: (sel: DrawSelection | null) => void
  onShapesChange: (cameraId: string, shapes: Shape[], commit: boolean) => void
  onDismiss: () => void
  onShare: () => void
  onSave: () => void
}): React.JSX.Element {
  const videoRefsMap = useRef(new Map<string, { current: HTMLVideoElement | null }>())
  const masterRef = useRef<HTMLVideoElement | null>(null)
  const [speed, setSpeed] = useState(1)

  function getVideoRef(cameraId: string): { current: HTMLVideoElement | null } {
    let ref = videoRefsMap.current.get(cameraId)
    if (!ref) {
      ref = { current: null }
      videoRefsMap.current.set(cameraId, ref)
    }
    return ref
  }

  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const master = masterRef.current
      if (!master) return
      for (const [, ref] of videoRefsMap.current) {
        const video = ref.current
        if (video && video !== master && master.duration) {
          if (Math.abs(video.currentTime - master.currentTime) > 0.05) {
            video.currentTime = master.currentTime
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    for (const [, ref] of videoRefsMap.current) {
      if (ref.current) ref.current.playbackRate = speed
    }
  }, [speed])

  const gridColumns = replay.cameras.length <= 1 ? 1 : 2

  return (
    <div className="replay-stage">
      <div
        className="camera-grid replay-grid"
        style={{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }}
      >
        {replay.cameras.map((cam) => {
          const ref = getVideoRef(cam.cameraId)
          return (
            <div key={cam.cameraId} className="camera-tile replay-tile">
              <video
                ref={(el) => {
                  ref.current = el
                  if (cam.cameraId === replay.primaryCameraId) masterRef.current = el
                  else if (!replay.primaryCameraId && replay.cameras[0]?.cameraId === cam.cameraId) masterRef.current = el
                }}
                src={cam.url}
                autoPlay
                loop
                muted
                playsInline
              />
              <DrawingOverlay
                shapes={drawings[cam.cameraId] ?? []}
                active={draw.active}
                tool={draw.tool}
                color={draw.color}
                videoRef={ref}
                selectedId={drawSelection?.cameraId === cam.cameraId ? drawSelection.shapeId : null}
                onSelect={(id) => onDrawSelect(id ? { cameraId: cam.cameraId, shapeId: id } : null)}
                onChange={(shapes, commit) => onShapesChange(cam.cameraId, shapes, commit)}
              />
              <span className="tag">{cam.label}</span>
            </div>
          )
        })}
      </div>
      <div className="replay-caption">
        <strong>{replay.label}</strong>
        <label className="speed-control" title="Playback speed">
          <span data-testid="replay-speed">{speed === 1 ? '1×' : `${speed.toFixed(2)}×`}</span>
          <input
            data-testid="replay-speed-slider"
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>
        <div style={{ flex: 1 }} />
        <button data-testid="share-clip" onClick={onShare}>
          Share
        </button>
        <button data-testid="save-clip" onClick={onSave}>
          Save
        </button>
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
  onShapesChange,
  phoneQr,
  zoom,
  rotation,
  mirror,
  onZoom,
  onRotate,
  onMirror,
  landmarks,
  onVideoRef
}: {
  camera: ActiveCamera
  onRemove: () => void
  shapes: Shape[]
  draw: DrawState
  selectedId: string | null
  onSelect: (id: string | null) => void
  onShapesChange: (shapes: Shape[], commit: boolean) => void
  phoneQr?: { qrDataUrl: string; url: string }
  zoom: number
  rotation: number
  mirror: boolean
  onZoom: (delta: number) => void
  onRotate: () => void
  onMirror: () => void
  landmarks?: NormalizedLandmark[] | null
  onVideoRef?: (el: HTMLVideoElement | null) => void
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (videoRef.current && camera.stream) videoRef.current.srcObject = camera.stream
  }, [camera.stream])

  useEffect(() => {
    onVideoRef?.(videoRef.current)
  }, [camera.stream, onVideoRef])

  const isPhoneWaiting = camera.kind === 'phone' && camera.state === 'connecting' && phoneQr
  const hasTransform = zoom !== 1 || rotation !== 0 || mirror
  const transform = hasTransform
    ? `${mirror ? 'scaleX(-1) ' : ''}scale(${zoom}) rotate(${rotation}deg)`
    : undefined

  return (
    <div className="camera-tile">
      {isPhoneWaiting ? (
        <div className="phone-waiting">
          <img
            src={phoneQr.qrDataUrl}
            alt="Scan to connect"
            style={{ width: 160, height: 160, borderRadius: 8, background: '#fff' }}
          />
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 4px', textAlign: 'center' }}>
            Scan or open bookmark
          </p>
          <p style={{
            fontSize: 10, color: 'var(--muted)', wordBreak: 'break-all',
            fontFamily: 'var(--font-mono)', textAlign: 'center', maxWidth: 200
          }}>
            {phoneQr.url}
          </p>
        </div>
      ) : (
        <>
          <video ref={videoRef} autoPlay muted playsInline style={{ transform }} />
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
          {landmarks && <SkeletonOverlay landmarks={landmarks} videoRef={videoRef} mirror={mirror} />}
        </>
      )}
      <span className="tag">
        {camera.label} · {camera.state === 'live' ? `${camera.measuredFps} fps` : camera.state}
        {camera.error ? ` — ${camera.error}` : ''}
      </span>
      <div className="camera-controls">
        <button title="Zoom out" onClick={() => onZoom(-0.25)}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button title="Zoom in" onClick={() => onZoom(0.25)}>+</button>
        <button title="Rotate 90°" onClick={onRotate}>↻</button>
        <button title="Mirror" onClick={onMirror} className={mirror ? 'on' : ''}>⇔</button>
      </div>
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
  const [showFeedback, setShowFeedback] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [armed, setArmed] = useState(false)
  const [audio, setAudio] = useState<AudioSampleEvent | null>(null)
  const [swing, setSwing] = useState<SwingTriggerEvent | null>(null)
  const [replay, setReplay] = useState<ReplayInfo | null>(null)
  const [pairing, setPairing] = useState<PairingInfo | null>(null)
  const [share, setShare] = useState<ShareInfo | null>(null)
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const [draw, setDraw] = useState<DrawState>({ active: false, tool: 'line', color: SHAPE_COLORS[0] })
  const [drawSelection, setDrawSelection] = useState<DrawSelection | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [clips, setClips] = useState<ClipMeta[]>([])
  // Comparison lives in a self-contained modal with a dropdown per pane.
  const [compareOptions, setCompareOptions] = useState<CompareOption[] | null>(null)
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [presence, setPresence] = useState<PresenceStatus | null>(null)
  const [bodyVisibility, setBodyVisibility] = useState<BodyVisibility>('none')
  const [poseLandmarks, setPoseLandmarks] = useState<NormalizedLandmark[] | null>(null)
  const controllerRef = useRef<CaptureController | null>(null)
  const busRef = useRef<ProgramBus | null>(null)
  const phoneSourcesRef = useRef(new Map<string, PhoneCameraSource>())
  const phoneQrUrlsRef = useRef(new Map<string, { qrDataUrl: string; url: string }>())

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
      window.api.on('update:ready', ({ version }) => setUpdateVersion(version))

      const controller = new CaptureController(loaded)
      controllerRef.current = controller
      controller.on('camerasChanged', (list) => {
        setCameras(list)
        bus.setCameras(list)
      })
      controller.on('captureStateChanged', setCapturing)
      controller.on('audioEvent', setAudio)
      controller.on('swingEvent', setSwing)
      controller.on('presenceEvent', (event) => {
        setPresence(event.status)
        setBodyVisibility(event.bodyVisibility)
      })
      controller.on('armedChanged', setArmed)
      controller.on('poseLandmarks', (landmarks, bv) => {
        setPoseLandmarks(landmarks)
        setBodyVisibility(bv)
      })
      controller.on('clipSaved', (meta, cameraMp4s) => {
        const replayCameras = cameraMp4s.map((c) => ({
          cameraId: c.cameraId,
          label: meta.camera_labels[c.cameraId] ?? c.cameraId,
          url: URL.createObjectURL(new Blob([c.mp4], { type: 'video/mp4' }))
        }))
        const primaryCameraId = clipPrimaryCameraId(meta)
        const primaryUrl = replayCameras.find((c) => c.cameraId === primaryCameraId)?.url ?? replayCameras[0]?.url
        void window.api.invoke('session:current').then((sessionId) => {
          setReplay((previous) => {
            if (previous?.objectUrl) {
              for (const cam of previous.cameras) URL.revokeObjectURL(cam.url)
            }
            return {
              cameras: replayCameras,
              label: `Saved ${meta.file}`,
              objectUrl: true,
              primaryCameraId,
              sessionId: sessionId ?? '',
              fileName: meta.file
            }
          })
        })
        if (primaryUrl) bus.setReplayUrl(primaryUrl, primaryCameraId)
        void refreshGallery()
      })

      bus.setDrawings(loaded.drawings)
      for (const camera of loaded.cameras) {
        if (camera.kind === 'usb') void controller.addUsbCamera(camera.id, camera.label)
      }

      const { webBaseUrl } = await window.api.invoke('app:config')
      for (const camera of loaded.cameras) {
        if (camera.kind === 'phone') {
          const source = new PhoneCameraSource(webBaseUrl, {
            onState: () => {},
            onStream: (stream) => {
              controller.attachExternalStream(source.sessionId, camera.label, stream)
            }
          }, camera.id)
          phoneSourcesRef.current.set(source.sessionId, source)
          controller.registerPendingCamera(camera.id, 'phone', camera.label)
          source.start()

          const url = source.cameraPageUrl(webBaseUrl)
          QRCode.toDataURL(url, { margin: 1 }).then((qrDataUrl) => {
            phoneQrUrlsRef.current.set(camera.id, { qrDataUrl, url })
            setCameras((prev) => [...prev])
          })
        }
      }

      if (loaded.autoArm) controller.setAutoArm(true)

      void refreshGallery()
    })()
    return () => {
      disposed = true
      controllerRef.current?.dispose()
      busRef.current?.stop()
      for (const source of phoneSourcesRef.current.values()) source.stop()
      phoneSourcesRef.current.clear()
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
        if (state === 'connected') {
          const current = controllerRef.current?.getCameras() ?? []
          if (!current.some((c) => c.id === source.sessionId && c.state === 'live')) return
          window.api.invoke('settings:get').then((latest) => {
            if (latest.cameras.some((c) => c.id === source.sessionId)) return
            const updated = window.api.invoke('settings:set', {
              cameras: [...latest.cameras, { id: source.sessionId, kind: 'phone' as const, label: 'Phone' }],
              primaryCameraId: latest.primaryCameraId ?? source.sessionId
            })
            updated.then((s) => {
              setSettings(s)
              controllerRef.current?.updateSettings(s)
            })
          })
          setTimeout(() => setPairing(null), 600)
        }
      },
      onStream: (stream) => {
        controllerRef.current?.attachExternalStream(source.sessionId, 'Phone', stream)
      }
    })
    phoneSourcesRef.current.set(source.sessionId, source)
    source.start()
    const url = source.cameraPageUrl(webBaseUrl)
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1 })
    phoneQrUrlsRef.current.set(source.sessionId, { qrDataUrl, url })
    setPairing({ qrDataUrl, url, state: 'waiting' })
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

  const updateCameraConfig = useCallback(
    (cameraId: string, patch: Partial<import('@shared/types').CameraConfig>) => {
      setSettings((previous) => {
        if (!previous) return previous
        const cameras = previous.cameras.map((c) =>
          c.id === cameraId ? { ...c, ...patch } : c
        )
        void window.api.invoke('settings:set', { cameras })
        return { ...previous, cameras }
      })
    },
    []
  )

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

  const applySettings = useCallback(
    async (patch: Partial<Settings>) => {
      const updated = await window.api.invoke('settings:set', patch)
      setSettings(updated)
      const controller = controllerRef.current
      controller?.updateSettings(updated)
      if ('autoArm' in patch) controller?.setAutoArm(updated.autoArm)
      const rearmKeys: (keyof Settings)[] = ['triggerMode', 'micDeviceId']
      if (rearmKeys.some((k) => k in patch) && controller?.isArmed) {
        controller.setArmed(false)
        controller.setArmed(true)
      }
    },
    []
  )

  const recordNow = useCallback(() => {
    controllerRef.current?.triggerNow('manual')
  }, [])

  const toggleArmed = useCallback(() => {
    setArmed((current) => {
      const next = !current
      controllerRef.current?.setArmed(next)
      if (!next) setAudio(null)
      return next
    })
  }, [])

  const dismissReplay = useCallback(() => {
    setReplay((previous) => {
      if (previous?.objectUrl) {
        for (const cam of previous.cameras) URL.revokeObjectURL(cam.url)
      }
      return null
    })
    busRef.current?.setReplayUrl(null)
  }, [])

  const shareClip = useCallback(async (info: ReplayInfo) => {
    if (!info.sessionId) return
    const { url } = await window.api.invoke('clip:share', info.sessionId, info.fileName, info.label)
    setShare({ url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1 }) })
  }, [])

  const stopSharing = useCallback(() => {
    void window.api.invoke('share:stop')
    setShare(null)
  }, [])

  const saveClip = useCallback(async (info: ReplayInfo) => {
    if (!info.sessionId) return
    const dest = await window.api.invoke('clip:saveAs', info.sessionId, info.fileName)
    if (dest) {
      setSaveNote(`Saved to ${dest}`)
      setTimeout(() => setSaveNote(null), 4000)
    }
  }, [])

  const playClip = useCallback(
    async (clip: ClipMeta) => {
      if (!selectedSession) return
      const primaryCameraId = clipPrimaryCameraId(clip)
      const replayCameras: ReplayCamera[] = []
      for (const [camId, fileName] of Object.entries(clip.camera_files)) {
        const bytes = await window.api.invoke('clip:read', selectedSession, fileName)
        replayCameras.push({
          cameraId: camId,
          label: clip.camera_labels[camId] ?? camId,
          url: URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
        })
      }
      const primaryUrl = replayCameras.find((c) => c.cameraId === primaryCameraId)?.url ?? replayCameras[0]?.url
      setReplay((previous) => {
        if (previous?.objectUrl) {
          for (const cam of previous.cameras) URL.revokeObjectURL(cam.url)
        }
        return {
          cameras: replayCameras,
          label: clip.file,
          objectUrl: true,
          primaryCameraId,
          sessionId: selectedSession,
          fileName: clip.file
        }
      })
      if (primaryUrl) busRef.current?.setReplayUrl(primaryUrl, primaryCameraId)
    },
    [selectedSession]
  )

  // Open the comparison modal: flatten every session's clips into a single
  // newest-first list of dropdown options.
  const openCompare = useCallback(async () => {
    const sessionList = await window.api.invoke('session:list')
    const options: CompareOption[] = []
    for (const session of sessionList) {
      const sessionClips = await window.api.invoke('session:clips', session.id)
      for (const clip of sessionClips) {
        for (const [cameraId, fileName] of Object.entries(clip.camera_files)) {
          options.push({
            sessionId: session.id,
            clip,
            cameraId,
            cameraLabel: clip.camera_labels[cameraId] ?? cameraId,
            fileName
          })
        }
      }
    }
    setCompareOptions(options)
  }, [])

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
    : armed && (audio?.state === 'listening' || swing?.state === 'idle' || swing?.state === 'address' || swing?.state === 'swinging')
      ? 'watching'
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
        <button data-testid="compare-start" onClick={() => void openCompare()} title="Compare two swings">
          Compare
        </button>
        <button onClick={() => setShowFeedback(true)} title="Submit feedback">
          Feedback
        </button>
        <button onClick={() => setShowSettings(true)} title="Settings">
          ⚙
        </button>
      </header>

      {updateVersion && (
        <div className="update-banner">
          <span>Version {updateVersion} is ready</span>
          <button onClick={() => void window.api.invoke('update:install')}>Restart &amp; update</button>
          <button className="dismiss" onClick={() => setUpdateVersion(null)}>Later</button>
        </div>
      )}

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
              drawings={settings?.drawings ?? {}}
              draw={draw}
              drawSelection={drawSelection}
              onDrawSelect={setDrawSelection}
              onShapesChange={updateDrawings}
              onDismiss={dismissReplay}
              onShare={() => void shareClip(replay)}
              onSave={() => void saveClip(replay)}
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
              {cameras.map((camera) => {
                const config = settings?.cameras.find((c) => c.id === camera.id)
                const isPrimary = camera.id === (settings?.primaryCameraId ?? cameras[0]?.id)
                return (
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
                    phoneQr={phoneQrUrlsRef.current.get(camera.id)}
                    zoom={config?.zoom ?? 1}
                    rotation={config?.rotation ?? 0}
                    mirror={config?.mirror ?? false}
                    onZoom={(delta) => {
                      const current = config?.zoom ?? 1
                      updateCameraConfig(camera.id, { zoom: Math.max(0.5, Math.min(4, current + delta)) })
                    }}
                    onRotate={() => {
                      const current = config?.rotation ?? 0
                      updateCameraConfig(camera.id, { rotation: (current + 90) % 360 })
                    }}
                    onMirror={() => {
                      updateCameraConfig(camera.id, { mirror: !(config?.mirror ?? false) })
                    }}
                    landmarks={isPrimary && settings?.autoArm && settings?.showSkeleton ? poseLandmarks : undefined}
                    onVideoRef={isPrimary ? (el) => {
                      if (el) controllerRef.current?.bindPresenceVideo(el)
                    } : undefined}
                  />
                )
              })}
            </div>
          )}
        </div>

        <Rail
          sessions={sessions}
          selectedSession={selectedSession}
          clips={clips}
          activeFile={replay?.fileName ?? null}
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
        {armed && settings?.triggerMode === 'audio' && audio && !audio.error && (
          <>
            <div className="meter" style={{ position: 'relative' }}>
              <div
                style={{
                  width: `${Math.min(100, audio.level * 500)}%`,
                  background: audio.level >= audio.threshold
                    ? 'var(--lock)'
                    : 'var(--watch)'
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: `${Math.min(100, audio.threshold * 500)}%`,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: 'var(--text)',
                  opacity: 0.6
                }}
                title="Threshold"
              />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {audio.level.toFixed(3)} / {audio.threshold.toFixed(3)}
              {audio.peak > 0 ? ` pk:${audio.peak.toFixed(3)}` : ''}
            </span>
          </>
        )}
        {armed && settings?.triggerMode === 'audio' && (!audio || audio.error) && (
          <span style={{ fontSize: 12, color: 'var(--error, #e55)' }}>
            {audio?.error ?? 'Opening mic…'}
          </span>
        )}
        {armed && settings?.triggerMode === 'hybrid' && swing && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: swing.state === 'swinging' ? 'var(--lock)' : swing.state === 'address' ? 'var(--watch)' : 'var(--muted)'
          }}>
            {swing.state === 'idle' ? 'Waiting for stillness…'
              : swing.state === 'address' ? 'At address — watching for swing'
              : swing.state === 'swinging' ? 'Swing detected — listening for impact…'
              : 'Cooldown'}
          </span>
        )}
        {settings?.autoArm && presence && (
          <span className={`presence-indicator presence-${presence}`} title={`Person: ${presence}`}>
            {presence === 'present' || presence === 'leaving' ? '🧍' : presence === 'entering' ? '🧍' : presence === 'loading' ? '⏳' : presence === 'error' ? '⚠' : '👤'}
          </span>
        )}
        {settings?.autoArm && bodyVisibility === 'partial' && presence !== 'present' && presence !== 'loading' && (
          <span className="framing-hint">Adjust camera to show full body</span>
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

      {compareOptions && (
        <ComparisonModal options={compareOptions} onClose={() => setCompareOptions(null)} />
      )}

      {share && <ShareDialog share={share} onStop={stopSharing} onClose={() => setShare(null)} />}

      {saveNote && (
        <div
          style={{
            position: 'fixed',
            bottom: 90,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--panel-raised)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '10px 16px',
            fontSize: 13,
            zIndex: 40
          }}
        >
          {saveNote}
        </div>
      )}

      {showSettings && settings && (
        <SettingsSheet
          settings={settings}
          cameras={cameras}
          onChange={(patch) => void applySettings(patch)}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showFeedback && <FeedbackDialog onClose={() => setShowFeedback(false)} />}
    </>
  )
}
