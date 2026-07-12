import type { FilesetResolver } from '@mediapipe/tasks-vision'

let cachedFileset: { wasmLoaderPath: string; wasmBinaryPath: string } | null = null

async function readAssetBytes(name: string): Promise<ArrayBuffer> {
  return window.api.invoke('asset:read', name)
}

function toBlobUrl(bytes: ArrayBuffer, mime: string): string {
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

export async function loadMediapipeFileset(): Promise<{
  wasmLoaderPath: string
  wasmBinaryPath: string
}> {
  if (cachedFileset) return cachedFileset

  const [loaderBytes, wasmBytes] = await Promise.all([
    readAssetBytes('mediapipe/wasm/vision_wasm_internal.js'),
    readAssetBytes('mediapipe/wasm/vision_wasm_internal.wasm')
  ])

  cachedFileset = {
    wasmLoaderPath: toBlobUrl(loaderBytes, 'application/javascript'),
    wasmBinaryPath: toBlobUrl(wasmBytes, 'application/wasm')
  }
  return cachedFileset
}

export async function loadPoseModelBytes(): Promise<ArrayBuffer> {
  return readAssetBytes('mediapipe/pose_landmarker_lite.task')
}

export type { FilesetResolver }
