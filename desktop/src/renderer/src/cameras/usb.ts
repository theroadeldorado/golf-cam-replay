export interface UsbCameraInfo {
  deviceId: string
  label: string
}

/**
 * Enumerate USB/built-in cameras. Chromium only reveals labels after camera
 * permission has been granted once, so prime with a throwaway getUserMedia
 * call when labels come back empty.
 */
export async function listUsbCameras(): Promise<UsbCameraInfo[]> {
  let devices = await navigator.mediaDevices.enumerateDevices()
  if (devices.some((d) => d.kind === 'videoinput' && d.label === '')) {
    try {
      const prime = await navigator.mediaDevices.getUserMedia({ video: true })
      prime.getTracks().forEach((track) => track.stop())
      devices = await navigator.mediaDevices.enumerateDevices()
    } catch {
      // Permission denied or no camera — return what we have.
    }
  }
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Camera' }))
}

export async function openUsbCamera(deviceId: string, fps: number): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: fps }
    },
    audio: false
  })
}

/** Fires on hot-plug/unplug. Returns an unsubscribe function. */
export function onDeviceChange(listener: () => void): () => void {
  navigator.mediaDevices.addEventListener('devicechange', listener)
  return () => navigator.mediaDevices.removeEventListener('devicechange', listener)
}
