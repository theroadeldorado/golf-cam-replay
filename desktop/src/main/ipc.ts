import { ipcMain, BrowserWindow } from 'electron'
import type { EventChannel, EventChannels, InvokeChannel, InvokeChannels } from '@shared/ipc-contract'
import type { SettingsStore } from './settings-store'
import { listSessions, readClips } from './clip-store'
import { ClipWriter } from './clip-writer'
import { log } from './logging'

function handle<C extends InvokeChannel>(
  channel: C,
  handler: (...args: InvokeChannels[C]['args']) => InvokeChannels[C]['result'] | Promise<InvokeChannels[C]['result']>
): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as InvokeChannels[C]['args'])))
}

export function broadcast<C extends EventChannel>(channel: C, payload: EventChannels[C]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

export function registerIpc(store: SettingsStore): void {
  handle('app:version', () => __APP_VERSION__)
  handle('settings:get', () => store.get())
  handle('settings:set', (patch) => {
    const updated = store.set(patch)
    broadcast('settings:changed', updated)
    return updated
  })
  handle('session:list', () => listSessions())
  handle('session:clips', (sessionId) => readClips(sessionId))

  const clipWriter = new ClipWriter((message) => log.info(message))
  handle('clip:save', (request) => clipWriter.saveClip(request))
}
