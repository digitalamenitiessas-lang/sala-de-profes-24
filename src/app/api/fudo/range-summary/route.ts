import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { aggregateVentas, type VentasCanal } from '@/lib/ventas/aggregate'
import type { RangeData } from '@/app/(app)/ventas/_components/types'

// ---------------------------------------------------------------------------
// GET /api/fudo/range-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// Agrega ventas de fudo_sales para un rango de fechas (AR time) usando el
// agregador único (src/lib/ventas/aggregate.ts).
//
// Devuelve DashboardData compatible con CompareView + cortes nuevos:
//   bySaleType (real), byDay, byDow, byCategoria, byProduct (COMPLETO),
//   byCanal y dataHasta.
//
// Filtros opcionales: canal=local|takeaway|pedidosya, categorias=id,id,
// dows=0,6, horaDesde=20, horaHasta=23, incluirSinPrecio=1.
//
// fresh=1 (solo manager): si el rango toca hoy/ayer, importa las ventas de
// hoy+ayer desde Fudo antes de agregar (throttle de 5 min por instancia).
// costos=1 (solo manager): agrega comprasFudo y foodCostReal del período
// usando los gastos de Fudo (se omite con nota si el rango excede la
// cobertura del cache de gastos).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

// Throttle de módulo para fresh=1: importar de Fudo cuesta caro, con una vez
// cada 5 minutos por instancia alcanza.
let lastFreshImportAt = 0
const FRESH_THROTTLE_MS = 5 * 60 * 1000

// Tope de páginas del cache de gastos (20×200 en fetchFudoExpenses): si el
// cache vino lleno y el rango pide más atrás que el gasto más viejo, no
// podemos asegurar cobertura.
const EXPENSES_CACHE_CAP = 4000

