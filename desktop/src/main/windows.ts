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

export function createMainWindow(store: SettingsStore): BrowserWindow {
  const bounds = store.get().mainWindowBounds
  const window = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0c0f0d',
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
    store.set({ mainWindowBounds: { x, y, width, height } })
  })

  // Open external links in the system browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRendererPage(window, 'index')
  return window
}

export function createPipWindow(store: SettingsStore): BrowserWindow {
  const bounds = store.get().pip.bounds
  const window = new BrowserWindow({
    width: bounds?.width ?? 480,
    height: bounds?.height ?? 270,
    x: bounds?.x,
    y: bounds?.y,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.setAlwaysOnTop(true, 'screen-saver')

  window.on('close', () => {
    const { x, y, width, height } = window.getBounds()
    store.set({ pip: { ...store.get().pip, bounds: { x, y, width, height } } })
  })

  loadRendererPage(window, 'pip')
  return window
}
