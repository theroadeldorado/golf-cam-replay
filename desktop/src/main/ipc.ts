import { app, ipcMain, BrowserWindow, dialog } from 'electron'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EventChannel, EventChannels, InvokeChannel, InvokeChannels } from '@shared/ipc-contract'
import type { SettingsStore } from './settings-store'
import type { WindowRegistry } from './windows'
import { deleteClip, listSessions, pinClip, readClipFile, readClips } from './clip-store'
import { ClipWriter } from './clip-writer'
import { ShareServer } from './share-server'
import { golfDir } from './paths'
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
    webBaseUrl: process.env['REPLAYSWING_WEB_BASE'] ?? 'https://www.replayswing.com',
    disablePresence: !!process.env['REPLAYSWING_DISABLE_PRESENCE']
  }))
  handle('settings:get', () => store.get())
  handle('settings:set', (_sender, patch) => {
    const updated = store.set(patch)
    broadcast('settings:changed', updated)
    return updated
  })
  handle('session:list', () => listSessions())
  handle('session:clips', (_sender, sessionId) => readClips(sessionId))
  handle('clip:read', (_sender, sessionId, fileName) => readClipFile(sessionId, fileName))

  handle('clip:saveAs', async (senderId, sessionId, fileName) => {
    const source = join(golfDir(), sessionId, fileName)
    // Test seam: skip the native dialog when a destination is pre-set.
    const forced = process.env['REPLAYSWING_SAVEAS_DEST']
    let dest: string | undefined = forced
    if (!dest) {
      const window =
        BrowserWindow.getAllWindows().find((w) => w.webContents.id === senderId) ??
        BrowserWindow.getAllWindows()[0]
      const result = await dialog.showSaveDialog(window, {
        defaultPath: fileName,
        filters: [{ name: 'Video', extensions: ['mp4'] }]
      })
      if (result.canceled || !result.filePath) return null
      dest = result.filePath
    }
    copyFileSync(source, dest)
    log.info(`Saved ${fileName} to ${dest}`)
    return dest
  })

  const shareServer = new ShareServer(golfDir())
  handle('clip:share', (_sender, sessionId, fileName, label) =>
    shareServer.share(sessionId, fileName, label)
  )
  handle('share:stop', () => shareServer.stop())
  app.on('will-quit', () => void shareServer.stop())
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
