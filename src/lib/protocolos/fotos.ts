import type { SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { fechaOperativa } from '@/lib/attendance/jornada'

// ---------------------------------------------------------------------------
// Fotos de los protocolos: chicas y por tiempo limitado
// ---------------------------------------------------------------------------
// El almacenamiento gratuito de Supabase es de 1 GB. Las fotos llegaban de
// ~210 KB (algunas 570 KB): ~100 MB por mes. Ahora:
//   · Se achican en el servidor a 1024 px y JPEG calidad 65 (~50 KB, se ve
//     todo: probado con una foto real del baño, 417 KB → 52 KB).
//   · Se borran a los 60 días (la tarea queda registrada: quién y cuándo).
//     La app muestra solo los últimos 7 días.
// ---------------------------------------------------------------------------

export const LADO_MAX = 1024
export const CALIDAD = 65
export const DIAS_GUARDADO = 60

/** Achica y normaliza una foto (gira según el celular, saca metadatos). Si falla, devuelve la original. */
export async function optimizarFoto(original: Buffer): Promise<{ buffer: Buffer; contentType: string }> {
  try {
    const buffer = await sharp(original)
      .rotate()
      .resize({ width: LADO_MAX, height: LADO_MAX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: CALIDAD, mozjpeg: true })
      .toBuffer()
    // Si por algún motivo pesa más (ya venía muy comprimida), queda la original
    return buffer.length < original.length ? { buffer, contentType: 'image/jpeg' } : { buffer: original, contentType: 'image/jpeg' }
  } catch (err) {
    console.warn('[protocolos/fotos] no se pudo optimizar, se guarda la original', err)
    return { buffer: original, contentType: 'image/jpeg' }
  }
}

/** Borra del almacenamiento las fotos de tareas con más de DIAS_GUARDADO días. Devuelve cuántas borró. */
export async function borrarFotosViejas(admin: SupabaseClient, dias = DIAS_GUARDADO): Promise<number> {
  const limite = fechaOperativa(new Date(Date.now() - dias * 86_400_000))
  const { data } = await admin.from('protocolo_tareas')
    .select('id, fotos, foto_path')
    .lt('fecha', limite)
    .or('fotos.not.is.null,foto_path.not.is.null')
    .limit(200)
  const tareas = (data ?? []) as { id: string; fotos: string[] | null; foto_path: string | null }[]
  if (tareas.length === 0) return 0
  const rutas = [...new Set(tareas.flatMap((t) => [...(t.fotos ?? []), ...(t.foto_path ? [t.foto_path] : [])]))]
  let borradas = 0
  for (let i = 0; i < rutas.length; i += 100) {
    const { data: ok, error } = await admin.storage.from('protocolos').remove(rutas.slice(i, i + 100))
    if (error) { console.warn('[protocolos/fotos] no se pudieron borrar', error.message); return borradas }
    borradas += ok?.length ?? 0
  }
  await admin.from('protocolo_tareas').update({ fotos: null, foto_path: null }).in('id', tareas.map((t) => t.id))
  return borradas
}
