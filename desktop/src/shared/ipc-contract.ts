import type { ClipMeta, SaveClipRequest, SessionInfo, Settings } from './types'

/** Request/response channels handled in main via ipcMain.handle. */
export interface InvokeChannels {
  'app:version': { args: []; result: string }
  /** Runtime config: signaling/camera-page base URL (env-overridable for tests). */
  'app:config': { args: []; result: { webBaseUrl: string } }
  /** Read a bundled renderer asset (MediaPipe model/wasm) as bytes for blob loading. */
  'asset:read': { args: [name: string]; result: ArrayBuffer }
  'settings:get': { args: []; result: Settings }
  'settings:set': { args: [patch: Partial<Settings>]; result: Settings }
  'session:list': { args: []; result: SessionInfo[] }
  'session:clips': { args: [sessionId: string]; result: ClipMeta[] }
  /** Read a clip's MP4 bytes for blob playback. */
  'clip:read': { args: [sessionId: string, fileName: string]; result: ArrayBuffer }
  /** Copy a clip to a user-chosen path. Resolves to the path, or null if cancelled. */
  'clip:saveAs': { args: [sessionId: string, fileName: string]; result: string | null }
  /** Share a clip over the LAN; starts the server if needed. Returns the landing URL. */
  'clip:share': { args: [sessionId: string, fileName: string, label: string]; result: { url: string } }
  /** Tear down the share server. */
  'share:stop': { args: []; result: void }
  /** The session this run is writing into (null until the first clip saves). */
  'session:current': { args: []; result: string | null }
  'clip:save': { args: [request: SaveClipRequest]; result: ClipMeta }
  'clip:pin': { args: [sessionId: string, index: number, pinned: boolean]; result: ClipMeta[] }
  'clip:delete': { args: [sessionId: string, index: number]; result: ClipMeta[] }
  /** Toggle the always-on-top PiP window. Resolves with its visibility. */
  'pip:toggle': { args: []; result: boolean }
  /** Relay a WebRTC loopback signaling message to the other window. */
  'pip:signal': { args: [payload: unknown]; result: void }
  /** Get the current effective shots directory path. */
  'dataDir:get': { args: []; result: string }
  /** Open a native folder picker, save the chosen directory, return its path (null if cancelled). */
  'dataDir:choose': { args: []; result: string | null }
  /** Spike/diagnostic mode only: persist a produced file to the temp dir, returns its path. */
  'spike:save-temp': { args: [fileName: string, data: ArrayBuffer]; result: string }
  /** Spike/diagnostic mode only: deliver the JSON result; main prints it and exits. */
  'spike:report': { args: [report: unknown]; result: void }
  /** Spike/diagnostic mode only: relay a message to the other spike window. */
  'spike:relay': { args: [payload: unknown]; result: void }
}

/** One-way main → renderer events. */
export interface EventChannels {
  'settings:changed': Settings
  /** WebRTC loopback signaling relayed from the other window (PiP ↔ main). */
  'pip:signal': unknown
  /** PiP window opened (main renderer should start the loopback offer) or closed. */
  'pip:visibility': boolean
  /** Spike/diagnostic mode only: message relayed from the other spike window. */
  'spike:message': unknown
}

export type InvokeChannel = keyof InvokeChannels
export type EventChannel = keyof EventChannels

/** The API surface preload exposes as window.api in every renderer. */
export interface RendererApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeChannels[C]['args']
  ): Promise<InvokeChannels[C]['result']>
  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on<C extends EventChannel>(channel: C, listener: (payload: EventChannels[C]) => void): () => void
}
