import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { EventChannel, EventChannels, InvokeChannel, InvokeChannels, RendererApi } from '@shared/ipc-contract'

const api: RendererApi = {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeChannels[C]['args']
  ): Promise<InvokeChannels[C]['result']> {
    return ipcRenderer.invoke(channel, ...args)
  },

  on<C extends EventChannel>(channel: C, listener: (payload: EventChannels[C]) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: EventChannels[C]): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
