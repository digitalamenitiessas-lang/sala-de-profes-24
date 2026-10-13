import type { SupabaseClient } from '@supabase/supabase-js'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { informeControl } from '@/lib/reportes/control'
import { calcularLiquidacion } from '@/lib/liquidacion/calcular'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { APP_URL } from '@/lib/email/send'

// ---------------------------------------------------------------------------
// Resumen semanal para los socios (mail de los lunes)
// ---------------------------------------------------------------------------
// La semana anterior (lunes a domingo, días operativos): ventas vs sueldos,
// asistencia, tareas con horario, y lo que necesita atención (descartables
// bajo mínimo, movimientos trabados en Fudo, días a revisar en la liquidación).
// Mismas cuentas que los informes de la app. El PDF de la liquidación va
// adjunto (lo arma el cron).
// ---------------------------------------------------------------------------

// URL pública de la app (logo y botones del mail)
const SITIO = APP_URL
// Los socios reciben el resumen de las dos sucursales: el mail dice de cuál es
const SUCURSAL = 'La Vieja Escuela · 24 y Maipú'
const C = { verde: '#00593b', verdeApp: '#006d5a', crema: '#f7f3ec', espresso: '#3d2c24', texto: '#4a3a33', sub: '#7d6c64', linea: '#ebe6df', rojo: '#b3332f', ambar: '#b0762a' }
const money = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const colorPct = (p: number | null) => (p == null ? C.sub : p <= 20 ? C.verdeApp : p <= 30 ? C.ambar : C.rojo)

