'use client'

import { useRef, useState, useCallback } from 'react'
import { Camera, RotateCcw, Check, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

interface SelfieCaptureProps {
  onCapture: (url: string) => void
  onSkip?: () => void
  required?: boolean
}

type CaptureState = 'idle' | 'camera' | 'preview' | 'uploading' | 'done'

export function SelfieCapture({ onCapture, onSkip, required = true }: SelfieCaptureProps) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const streamRef  = useRef<MediaStream | null>(null)

  const [state, setState] = useState<CaptureState>('idle')
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Abrir cámara frontal
  const openCamera = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setState('camera')
    } catch {
      setError('No se pudo acceder a la cámara. Verificá los permisos.')
    }
  }, [])

  // Cerrar cámara
  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setState('idle')
  }, [])

  // Tomar foto
  const takePicture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return
    const video  = videoRef.current
    const canvas = canvasRef.current
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Espejado (selfie natural)
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    setPhotoDataUrl(dataUrl)
    closeCamera()
    setState('preview')
  }, [closeCamera])

  // Subir a Supabase Storage
  const uploadPhoto = useCallback(async () => {
    if (!photoDataUrl) return
    setState('uploading')
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sin sesión')

      // Convertir dataURL a Blob
      const res = await fetch(photoDataUrl)
      const blob = await res.blob()
      const fileName = `attendance/${user.id}/${Date.now()}.jpg`

      const { data, error } = await supabase.storage
        .from('attendance-photos')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false })

      if (error) throw error

      const { data: urlData } = supabase.storage
        .from('attendance-photos')
        .getPublicUrl(data.path)

      setState('done')
      onCapture(urlData.publicUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir la foto')
      setState('preview')
    }
  }, [photoDataUrl, onCapture])

  const retake = useCallback(() => {
    setPhotoDataUrl(null)
    setState('idle')
  }, [])

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Canvas oculto para captura */}
      <canvas ref={canvasRef} className="hidden" />

      {state === 'idle' && (
        <div className="flex w-full flex-col items-center gap-3">
          <div className="flex size-20 items-center justify-center rounded-2xl bg-[#f0f7f5]">
            <Camera className="size-9 text-[#006d5a]" strokeWidth={1.5} />
          </div>
          <p className="text-center text-sm text-[#a39e97]">
            {required
              ? 'Se necesita una selfie para registrar el fichaje'
              : 'Podés sacar una selfie como evidencia (opcional)'}
          </p>
          <Button
            onClick={openCamera}
            className="h-12 w-full rounded-xl bg-[#006d5a] text-sm font-semibold text-white"
          >
            <Camera className="mr-2 size-4" />
            Abrir cámara
          </Button>
          {!required && onSkip && (
            <button
              onClick={onSkip}
              className="text-xs text-[#a39e97] underline underline-offset-2"
            >
              Saltar selfie
            </button>
          )}
          {error && (
            <p className="text-center text-xs text-[#ea504c]">{error}</p>
          )}
        </div>
      )}

      {state === 'camera' && (
        <div className="flex w-full flex-col items-center gap-3">
          <div className="relative w-full overflow-hidden rounded-2xl bg-black">
            {/* Mirror para selfie */}
            <video
              ref={videoRef}
              className="w-full"
              style={{ transform: 'scaleX(-1)' }}
              playsInline
              muted
            />
            <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-[#006d5a]/40" />
          </div>
          <div className="flex w-full gap-2">
            <Button
              onClick={closeCamera}
              variant="outline"
              className="h-12 flex-1 rounded-xl border-[#ebe6df]"
            >
              <X className="mr-1 size-4" />
              Cancelar
            </Button>
            <Button
              onClick={takePicture}
              className="h-12 flex-[2] rounded-xl bg-[#006d5a] font-semibold text-white"
            >
              <Camera className="mr-2 size-4" />
              Sacar foto
            </Button>
          </div>
        </div>
      )}

      {(state === 'preview' || state === 'uploading') && photoDataUrl && (
        <div className="flex w-full flex-col items-center gap-3">
          <div className="relative w-full overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoDataUrl}
              alt="Selfie previa"
              className="w-full rounded-2xl"
            />
          </div>
          {error && (
            <p className="text-center text-xs text-[#ea504c]">{error}</p>
          )}
          <div className="flex w-full gap-2">
            <Button
              onClick={retake}
              disabled={state === 'uploading'}
              variant="outline"
              className="h-12 flex-1 rounded-xl border-[#ebe6df]"
            >
              <RotateCcw className="mr-1 size-4" />
              Repetir
            </Button>
            <Button
              onClick={uploadPhoto}
              disabled={state === 'uploading'}
              className="h-12 flex-[2] rounded-xl bg-[#006d5a] font-semibold text-white"
            >
              {state === 'uploading' ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Check className="mr-2 size-4" />
              )}
              {state === 'uploading' ? 'Subiendo...' : 'Usar esta foto'}
            </Button>
          </div>
        </div>
      )}

      {state === 'done' && (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#e8f5f1] px-4 py-3">
          <Check className="size-5 text-[#006d5a]" />
          <p className="text-sm font-medium text-[#006d5a]">Selfie guardada correctamente</p>
        </div>
      )}
    </div>
  )
}
