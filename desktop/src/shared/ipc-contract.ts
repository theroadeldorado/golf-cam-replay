import type { ClipMeta, SaveClipRequest, SessionInfo, Settings } from './types'

/** Request/response channels handled in main via ipcMain.handle. */
export interface InvokeChannels {
  'app:version': { args: []; result: string }
  /** Runtime config: signaling/camera-page base URL (env-overridable for tests). */
  'app:config': { args: []; result: { webBaseUrl: string } }
  'settings:get': { args: []; result: Settings }
  'settings:set': { args: [patch: Partial<Settings>]; result: Settings }
  'session:list': { args: []; result: SessionInfo[] }
  'session:clips': { args: [sessionId: string]; result: ClipMeta[] }
  'clip:save': { args: [request: SaveClipRequest]; result: ClipMeta }
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
