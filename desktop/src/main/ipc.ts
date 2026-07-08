import { ipcMain, BrowserWindow } from 'electron'
import type { EventChannel, EventChannels, InvokeChannel, InvokeChannels } from '@shared/ipc-contract'
import type { SettingsStore } from './settings-store'
import type { WindowRegistry } from './windows'
import { deleteClip, listSessions, pinClip, readClips } from './clip-store'
import { ClipWriter } from './clip-writer'
import { log } from './logging'

function handle<C extends InvokeChannel>(
  channel: C,
  handler: (
    senderWebContentsId: number,
    ...args: InvokeChannels[C]['args']
  ) => InvokeChannels[C]['result'] | Promise<InvokeChannels[C]['result']>
): void {
  ipcMain.handle(channel, (event, ...args) =>
    handler(event.sender.id, ...(args as InvokeChannels[C]['args']))
  )
}

export function broadcast<C extends EventChannel>(channel: C, payload: EventChannels[C]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

export function registerIpc(store: SettingsStore, windows: WindowRegistry): void {
  handle('app:version', () => __APP_VERSION__)
  handle('app:config', () => ({
    webBaseUrl: process.env['REPLAYSWING_WEB_BASE'] ?? 'https://www.replayswing.com'
  }))
  handle('settings:get', () => store.get())
  handle('settings:set', (_sender, patch) => {
    const updated = store.set(patch)
    broadcast('settings:changed', updated)
    return updated
  })
  handle('session:list', () => listSessions())
  handle('session:clips', (_sender, sessionId) => readClips(sessionId))
  handle('clip:pin', (_sender, sessionId, index, pinned) => pinClip(sessionId, index, pinned))
  handle('clip:delete', (_sender, sessionId, index) => deleteClip(sessionId, index))

  const clipWriter = new ClipWriter((message) => log.info(message))
  handle('clip:save', (_sender, request) => clipWriter.saveClip(request))
  handle('session:current', () => clipWriter.currentSessionId)

  handle('pip:toggle', () => windows.togglePip())
  handle('pip:signal', (senderId, payload) => {
    windows.relayPipSignal(senderId, payload)
  })
}
