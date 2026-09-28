// ---------------------------------------------------------------------------
// Camera utilities for attendance selfie capture
// ---------------------------------------------------------------------------

export type CameraResult = {
  status: 'success' | 'denied' | 'unavailable' | 'error'
  error?: string
}

const PHOTO_WIDTH = 640
const PHOTO_HEIGHT = 480
const JPEG_QUALITY = 0.7

export async function startCamera(
  videoElement: HTMLVideoElement,
): Promise<CameraResult> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { status: 'unavailable', error: 'Cámara no disponible en este navegador' }
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: PHOTO_WIDTH }, height: { ideal: PHOTO_HEIGHT } },
      audio: false,
    })

    videoElement.srcObject = stream
    await videoElement.play()
    return { status: 'success' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    if (msg.includes('Permission') || msg.includes('NotAllowed')) {
      return { status: 'denied', error: 'Permiso de cámara denegado' }
    }
    return { status: 'error', error: msg }
  }
}

export function capturePhoto(videoElement: HTMLVideoElement): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = PHOTO_WIDTH
  canvas.height = PHOTO_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Mirror horizontally for selfie
  ctx.translate(PHOTO_WIDTH, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(videoElement, 0, 0, PHOTO_WIDTH, PHOTO_HEIGHT)

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

export function stopCamera(videoElement: HTMLVideoElement): void {
  const stream = videoElement.srcObject as MediaStream | null
  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop()
    }
    videoElement.srcObject = null
  }
}
