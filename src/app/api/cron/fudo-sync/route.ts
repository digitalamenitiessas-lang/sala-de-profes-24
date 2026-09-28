import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncFromFudo } from '@/lib/fudo/stock-sync'
import { importFudoSales } from '@/lib/fudo/sales-sync'
import { autoCreateMissingFudoIngredients, type CreateFromFudoResult } from '@/lib/fudo/create-from-fudo'
import { notifyEvent } from '@/lib/push/notify-event'

// ---------------------------------------------------------------------------
// GET /api/cron/fudo-sync
// ---------------------------------------------------------------------------
// Vercel Cron diario a las 06:00 UTC (03:00 Argentina), cuando el día
// gastronómico ya cerró:
// 1) Importa las ventas de AYER (día completo) + hoy → fudo_sales (historial)
// 2) Sincroniza stock desde Fudo → stock_items
// 3) Guarda el snapshot diario de stock (stock_snapshots, tipo 'daily') —
//    la base del cálculo de mermas: ayer + entradas − ventas − hoy
// 4) Audita discrepancias y loguea a audit_trail
// Si falla, pg_cron la vuelve a llamar a las 04:45 AR con ?si_fallo=1.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
// El sync completo (ventas + stock + snapshot + auditoría) supera los 60s;
// el 2026-07-14 el cron murió a mitad de camino por este límite.
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const startTime = Date.now()
  const admin = createAdminClient()

  // Segunda pasada (pg_cron, 04:45 AR): solo corre si la de las 03:00 falló
  // o no llegó a terminar. Antes, si Fudo estaba caído a esa hora, se perdía
  // el día entero (foto de stock, auditoría) hasta 24 h después.
  if (request.nextUrl.searchParams.get('si_fallo') === '1') {
    const desde = new Date(Date.now() - 4 * 3_600_000).toISOString()
    const { data: ok } = await admin.from('audit_trail').select('id').eq('action', 'fudo_cron_sync').gte('created_at', desde).limit(1)
    if (ok && ok.length > 0) return NextResponse.json({ skipped: true, reason: 'La corrida de las 03:00 ya salió bien' })
  }

  try {
    // Fechas en Argentina: a las 03:00 AR el día operativo cerrado es "ayer"
    const nowAR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const todayAR = new Date(nowAR); todayAR.setHours(12, 0, 0, 0)
    const yesterdayAR = new Date(todayAR); yesterdayAR.setDate(yesterdayAR.getDate() - 1)
    const fmt = (d: Date) => d.toLocaleDateString('en-CA')
    const todayStr = fmt(todayAR)
    const yesterdayStr = fmt(yesterdayAR)

    // ── 1) Importar ventas: ayer completo + lo que haya de hoy ──
    let salesImported = 0
    let salesErrors: string[] = []
    try {
      const salesResult = await importFudoSales(admin, {
        from: yesterdayStr,
        limit: 800,
        operation: 'cron_sales_import',
      })
      salesImported = salesResult.imported
      salesErrors = salesResult.errors
    } catch (err) {
      salesErrors.push(err instanceof Error ? err.message : 'Error al importar ventas')
    }

    // ── 2) Sync stock from Fudo ──
    const stockResult = await syncFromFudo(admin)

    // ── 2.5) Auto-crear insumos nuevos de Fudo (stockControl sin stock_item) ──
    // Corre antes del snapshot para que los items recién creados ya entren en
    // el snapshot diario. Reusa la lógica del botón manual (create-from-fudo).
    let autoCreate: CreateFromFudoResult | null = null
    let autoCreateError: string | null = null
    try {
      autoCreate = await autoCreateMissingFudoIngredients(admin)
      if (autoCreate.created > 0) {
        const names = autoCreate.createdNames
        const shown = names.slice(0, 8).join(', ')
        const extra = names.length > 8 ? ` y ${names.length - 8} más` : ''
        await notifyEvent(admin, 'stock_adjusted', {
          title: `🆕 ${autoCreate.created} insumo${autoCreate.created === 1 ? ' nuevo' : 's nuevos'} de Fudo creado${autoCreate.created === 1 ? '' : 's'} en la app`,
          body: `${shown}${extra}. Revisá categoría y proveedor.`,
          url: '/stock',
        }).catch(() => {})
      }
    } catch (err) {
      autoCreateError = err instanceof Error ? err.message : 'Error al auto-crear insumos de Fudo'
    }

    // ── 3) Snapshot diario de stock (base del cálculo de mermas) ──
    let snapshotSaved = false
    let snapshotError: string | null = null
    try {
      const { data: items } = await admin
        .from('stock_items')
        .select('id, name, unit, category, current_qty, min_qty, cost_per_unit, fudo_product_id, fudo_ingredient_id')
        .eq('is_active', true)

      if (items && items.length > 0) {
        // Un snapshot 'daily' por fecha: si el cron corre dos veces, se reemplaza
        await admin.from('stock_snapshots').delete().eq('snapshot_date', todayStr).eq('snapshot_type', 'daily')
        const { error } = await admin.from('stock_snapshots').insert({
          snapshot_date: todayStr,
          snapshot_type: 'daily',
          label: `Snapshot diario ${todayStr} (03:00 AR)`,
          items,
          total_items: items.length,
          total_qty: items.reduce((s, i) => s + Number(i.current_qty ?? 0), 0),
          critical_count: items.filter(i => Number(i.current_qty ?? 0) <= Number(i.min_qty ?? 0)).length,
        })
        if (error) snapshotError = error.message
        else snapshotSaved = true
      }
    } catch (err) {
      snapshotError = err instanceof Error ? err.message : 'Error al guardar snapshot'
    }

    // ── 3.5) Conciliar pedidos en camino con los GASTOS de Fudo ──
    // Si Fudo ya registró la compra de un proveedor con pedido en camino, avisar
    // al encargado para que confirme la llegada desde /pedidos (no se cierra
    // solo: la persona confirma; LVE no vuelve a cargar stock ni gasto).
    let reconcile: { matches: number; strong: number; error: string | null } = { matches: 0, strong: 0, error: null }
    try {
      const { matchOrdersWithExpenses } = await import('@/lib/compras/conciliar')
      const { matches } = await matchOrdersWithExpenses(admin, { sinceDays: 21 })
      reconcile = { matches: matches.length, strong: matches.filter((m) => m.strength === 'fuerte').length, error: null }
      if (matches.length > 0) {
        const names = [...new Set(matches.map((m) => m.expense.provider ?? 'proveedor'))].slice(0, 4).join(', ')
        await notifyEvent(admin, 'purchase_created', {
          title: `📦 Fudo registró ${matches.length} compra${matches.length === 1 ? '' : 's'} de pedidos en camino`,
          body: `${names}. Confirmá la llegada en Pedidos → En camino.`,
          url: '/pedidos?step=camino',
        }).catch(() => {})
      }
    } catch (err) {
      reconcile.error = err instanceof Error ? err.message : 'No se pudo conciliar pedidos con gastos de Fudo'
    }

    // ── 3.55) Platos nuevos de Fudo → su receta (versiones PedidosYa, etc.) ──
    let platosVinculados: Record<string, unknown> = {}
    try {
      const { autoVincularPlatos } = await import('@/lib/ventas/vinculos-recetas')
      platosVinculados = { ...(await autoVincularPlatos(admin)), error: null }
    } catch (err) {
      platosVinculados = { error: err instanceof Error ? err.message : 'No se pudieron vincular platos' }
    }

    // ── 3.6) Vínculos insumo↔proveedor desde las compras de Fudo ──
    // Reusa el cache de gastos que acaba de llenar la conciliación.
    let supplierLinks: Record<string, unknown> = {}
    try {
      const { syncSupplierLinksFromFudo } = await import('@/lib/proveedores/fudo-links')
      supplierLinks = { ...(await syncSupplierLinksFromFudo(admin)), error: null }
    } catch (err) {
      supplierLinks = { error: err instanceof Error ? err.message : 'No se pudieron vincular proveedores' }
    }

    // ── 4) Auditoría de discrepancias (lo menos crítico va último) ──
    let auditSummary: Record<string, unknown> | null = null
    let auditError: string | null = null
    try {
      const { runFudoAudit } = await import('@/lib/fudo/audit')
      const audit = await runFudoAudit(admin)
      auditSummary = audit.summary
    } catch (err) {
      auditError = err instanceof Error ? err.message : 'No se pudo auditar Fudo'
    }

    const elapsedMs = Date.now() - startTime

    // ── 3) Log to audit_trail ──
    try {
      await admin.from('audit_trail').insert({
        action: 'fudo_cron_sync',
        module: 'stock',
        entity_type: 'cron',
        entity_id: 'fudo-sync',
        description: `Cron sync: ${stockResult.synced} stock, ${salesImported} ventas, snapshot ${snapshotSaved ? 'OK' : 'FALLÓ'} (${elapsedMs}ms)`,
        metadata: JSON.parse(JSON.stringify({
          stock: stockResult,
          auto_create: {
            created: autoCreate?.created ?? 0,
            skipped: autoCreate?.skipped ?? 0,
            items: autoCreate?.createdNames ?? [],
            errors: autoCreate?.errors ?? [],
            error: autoCreateError,
          },
          audit: { summary: auditSummary, error: auditError },
          sales: { imported: salesImported, errors: salesErrors, from: yesterdayStr },
          snapshot: { saved: snapshotSaved, error: snapshotError },
          reconcile,
          supplier_links: supplierLinks,
          platos_vinculados: platosVinculados,
          elapsed_ms: elapsedMs,
        })),
      })
    } catch { /* audit is non-blocking */ }

    return NextResponse.json({
      success: true,
      stock: {
        synced: stockResult.synced,
        total: stockResult.total,
        errors: stockResult.errors.length,
      },
      auto_create: {
        created: autoCreate?.created ?? 0,
        items: autoCreate?.createdNames ?? [],
        errors: autoCreate?.errors ?? [],
        error: autoCreateError,
      },
      audit: {
        summary: auditSummary,
        error: auditError,
      },
      sales: {
        imported: salesImported,
        errors: salesErrors.length,
        from: yesterdayStr,
      },
      snapshot: { saved: snapshotSaved, error: snapshotError },
      reconcile,
      elapsed_ms: elapsedMs,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[cron/fudo-sync]', error)

    // Log failure
    await admin.from('audit_trail').insert({
      action: 'fudo_cron_sync_error',
      module: 'stock',
      entity_type: 'cron',
      entity_id: 'fudo-sync',
      description: `Cron sync failed: ${error instanceof Error ? error.message : 'Error'}`,
    })

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 }
    )
  }
}
