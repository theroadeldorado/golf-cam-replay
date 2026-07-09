import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import type { SettingsStore } from './settings-store'

const preloadPath = join(__dirname, '../preload/index.js')

function loadRendererPage(window: BrowserWindow, page: 'index' | 'pip'): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${page}.html`)
  } else {
    window.loadFile(join(__dirname, `../renderer/${page}.html`))
  }
}

/** Owns the main + PiP windows and the loopback-signaling relay between them. */
export class WindowRegistry {
  mainWindow: BrowserWindow | null = null
  pipWindow: BrowserWindow | null = null

  constructor(private readonly store: SettingsStore) {}

  createMainWindow(): BrowserWindow {
    const bounds = this.store.get().mainWindowBounds
    const window = new BrowserWindow({
      width: bounds?.width ?? 1280,
      height: bounds?.height ?? 800,
      x: bounds?.x,
      y: bounds?.y,
      minWidth: 960,
      minHeight: 600,
      show: false,
      backgroundColor: '#0b0d0c',
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    window.on('ready-to-show', () => window.show())
    window.on('close', () => {
      const { x, y, width, height } = window.getBounds()
      this.store.set({ mainWindowBounds: { x, y, width, height } })
      this.pipWindow?.close()
    })
    window.on('closed', () => {
      this.mainWindow = null
    })

    window.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    loadRendererPage(window, 'index')
    this.mainWindow = window
    return window
  }

  /** Open/close the PiP overlay. Returns its resulting visibility. */
  togglePip(): boolean {
    if (this.pipWindow) {
      this.pipWindow.close()
      return false
    }

    const bounds = this.store.get().pip.bounds
    const window = new BrowserWindow({
      width: bounds?.width ?? 480,
      height: bounds?.height ?? 270,
      x: bounds?.x,
      y: bounds?.y,
      frame: false,
      alwaysOnTop: true,
      resizable: true,
      skipTaskbar: true,
      backgroundColor: '#000000',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    // 'screen-saver' level floats above fullscreen apps (the simulator).
    window.setAlwaysOnTop(true, 'screen-saver')

    window.on('close', () => {
      const { x, y, width, height } = window.getBounds()
      this.store.set({ pip: { bounds: { x, y, width, height }, visible: false } })
    })
    window.on('closed', () => {
      this.pipWindow = null
      this.mainWindow?.webContents.send('pip:visibility', false)
    })
    window.webContents.on('did-finish-load', () => {
      this.mainWindow?.webContents.send('pip:visibility', true)
    })

    loadRendererPage(window, 'pip')
    this.pipWindow = window
    this.store.set({ pip: { ...this.store.get().pip, visible: true } })
    return true
  }

  /** Relay a loopback signaling message to whichever window didn't send it. */
  relayPipSignal(senderWebContentsId: number, payload: unknown): void {
    const target =
      this.pipWindow?.webContents.id === senderWebContentsId ? this.mainWindow : this.pipWindow
    target?.webContents.send('pip:signal', payload)
  }
}