function hoyAR(): string {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

function restarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const params = request.nextUrl.searchParams
    const from = params.get('from') ?? ''
    const to = params.get('to') ?? ''

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'Parámetros inválidos: from y to en YYYY-MM-DD' }, { status: 400 })
    }

    // Filtros opcionales
    const canalParam = params.get('canal')
    const canal: VentasCanal | undefined =
      canalParam === 'local' || canalParam === 'takeaway' || canalParam === 'pedidosya' ? canalParam : undefined
    const categorias = (params.get('categorias') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const dows = (params.get('dows') ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    const horaDesdeRaw = Number(params.get('horaDesde'))
    const horaHastaRaw = Number(params.get('horaHasta'))
    const horaDesde = params.get('horaDesde') != null && Number.isInteger(horaDesdeRaw) && horaDesdeRaw >= 0 && horaDesdeRaw <= 23 ? horaDesdeRaw : undefined
    const horaHasta = params.get('horaHasta') != null && Number.isInteger(horaHastaRaw) && horaHastaRaw >= 0 && horaHastaRaw <= 23 ? horaHastaRaw : undefined
    const incluirSinPrecio = params.get('incluirSinPrecio') === '1'
    const quiereFresh = params.get('fresh') === '1'
    const quiereCostos = params.get('costos') === '1'

    const admin = createAdminClient()

    // El rol solo hace falta para fresh/costos: no frenamos al resto por esto
    let esManager = false
    if (quiereFresh || quiereCostos) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      esManager = isManagerOrAbove(profile?.role)
    }

    // fresh=1: si el rango incluye hoy o ayer, traer de Fudo lo de hoy+ayer
    // antes de agregar (con throttle: el sync es caro y esto es un dashboard)
    if (quiereFresh && esManager) {
      const hoy = hoyAR()
      const ayer = restarDias(hoy, 1)
      const rangoTocaHoyOAyer = to >= ayer && from <= hoy
      if (rangoTocaHoyOAyer && Date.now() - lastFreshImportAt > FRESH_THROTTLE_MS) {
        lastFreshImportAt = Date.now()
        try {
          const { importFudoSales } = await import('@/lib/fudo/sales-sync')
          await importFudoSales(admin, { from: ayer, to: hoy, userId: user.id, operation: 'range_fresh' })
        } catch (err) {
          // Si Fudo falla igual servimos lo que hay en la tabla local
          console.error('[range-summary] fresh import falló:', err)
        }
      }
    }

    const agg = await aggregateVentas(admin, {
      from,
      to,
      canal,
      categorias: categorias.length > 0 ? categorias : undefined,
      dows: dows.length > 0 ? dows : undefined,
      horaDesde,
      horaHasta,
      excluirSinPrecio: !incluirSinPrecio,
    })

    // Adaptar al shape DashboardData que CompareView ya consume.
    // Nota de fuente: acá el facturado es Σ qty×price de línea (no ve los
    // descuentos de ticket que sí ve sale.total en el modo Día en vivo).
    const canalLabel: Record<VentasCanal, string> = {
      local: 'En local',
      takeaway: 'Para llevar',
      pedidosya: 'PedidosYa',
    }

    const localTickets = agg.byCanal.find((c) => c.canal === 'local')?.tickets ?? 0

    const result: RangeData = {
      totalFacturado: agg.totales.revenue,
      totalEnCurso: 0,
      totalGeneral: agg.totales.revenue,
      totalTickets: agg.totales.tickets,
      totalItems: agg.totales.unidades,
      avgTicket: agg.totales.ticketPromedio,
      mesasAbiertas: 0,
      takeawayAbiertos: 0,
      totalAbiertas: 0,
      mesasCerradas: localTickets,
      topProducts: agg.byProduct.slice(0, 15).map((p) => ({ name: p.nombre, qty: p.unidades, revenue: p.revenue })),
      bySaleType: agg.byCanal.map((c) => ({ name: canalLabel[c.canal], tickets: c.tickets, revenue: c.revenue })),
      byHour: agg.byHour
        .filter((h) => h.unidades > 0)
        .map((h) => ({ hour: `${String(h.hour).padStart(2, '0')}:00`, tickets: h.tickets, revenue: h.revenue, items: h.unidades })),
      openTables: [],
      openTakeaway: [],
      recentSales: [],
      byDay: agg.byDay,
      byDow: agg.byDow,
      byCanal: agg.byCanal,
      byCategoria: agg.byCategoria,
      byProduct: agg.byProduct,
      dataHasta: agg.dataHasta,
      truncado: agg.truncado,
    }

    // costos=1 (solo manager): compras de Fudo del período + food cost real.
    // Con CUALQUIER filtro activo se omite: las compras son del período ENTERO
    // y dividirlas por un revenue filtrado inventa food costs absurdos
    // (canal=pedidosya daba "food cost 320%").
    const hayFiltros = canal != null || categorias.length > 0 || dows.length > 0 || horaDesde != null || horaHasta != null
    if (quiereCostos && esManager && hayFiltros) {
      result.costosNota = 'El food cost real se calcula sin filtros'
    } else if (quiereCostos && esManager) {
      try {
        const { fetchFudoExpensesConMeta } = await import('@/lib/fudo/expenses')
        const { expenses: gastos, rawCount } = await fetchFudoExpensesConMeta()
        // Fechas por Date.parse en los DOS lados: los createdAt de Fudo pueden
        // venir con otro formato y la comparación de strings mentía.
        const fromMs = new Date(`${agg.from}T00:00:00-03:00`).getTime()
        const toMs = Date.parse(`${agg.to}T00:00:00-03:00`) + 86_400_000

        const gastoMasViejoMs = gastos.length > 0 ? Date.parse(gastos[gastos.length - 1].date) : NaN
        // Cobertura por el conteo CRUDO: la lib descarta gastos sin pago y el
        // conteo de válidos podía quedar bajo el tope con el cache lleno.
        const cacheLleno = rawCount >= EXPENSES_CACHE_CAP
        if (cacheLleno && !Number.isNaN(gastoMasViejoMs) && fromMs < gastoMasViejoMs) {
          result.costosNota = 'El rango pide gastos más viejos que los que Fudo devuelve (tope del cache de gastos): food cost omitido.'
        } else {
          const comprasFudo = gastos
            .filter((g) => {
              const t = Date.parse(g.date)
              return !Number.isNaN(t) && t >= fromMs && t < toMs
            })
            .reduce((s, g) => s + g.amount, 0)
          result.comprasFudo = Math.round(comprasFudo)
          if (agg.totales.revenue > 0) {
            result.foodCostReal = Math.round((comprasFudo / agg.totales.revenue) * 1000) / 1000
          }
        }
      } catch (err) {
        result.costosNota = `No se pudieron leer los gastos de Fudo: ${err instanceof Error ? err.message : 'error desconocido'}`
      }
    }

    return NextResponse.json({ data: result })
  } catch (error) {
    console.error('[GET /api/fudo/range-summary]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
