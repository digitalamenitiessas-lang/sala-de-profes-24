import type { SupabaseClient } from '@supabase/supabase-js'
import { fudoFetch } from '@/lib/fudoClient'
import { fechaOperativa } from '@/lib/attendance/jornada'

// ---------------------------------------------------------------------------
// Ventas por día operativo, según Fudo (tabla ventas_diarias como copia)
// ---------------------------------------------------------------------------
// Fuente: total de cada venta CERRADA de Fudo (con descuentos). Se agrupa por
// día operativo (corte 06:00) y por hora en que se ABRIÓ la venta (createdAt):
// por hora de cierre las ventas se amontonaban al final de cada turno, cuando
// se cierran las mesas. Los días que faltan en la
// copia se traen de Fudo; hoy y ayer se refrescan siempre (siguen vendiendo o
// cerrando mesas).
// ---------------------------------------------------------------------------

export type VentaDia = { fecha: string; total: number; tickets: number; porHora: Record<string, number> }

type Sale = { id: string; attributes: { createdAt?: string | null; total?: number | string | null; saleState?: string | null } }

const MAX_PAGINAS = 80 // 100 ventas por página: ~2-3 meses

function diasEntre(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/** Hora argentina (0-23) de un instante */
const horaAR = (ms: number) => new Date(ms - 3 * 3_600_000).getUTCHours()

/** Trae de Fudo las ventas cerradas entre esos días operativos y las agrupa. */
async function traerDeFudo(from: string, to: string): Promise<Map<string, VentaDia>> {
  const desde = Date.parse(`${from}T06:00:00-03:00`)
  const hasta = Date.parse(`${to}T06:00:00-03:00`) + 86_400_000
  const dias = new Map<string, VentaDia>(diasEntre(from, to).map((f) => [f, { fecha: f, total: 0, tickets: 0, porHora: {} }]))
  for (let page = 1; page <= MAX_PAGINAS; page++) {
    const r = await fudoFetch<{ data: Sale[] }>(`/sales?sort=-createdAt&page[size]=100&page[number]=${page}`)
    let pasamos = false
    for (const s of r.data ?? []) {
      const c = s.attributes.createdAt ? Date.parse(s.attributes.createdAt) : NaN
      if (Number.isNaN(c)) continue
      if (c < desde) { pasamos = true; continue }
      if (c >= hasta) continue
      if (s.attributes.saleState && s.attributes.saleState !== 'CLOSED') continue
      const dia = dias.get(fechaOperativa(new Date(c)))
      if (!dia) continue
      const total = Number(s.attributes.total ?? 0)
      dia.total += total
      dia.tickets++
      const h = String(horaAR(c))
      dia.porHora[h] = (dia.porHora[h] ?? 0) + total
    }
    if (pasamos || (r.data ?? []).length === 0) break
  }
  return dias
}

/** Ventas por día operativo del período (usa la copia; completa lo que falte desde Fudo). */
export async function ventasPorDia(admin: SupabaseClient, from: string, to: string): Promise<VentaDia[]> {
  const hoy = fechaOperativa()
  const hasta = to > hoy ? hoy : to
  if (from > hasta) return []
  const ayer = fechaOperativa(new Date(Date.now() - 86_400_000))

  const { data } = await admin.from('ventas_diarias').select('fecha, total, tickets, por_hora').gte('fecha', from).lte('fecha', hasta)
  const guardadas = new Map(((data ?? []) as { fecha: string; total: number; tickets: number; por_hora: Record<string, number> }[])
    .map((d) => [d.fecha, { fecha: d.fecha, total: Number(d.total), tickets: d.tickets, porHora: d.por_hora ?? {} }]))

  const faltan = diasEntre(from, hasta).filter((f) => !guardadas.has(f) || f >= ayer)
  if (faltan.length > 0) {
    const nuevas = await traerDeFudo(faltan[0], faltan[faltan.length - 1])
    const filas = [...nuevas.values()].filter((v) => faltan.includes(v.fecha))
    if (filas.length > 0) {
      await admin.from('ventas_diarias').upsert(filas.map((v) => ({
        fecha: v.fecha, total: Math.round(v.total), tickets: v.tickets, por_hora: v.porHora, actualizado_at: new Date().toISOString(),
      })), { onConflict: 'fecha' })
      for (const v of filas) guardadas.set(v.fecha, v)
    }
  }
  return diasEntre(from, hasta).map((f) => guardadas.get(f) ?? { fecha: f, total: 0, tickets: 0, porHora: {} })
}
