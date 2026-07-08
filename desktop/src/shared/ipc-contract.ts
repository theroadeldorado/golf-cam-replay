import type { ClipMeta, SessionInfo, Settings } from './types'

/** Request/response channels handled in main via ipcMain.handle. */
export interface InvokeChannels {
  'app:version': { args: []; result: string }
  'settings:get': { args: []; result: Settings }
  'settings:set': { args: [patch: Partial<Settings>]; result: Settings }
  'session:list': { args: []; result: SessionInfo[] }
  'session:clips': { args: [sessionId: string]; result: ClipMeta[] }
}

/** One-way main → renderer events. */
export interface EventChannels {
  'settings:changed': Settings
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