/** Lunes y domingo de la semana operativa anterior a `hoy`. */
export function semanaAnterior(hoy = new Date()): { from: string; to: string } {
  const f = new Date(`${fechaOperativa(hoy)}T12:00:00Z`)
  const dow = f.getUTCDay() // 0 = domingo
  const lunesEsta = new Date(f.getTime() - ((dow + 6) % 7) * 86_400_000)
  const from = new Date(lunesEsta.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
  const to = new Date(lunesEsta.getTime() - 86_400_000).toISOString().slice(0, 10)
  return { from, to }
}

export async function armarResumenSemanal(admin: SupabaseClient, from: string, to: string) {
  const [control, liq, { data: desc }, { count: pendientesFudo }, { data: negativos }, { count: pedidosViejos }] = await Promise.all([
    informeControl(admin, from, to),
    calcularLiquidacion(admin, from, to),
    admin.from('stock_items').select('name, current_qty, min_qty, unit').eq('is_active', true).eq('area', 'descartables').gt('min_qty', 0),
    admin.from('fudo_reintentos').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
    admin.from('stock_items').select('name, current_qty, unit').eq('is_active', true).lt('current_qty', 0).order('current_qty').limit(50),
    admin.from('kitchen_orders').select('id', { count: 'exact', head: true }).eq('status', 'ordered').lt('created_at', new Date(Date.now() - 2 * 86_400_000).toISOString()),
  ])
  const bajoMinimo = ((desc ?? []) as { name: string; current_qty: number; min_qty: number; unit: string }[])
    .filter((d) => Number(d.current_qty) <= Number(d.min_qty))
  const c = control.costo
  const turnos = control.asistencia.reduce((s, a) => s + a.turnos, 0)
  const fichados = control.asistencia.reduce((s, a) => s + a.fichados, 0)
  const pctFichado = turnos ? Math.round((100 * fichados) / turnos) : null
  const observados = control.asistencia
    .map((a) => ({ a, puntos: a.sinFicharSinMotivo * 3 + a.tarde + a.salidasAntes }))
    .filter((x) => x.puntos > 0)
    .sort((x, y) => y.puntos - x.puntos)
    .slice(0, 6)

  const periodo = `del ${format(new Date(`${from}T12:00:00`), 'd/MM')} al ${format(new Date(`${to}T12:00:00`), "d/MM 'de' yyyy", { locale: es })}`
  const asunto = `Resumen de la semana ${periodo} — ${SUCURSAL}`

  const fila = (izq: string, der: string, color = C.espresso) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid ${C.linea};color:${C.texto}">${izq}</td><td style="padding:6px 0;border-bottom:1px solid ${C.linea};text-align:right;font-weight:700;color:${color}">${der}</td></tr>`
  const titulo = (t: string) => `<h2 style="font-family:Georgia,serif;font-size:17px;color:${C.espresso};margin:22px 0 6px">${t}</h2>`

  const atencion: string[] = []
  if (liq.summary.diasRevisar > 0) atencion.push(`<b>${liq.summary.diasRevisar}</b> día${liq.summary.diasRevisar !== 1 ? 's' : ''} con turno mal cargado en la liquidación (se pagó lo fichado: conviene corregir el turno).`)
  if (bajoMinimo.length) atencion.push(`Descartables bajo el mínimo: ${bajoMinimo.map((d) => `<b>${esc(d.name)}</b> (${Math.round(Number(d.current_qty))})`).join(', ')}.`)
  if ((pendientesFudo ?? 0) > 0) atencion.push(`<b>${pendientesFudo}</b> movimiento${pendientesFudo !== 1 ? 's' : ''} esperando para entrar a Fudo (ver Salud de Fudo).`)
  const neg = (negativos ?? []) as { name: string; current_qty: number; unit: string }[]
  if (neg.length) atencion.push(`<b>${neg.length}</b> insumo${neg.length !== 1 ? 's' : ''} con stock negativo (se usó sin registrar producción o recepción): ${neg.slice(0, 5).map((n) => `<b>${esc(n.name)}</b> (${Number(n.current_qty).toLocaleString('es-AR')} ${n.unit})`).join(', ')}${neg.length > 5 ? '…' : ''}. Hay que contarlos.`)
  if ((pedidosViejos ?? 0) > 0) atencion.push(`<b>${pedidosViejos}</b> producto${pedidosViejos !== 1 ? 's' : ''} pedido${pedidosViejos !== 1 ? 's' : ''} siguen "en camino" hace más de 2 días: si llegaron, no se sumaron al stock.`)
  const sinMotivo = control.asistencia.reduce((s, a) => s + a.sinFicharSinMotivo, 0)
  if (sinMotivo > 0) atencion.push(`<b>${sinMotivo}</b> turno${sinMotivo !== 1 ? 's' : ''} sin fichar y sin motivo anotado por el encargado.`)

  const html = `
<div style="background:${C.crema};padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid ${C.linea}">
    <div style="padding:20px 24px;border-bottom:3px solid ${C.verde};display:flex;align-items:center">
      <img src="${SITIO}/brand/lve-logo.png?v=2" alt="La Vieja Escuela" width="78" style="display:block">
      <div style="margin-left:auto;text-align:right">
        <div style="font-family:Georgia,serif;font-size:21px;font-weight:700;color:${C.espresso}">Resumen de la semana</div>
        <div style="color:${C.verde};font-weight:600;font-size:13px">${periodo}</div>
        <div style="color:${C.sub};font-size:12px">24 y Maipú</div>
      </div>
    </div>
    <div style="padding:6px 24px 24px;font-size:14px;line-height:1.45;color:${C.texto}">

      ${titulo('Ventas y sueldos')}
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${fila('Ventas (Fudo)', money(c.totalVentas))}
        ${fila('Sueldos de la semana', money(c.totalCosto))}
        ${fila('Sueldos / ventas', c.pct != null ? `${c.pct}%` : '—', colorPct(c.pct))}
        ${fila('Venta por hora trabajada', c.ventasPorHoraTrabajada != null ? money(c.ventasPorHoraTrabajada) : '—')}
      </table>
      ${c.porDiaSemana.length ? `<p style="margin:6px 0 0;font-size:12.5px;color:${C.sub}">Por día: ${c.porDiaSemana.map((d) => `${d.dia.slice(0, 3)} <b style="color:${colorPct(d.pct)}">${d.pct ?? '—'}%</b>`).join(' · ')}</p>` : ''}

      ${titulo('Asistencia')}
      <p style="margin:0 0 6px">Se ficharon <b>${fichados} de ${turnos}</b> turnos${pctFichado != null ? ` (<b>${pctFichado}%</b>)` : ''}.</p>
      ${observados.length ? `<table style="width:100%;border-collapse:collapse;font-size:13.5px">${observados.map(({ a }) => fila(esc(a.nombre), [
        a.sinFicharSinMotivo ? `${a.sinFicharSinMotivo} sin fichar` : '',
        a.tarde ? `${a.tarde} tarde` : '',
        a.salidasAntes ? `${a.salidasAntes} salida${a.salidasAntes !== 1 ? 's' : ''} antes` : '',
      ].filter(Boolean).join(' · '), C.rojo)).join('')}</table>` : `<p style="margin:0;color:${C.verdeApp}">Sin observaciones.</p>`}

      ${control.tareas.protocolos.length ? `${titulo('Tareas con horario')}
      <table style="width:100%;border-collapse:collapse;font-size:13.5px">${control.tareas.protocolos.map((p) => fila(
        esc(p.nombre),
        `${p.cumplimiento}% a tiempo${p.tarde ? ` · ${p.tarde} tarde` : ''}${p.noHechas ? ` · ${p.noHechas} sin hacer` : ''}`,
        p.cumplimiento >= 90 ? C.verdeApp : p.cumplimiento >= 70 ? C.ambar : C.rojo,
      )).join('')}</table>` : ''}

      ${titulo('Liquidación de la semana')}
      <p style="margin:0">Total: <b style="font-size:16px;color:${C.verde}">${money(liq.summary.totalPay)}</b> · ${Math.round(liq.summary.totalHours)} horas · ${liq.summary.totalEmployees} personas. <b>Va adjunta en PDF.</b></p>

      ${atencion.length ? `${titulo('Para atender')}<ul style="margin:0;padding-left:18px">${atencion.map((x) => `<li style="margin:4px 0">${x}</li>`).join('')}</ul>` : ''}

      <div style="margin-top:22px">
        <a href="${SITIO}/admin/reportes/control" style="display:inline-block;background:${C.verdeApp};color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:10px;margin:0 6px 6px 0">Ver Control del personal</a>
        <a href="${SITIO}/admin/reportes/liquidacion" style="display:inline-block;background:${C.crema};color:${C.espresso};text-decoration:none;font-weight:700;padding:10px 16px;border-radius:10px;margin:0 6px 6px 0">Ver Liquidación</a>
      </div>
    </div>
    <div style="padding:12px 24px;background:${C.crema};font-size:11.5px;color:${C.sub}">Sala de Profes · ${SUCURSAL} — se manda solo cada lunes a las 8:00.</div>
  </div>
</div>`

  return { asunto, html, liq }
}
