/** Structural shape of MediaPipe's WasmFileset (the type isn't exported). */
export interface MediapipeFileset {
  wasmLoaderPath: string
  wasmBinaryPath: string
}

/**
 * Loads MediaPipe's runtime from bundled files via blob URLs.
 *
 * The app runs on file://, where MediaPipe's own fetch() of its wasm/model is
 * blocked, and serving them over a custom scheme would change the app's origin
 * (breaking cross-origin signaling, camera permissions, etc.). So instead the
 * main process reads the bundled files (asset:read IPC) and the renderer wraps
 * them in same-origin blob URLs, which MediaPipe loads happily.
 */

/** Read a bundled renderer asset as bytes. */
export async function readAssetBytes(name: string): Promise<ArrayBuffer> {
  return window.api.invoke('asset:read', name)
}

/** Build a fileset from the bundled SIMD wasm runtime. */
export async function loadMediapipeFileset(): Promise<MediapipeFileset> {
  const [loader, wasm] = await Promise.all([
    readAssetBytes('mediapipe/wasm/vision_wasm_internal.js'),
    readAssetBytes('mediapipe/wasm/vision_wasm_internal.wasm')
  ])
  return {
    wasmLoaderPath: URL.createObjectURL(new Blob([loader], { type: 'text/javascript' })),
    wasmBinaryPath: URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }))
  }
}
