'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  CreditCard,
  History,
  Loader2,
  MessageCircle,
  Package,
  PackagePlus,
  Radar,
  ScanFace,
  Shield,
  TrendingDown,
  TrendingUp,
  User,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import type { LucideIcon } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { useAdminKpis } from '@/lib/hooks/use-admin-kpis'
import { isManagerOrAbove, isSocio } from '@/lib/roles'
import { AskBar } from '@/components/ai/AskBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingState } from '@/components/ui/LoadingState'
import { FadeIn, StaggerList, StaggerItem, ScalePress } from '@/components/ui/motion'
import { KpiCard } from '@/components/admin/KpiCard'
import type { StockAnomaliesResponse, StockAnomalyItem } from '@/lib/contracts/stock-anomalies'
import type { StockIntelligenceResponse, StockSetupIssue } from '@/lib/stock/intelligence'
import { lotTone, formatLotCountdown, formatQty } from '@/lib/stock/helpers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SectionState<T> = {
  loading: boolean
  error: string | null
  data: T | null
}

type CriticalAlert = {
  id: string
  message: string
  alert_type: string
  created_at: string
  stock_items: {
    name: string
    current_qty: number
    min_qty: number
    unit: string
  } | null
}

type IntelData = {
  response: StockIntelligenceResponse
  missingSupplierCount: number | null
}

type FudoUnmapped = {
  unmapped_ingredients: { id: string; name: string; unit: string }[]
  unmapped_products: { id: string; name: string }[]
  total: number
}

type AttendanceAlert = {
  log_id: string
  first_name: string
  last_name: string
  role: string
  operative_date: string
  clock_in_at: string
  clock_out_at: string | null
  hours_worked: number | null
  suspicious_reasons: string[]
  status: string
}

// Shape de /api/stock/lots (window_days=7)
type ExpiryLot = {
  id: number
  stock_item_id: string
  stock_item_name: string
  lot_code: string
  qty_remaining: number
  unit: string
  expires_at: string
  expires_in_days: number
}

type AuditEntry = {
  id: number
  user_name: string | null
  action: string
  module: string
  description: string
  metadata: Record<string, unknown> | null
  created_at: string
}

const initialState = { loading: true, error: null, data: null }

// Links compactos a reportes existentes
const REPORT_LINKS: { label: string; href: string }[] = [
  { label: 'Ventas y márgenes', href: '/admin/reportes/ventas' },
  { label: 'Asistencia', href: '/admin/reportes/asistencia' },
  { label: 'Sospechosos', href: '/admin/reportes/fichajes-sospechosos' },
  { label: 'Turnos', href: '/admin/reportes/turnos' },
  { label: 'Stock', href: '/admin/reportes/stock' },
  { label: 'Fudo', href: '/admin/fudo' },
  { label: 'Recetas pendientes', href: '/admin/recetas/pending' },
]

// Accesos rápidos (ex /admin)
const QUICK_LINKS = [
  { href: '/pedidos/cuentas', icon: CreditCard, label: 'Cuentas a pagar', color: '#d4943a' },
  { href: '/asistente', icon: MessageCircle, label: 'La Vieja de Historia', color: '#8b5e34' },
  { href: '/ventas?m=personal', icon: Users, label: 'Consumo del personal', color: '#ea504c' },
  { href: '/equipo', icon: Users, label: 'Gestionar Equipo', color: '#8b5e34' },
  { href: '/stock', icon: Package, label: 'Gestionar Stock', color: '#ea504c' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function anomalyHref(item: StockAnomalyItem): string {
  if (item.action_href) return item.action_href
  if (item.primary_action === 'count') return '/stock/puesta-a-cero'
  return '/stock'
}

function setupIssueHref(issue: StockSetupIssue): string {
  if (issue.type === 'missing_fudo_mapping' || issue.type === 'mapping_conflict') {
    return '/admin/stock/mapeo'
  }
  // Problemas de metadata de UN item puntual (sin vida útil, categoría, unidad):
  // deep-link directo al editor de ese item en /stock
  if (
    issue.stock_item_id
    && (issue.type === 'missing_shelf_life' || issue.type === 'category_review' || issue.type === 'unit_review')
  ) {
    return `/stock?meta=${issue.stock_item_id}`
  }
  return '/stock'
}

// Cambios de cantidad de stock — badge visual "X → Y" (mismo criterio que /auditoria)
const QTY_CHANGE_ACTIONS = new Set(['fudo_stock_sync', 'physical_count', 'stock_update'])

type QtyChange = {
  oldQty: number
  newQty: number
  itemName: string | null
  context: string | null
}

function getQtyChange(entry: AuditEntry): QtyChange | null {
  if (!QTY_CHANGE_ACTIONS.has(entry.action) || !entry.metadata) return null
  const oldQty = Number(entry.metadata.old_qty)
  const newQty = Number(entry.metadata.new_qty)
  if (!Number.isFinite(oldQty) || !Number.isFinite(newQty)) return null

  // La descripción tiene el formato "Nombre del item: X → Y (contexto)"
  const colonIdx = entry.description.indexOf(':')
  const itemName = colonIdx > 0 ? entry.description.slice(0, colonIdx).trim() : null
  const parens = entry.description.match(/\(([^()]*)\)\s*$/)

  return { oldQty, newQty, itemName, context: parens?.[1] ?? null }
}

function formatAuditQty(value: number): string {
  return Number(value.toFixed(2)).toLocaleString('es-AR')
}

// Acción sugerida para un lote según los días que le quedan
function lotSuggestedAction(expiresInDays: number): string {
  if (expiresInDays < 0) return 'Descartá y registrá la merma'
  if (expiresInDays <= 1) return 'Sacá promo HOY o usalo en producción'
  if (expiresInDays <= 3) return 'Planificá promo'
  return 'Monitoreá y planificá con tiempo'
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ControlPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const isManager = isManagerOrAbove(profile?.role)

  const [critical, setCritical] = useState<SectionState<CriticalAlert[]>>(initialState)
  const [anomalies, setAnomalies] = useState<SectionState<StockAnomaliesResponse>>(initialState)
  const [intel, setIntel] = useState<SectionState<IntelData>>(initialState)
  const [expiryLots, setExpiryLots] = useState<SectionState<ExpiryLot[]>>(initialState)
  const [attendance, setAttendance] = useState<SectionState<AttendanceAlert[]>>(initialState)
  const [history, setHistory] = useState<SectionState<AuditEntry[]>>(initialState)

  // KPIs del día (SWR, corre en paralelo y tolera fallas: si falla solo se oculta la fila)
  const { kpis, error: kpisError } = useAdminKpis(!!profile && isManager)
  const [fudoUnmapped, setFudoUnmapped] = useState<FudoUnmapped | null>(null)
  const [creatingFromFudo, setCreatingFromFudo] = useState(false)
  const [createResult, setCreateResult] = useState<string | null>(null)
  const [pendingDebt, setPendingDebt] = useState<{ amount: number; count: number } | null>(null)

  // -------------------------------------------------------------------------
  // Loaders — cada sección carga y falla de forma independiente
  // -------------------------------------------------------------------------

  const loadCritical = useCallback(async () => {
    setCritical({ loading: true, error: null, data: null })
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('stock_alerts')
        .select('id, message, alert_type, created_at, stock_items(name, current_qty, min_qty, unit)')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      setCritical({ loading: false, error: null, data: (data as unknown as CriticalAlert[]) ?? [] })
    } catch (err) {
      console.error('[control] stock_alerts', err)
      setCritical({ loading: false, error: 'No se pudieron cargar las alertas de stock', data: null })
    }
  }, [])

  const loadAnomalies = useCallback(async () => {
    setAnomalies({ loading: true, error: null, data: null })
    try {
      const res = await fetch('/api/stock/anomalies')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar anomalías')
      setAnomalies({ loading: false, error: null, data: data as StockAnomaliesResponse })
    } catch (err) {
      console.error('[control] anomalies', err)
      setAnomalies({
        loading: false,
        error: err instanceof Error ? err.message : 'No se pudieron cargar las anomalías de stock',
        data: null,
      })
    }
  }, [])

  const loadIntel = useCallback(async () => {
    setIntel({ loading: true, error: null, data: null })
    try {
      const res = await fetch('/api/stock/intelligence')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar el análisis de stock')

      // Conteo de items sin proveedor (opcional: si falla no rompe la sección)
      let missingSupplierCount: number | null = null
      try {
        const supabase = createClient()
        const { count, error } = await supabase
          .from('stock_items')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .is('supplier_id', null)
        if (!error) missingSupplierCount = count ?? 0
      } catch {
        missingSupplierCount = null
      }

      setIntel({
        loading: false,
        error: null,
        data: { response: data as StockIntelligenceResponse, missingSupplierCount },
      })
    } catch (err) {
      console.error('[control] intelligence', err)
      setIntel({
        loading: false,
        error: err instanceof Error ? err.message : 'No se pudo cargar el análisis de stock',
        data: null,
      })
    }
  }, [])

  // Lotes por vencer (vida útil): vencidos o que vencen en ≤7 días
  const loadExpiryLots = useCallback(async () => {
    setExpiryLots({ loading: true, error: null, data: null })
    try {
      const res = await fetch('/api/stock/lots?window_days=7&limit=30')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar lotes')
      const lots = ((data.lots as ExpiryLot[]) ?? []).filter((l) => l.qty_remaining > 0)
      setExpiryLots({ loading: false, error: null, data: lots })
    } catch (err) {
      console.error('[control] stock lots', err)
      setExpiryLots({
        loading: false,
        error: err instanceof Error ? err.message : 'No se pudieron cargar los lotes por vencer',
        data: null,
      })
    }
  }, [])

  const loadAttendance = useCallback(async () => {
    setAttendance({ loading: true, error: null, data: null })
    try {
      const fromDate = format(new Date(Date.now() - 7 * 86400000), 'yyyy-MM-dd')
      const res = await fetch(`/api/attendance/alerts?from_date=${fromDate}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar fichajes')
      setAttendance({ loading: false, error: null, data: (data.alerts as AttendanceAlert[]) ?? [] })
    } catch (err) {
      console.error('[control] attendance', err)
      setAttendance({
        loading: false,
        error: err instanceof Error ? err.message : 'No se pudieron cargar los fichajes',
        data: null,
      })
    }
  }, [])

  // Historial reciente: últimas ~15 entradas de audit_trail (mismo query que /auditoria, sin filtros)
  const loadHistory = useCallback(async () => {
    setHistory({ loading: true, error: null, data: null })
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('audit_trail')
        .select('id, user_name, action, module, description, metadata, created_at')
        // Sin las filas anónimas que dejaba el espejo de Fudo (ver migración
        // 20260907): el historial reciente es de acciones de personas.
        .or('action.neq.stock_update,user_id.not.is.null')
        .order('created_at', { ascending: false })
        .limit(15)
      if (error) throw error
      setHistory({ loading: false, error: null, data: (data as unknown as AuditEntry[]) ?? [] })
    } catch (err) {
      console.error('[control] audit_trail', err)
      setHistory({ loading: false, error: 'No se pudo cargar el historial reciente', data: null })
    }
  }, [])

  // Deuda con proveedores: recibos pendientes de pago. Silencioso — si falla, no aparece.
  const loadPendingDebt = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('stock_receipts')
        .select('cost_total')
        .or('payment_status.is.null,payment_status.neq.pagado')
        .not('cost_total', 'is', null)
        .gt('cost_total', 0)
        .limit(500)
      if (error) throw error
      const rows = (data ?? []) as { cost_total: number }[]
      const amount = rows.reduce((s, r) => s + Number(r.cost_total), 0)
      setPendingDebt({ amount, count: rows.length })
    } catch (err) {
      console.error('[control] pending_debt', err)
      setPendingDebt(null)
    }
  }, [])

  // Items de Fudo (con control de stock) que todavía no existen en LVE.
  // Silencioso: si Fudo no responde, la fila simplemente no aparece.
  const loadFudoUnmapped = useCallback(async () => {
    try {
      const res = await fetch('/api/stock/create-from-fudo')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al consultar Fudo')
      setFudoUnmapped(data as FudoUnmapped)
    } catch (err) {
      console.error('[control] create-from-fudo', err)
      setFudoUnmapped(null)
    }
  }, [])

  const handleCreateAllFromFudo = useCallback(async () => {
    setCreatingFromFudo(true)
    setCreateResult(null)
    try {
      const res = await fetch('/api/stock/create-from-fudo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudieron crear los items')

      const summary = `${data.created} creado${data.created === 1 ? '' : 's'} · ${data.skipped} salteado${data.skipped === 1 ? '' : 's'}${data.errors?.length ? ` · ${data.errors.length} con error` : ''}`
      setCreateResult(summary)
      if (data.errors?.length) {
        toast.error(`Creados con errores: ${summary}. ${data.errors[0]}`)
      } else {
        toast.success(`Items creados en LVE: ${summary}`)
      }
      void loadFudoUnmapped()
      void loadIntel()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron crear los items'
      setCreateResult(null)
      toast.error(msg)
    } finally {
      setCreatingFromFudo(false)
    }
  }, [loadFudoUnmapped, loadIntel])

  useEffect(() => {
    if (!profile || !isManager) return
    void Promise.all([loadCritical(), loadAnomalies(), loadIntel(), loadExpiryLots(), loadAttendance(), loadFudoUnmapped(), loadHistory(), loadPendingDebt()])
  }, [profile, isManager, loadCritical, loadAnomalies, loadIntel, loadExpiryLots, loadAttendance, loadFudoUnmapped, loadHistory, loadPendingDebt])

  // -------------------------------------------------------------------------
  // Access control
  // -------------------------------------------------------------------------

  if (profileLoading) {
    return <LoadingState message="Cargando centro de control..." />
  }

  if (!isManager) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          icon={Shield}
          title="Acceso restringido"
          description="Solo encargados y socios pueden ver el centro de control"
        />
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Derived data per section
  // -------------------------------------------------------------------------

  // a. Stock crítico: alertas activas + reposiciones high del intelligence
  const criticalAlerts = critical.data ?? []
  const alertedNames = new Set(
    criticalAlerts.map((a) => (a.stock_items?.name ?? '').toLowerCase()).filter(Boolean),
  )
  const highReplenish = (intel.data?.response.sectors ?? [])
    .filter((s) => s.sector === 'compras')
    .flatMap((s) => s.actions)
    .filter(
      (a) =>
        a.kind === 'replenish'
        && a.priority === 'high'
        && !alertedNames.has(a.stock_item_name.toLowerCase()),
    )
  const criticalCount = criticalAlerts.length + highReplenish.length

  // b. Anomalías de stock (radar)
  const anomalyItems = anomalies.data?.items ?? []
  const anomalyCount = anomalies.data?.summary.total ?? anomalyItems.length

  // b2. Lotes por vencer (vida útil ≤7 días)
  const expiryItems = expiryLots.data ?? []

  // c. Datos por completar (setup issues + items sin proveedor + items Fudo sin crear)
  const setupIssues = intel.data?.response.setup_issues ?? []
  const missingSupplierCount = intel.data?.missingSupplierCount ?? 0
  const fudoUnmappedCount = fudoUnmapped?.total ?? 0
  const unlinkedIntermediates = intel.data?.response.unlinked_intermediates ?? null
  const unlinkedIntermediatesCount = unlinkedIntermediates?.count ?? 0
  const costDivergence = intel.data?.response.cost_divergence ?? null
  const costDivergenceCount = costDivergence?.count ?? 0
  const setupCount = setupIssues.length
    + (missingSupplierCount > 0 ? 1 : 0)
    + (fudoUnmappedCount > 0 ? 1 : 0)
    + (unlinkedIntermediatesCount > 0 ? 1 : 0)
    + (costDivergenceCount > 0 ? 1 : 0)
    + (pendingDebt && pendingDebt.amount > 0 ? 1 : 0)

  // d. Fichajes sospechosos
  const attendanceAlerts = attendance.data ?? []

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-24">
      {/* Header */}
      <FadeIn className="space-y-1 pt-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#e8f5f1]">
            <Shield className="size-5 text-[#006d5a]" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[#3d2c24]">
              Centro de control
            </h1>
            <p className="text-sm text-[#a39e97]">
              Todo lo que necesita atención, en un solo lugar
            </p>
          </div>
        </div>
      </FadeIn>

      {/* Preguntar en castellano — cruza stock, pedidos, producción y ventas */}
      <FadeIn delay={0.03}>
        <AskBar
          scope="control"
          placeholder="Preguntá lo que quieras chequear…"
          examples={['¿qué insumos están sin proveedor?', '¿qué quedó sin área?', '¿qué hay en negativo?', '¿qué no cuento hace una semana?']}
        />
      </FadeIn>

      {/* KPIs del día (ex /admin) — si falla, la fila se reemplaza por una nota y no rompe el resto */}
      {!kpisError && (
        kpis ? (
          <StaggerList className="grid grid-cols-2 gap-3" staggerDelay={0.04}>
            <StaggerItem>
              <KpiCard
                label="Presentes hoy"
                value={kpis.team_present_today}
                icon={Users}
                color="#006d5a"
                bg="#e8f5f1"
                href="/admin/reportes/asistencia"
                subtitle={`de ${kpis.team_total_active} activos`}
              />
            </StaggerItem>
            <StaggerItem>
              <KpiCard
                label="En turno ahora"
                value={kpis.team_clocked_in}
                icon={Clock}
                color={kpis.missing_checkouts > 0 ? '#d4943a' : '#006d5a'}
                bg={kpis.missing_checkouts > 0 ? '#fdf6ec' : '#e8f5f1'}
                subtitle={kpis.missing_checkouts > 0 ? `${kpis.missing_checkouts} sin egreso` : 'todos marcados'}
              />
            </StaggerItem>
            <StaggerItem>
              <KpiCard
                label="Turnos hoy"
                value={kpis.shifts_today}
                icon={CalendarDays}
                color="#8b5e34"
                bg="#faf0e4"
                href="/admin/reportes/turnos"
                subtitle={`${kpis.shifts_tomorrow} mañana`}
              />
            </StaggerItem>
            <StaggerItem>
              <KpiCard
                label="Stock crítico"
                value={kpis.stock_red}
                icon={Package}
                color={kpis.stock_red > 0 ? '#ea504c' : '#006d5a'}
                bg={kpis.stock_red > 0 ? '#fef2f2' : '#e8f5f1'}
                href="/admin/reportes/stock"
                subtitle={`${kpis.stock_yellow} en atención`}
              />
            </StaggerItem>
          </StaggerList>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[104px] animate-pulse rounded-xl bg-[#f3efe9]" />
            ))}
          </div>
        )
      )}
      {kpisError && (
        <p className="rounded-xl bg-white px-4 py-3 text-xs text-[#a39e97] ring-1 ring-[#ebe6df]">
          No se pudieron cargar los KPIs del día
        </p>
      )}

      {/* Semáforo del día: qué necesita atención, tocable. Reemplaza al viejo
          "resumen ejecutivo" (un párrafo de IA que no permitía hacer nada). */}
      <FadeIn delay={0.02}>
        {(() => {
          const focos = [
            { id: 'sec-critico', label: 'Stock crítico', n: criticalCount, tone: '#ea504c', bg: '#fef2f2' },
            { id: 'sec-fichajes', label: 'Fichajes raros', n: attendanceAlerts.length, tone: '#ea504c', bg: '#fef2f2' },
            { id: 'sec-anomalias', label: 'Anomalías', n: anomalyCount, tone: '#d4943a', bg: '#fdf6ec' },
            { id: 'sec-vencer', label: 'Por vencer', n: expiryItems.length, tone: '#d4943a', bg: '#fdf6ec' },
            { id: 'sec-datos', label: 'Datos incompletos', n: setupCount, tone: '#7d6c64', bg: '#f3efe9' },
          ].filter((f) => f.n > 0)
          if (focos.length === 0) {
            return (
              <div className="flex items-center gap-2.5 rounded-2xl bg-[#e8f5f1] px-4 py-3 ring-1 ring-[#dcefe8]">
                <span className="text-lg">✅</span>
                <p className="text-sm font-semibold text-[#006d5a]">Nada urgente ahora. Todo lo controlado está en orden.</p>
              </div>
            )
          }
          return (
            <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-[#ebe6df]">
              <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#a39e97]">
                Hoy necesita atención — tocá para ir
              </p>
              <div className="flex flex-wrap gap-1.5">
                {focos.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => document.getElementById(f.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold active:scale-95"
                    style={{ color: f.tone, backgroundColor: f.bg }}
                  >
                    {f.label}
                    <span className="rounded-full bg-white/70 px-1.5 text-[11px] font-bold tabular-nums">{f.n}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })()}
      </FadeIn>

      {/* Accesos rápidos (ex /admin) */}
      <FadeIn delay={0.03}>
        <h2 className="section-label mb-3">Accesos rápidos</h2>
        <StaggerList className="flex flex-col gap-2" staggerDelay={0.04}>
          {QUICK_LINKS.map((link) => (
            <StaggerItem key={link.href}>
              <ScalePress>
                <Link href={link.href}>
                  <div className="card-interactive flex items-center overflow-hidden rounded-xl">
                    <div className="w-1 self-stretch" style={{ backgroundColor: link.color }} />
                    <div className="flex flex-1 items-center justify-between px-4 py-3">
                      <span className="flex items-center gap-3">
                        <div
                          className="flex size-8 items-center justify-center rounded-lg"
                          style={{ backgroundColor: `${link.color}10` }}
                        >
                          <link.icon className="size-4" style={{ color: link.color }} />
                        </div>
                        <span className="text-sm font-medium text-[#3d2c24]">{link.label}</span>
                      </span>
                      <ArrowRight className="size-4 text-[#d1cdc7]" />
                    </div>
                  </div>
                </Link>
              </ScalePress>
            </StaggerItem>
          ))}
        </StaggerList>
      </FadeIn>

      <FadeIn delay={0.05} className="space-y-4">
        {/* a. Stock crítico */}
        <ControlSection
          id="sec-critico"
          title="Stock crítico"
          icon={AlertTriangle}
          tone="red"
          count={criticalCount}
          loading={critical.loading}
          error={critical.error}
          emptyText="Sin alertas de stock activas"
        >
          {criticalAlerts.map((alert) => (
            <SectionRow
              key={alert.id}
              href="/stock"
              title={alert.stock_items?.name ?? 'Item desconocido'}
              detail={alert.message}
              meta={
                alert.stock_items
                  ? `${alert.stock_items.current_qty} ${alert.stock_items.unit} / mín. ${alert.stock_items.min_qty}`
                  : undefined
              }
            />
          ))}
          {highReplenish.map((action) => (
            <SectionRow
              key={action.id}
              href="/stock"
              title={action.title}
              detail={action.detail}
            />
          ))}
        </ControlSection>

        {/* b. Anomalías de stock */}
        <ControlSection
          id="sec-anomalias"
          title="Anomalías de stock"
          icon={Radar}
          tone="orange"
          count={anomalyCount}
          loading={anomalies.loading}
          error={anomalies.error}
          emptyText="El radar no detecta anomalías"
        >
          {anomalyItems.map((item) => (
            <SectionRow
              key={item.id}
              href={anomalyHref(item)}
              title={item.title}
              detail={item.detail}
              meta={item.action_label}
            />
          ))}
        </ControlSection>

        {/* b2. Por vencer (vida útil de lotes) */}
        <ControlSection
          id="sec-vencer"
          title="Por vencer"
          icon={Clock}
          tone="orange"
          count={expiryItems.length}
          loading={expiryLots.loading}
          error={expiryLots.error}
          emptyText="Ningún lote vence en los próximos 7 días"
        >
          {expiryItems.map((lot) => {
            const tone = lotTone(lot.expires_in_days)
            return (
              <Link
                key={lot.id}
                href="/stock/lotes"
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#f9f7f3] active:bg-[#f3efe9]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-[#3d2c24]">{lot.stock_item_name}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.pill}`}>
                      {formatLotCountdown(lot.expires_in_days)}
                    </span>
                    <span className="shrink-0 rounded-full bg-[#f5f0ea] px-2 py-0.5 text-[10px] font-medium tabular-nums text-[#a39e97]">
                      quedan {formatQty(lot.qty_remaining)} {lot.unit}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[#a39e97]">
                    {lotSuggestedAction(lot.expires_in_days)}
                    {lot.lot_code ? ` · ${lot.lot_code}` : ''}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-[#d8d2c9]" />
              </Link>
            )
          })}
        </ControlSection>

        {/* c. Datos por completar */}
        <ControlSection
          id="sec-datos"
          title="Datos por completar"
          icon={ClipboardList}
          tone="yellow"
          count={setupCount}
          loading={intel.loading}
          error={intel.error}
          emptyText="No hay datos pendientes de completar"
        >
          {pendingDebt && pendingDebt.amount > 0 && (
            <SectionRow
              href="/pedidos/cuentas"
              title={`$${Math.round(pendingDebt.amount).toLocaleString('es-AR')} pendiente de pago a proveedores`}
              detail={`${pendingDebt.count} recibo${pendingDebt.count !== 1 ? 's' : ''} sin saldar. Revisá si hay facturas vencidas.`}
              meta="Ver cuentas"
            />
          )}
          {fudoUnmappedCount > 0 && (
            <div className="flex items-center gap-3 bg-[#fbf6e0]/50 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#e8f5f1]">
                <PackagePlus className="size-4.5 text-[#006d5a]" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#3d2c24]">
                  {fudoUnmappedCount} item{fudoUnmappedCount === 1 ? '' : 's'} de Fudo sin crear en LVE
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[#a39e97]">
                  {createResult
                    ? `Último resultado: ${createResult}`
                    : 'Tienen control de stock en Fudo pero no existen acá. Crealos para no perder trazabilidad.'}
                </p>
              </div>
              <button
                onClick={handleCreateAllFromFudo}
                disabled={creatingFromFudo}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#006d5a] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#005c4c] disabled:opacity-60"
              >
                {creatingFromFudo && <Loader2 className="size-3.5 animate-spin" />}
                Crear todos en LVE
              </button>
            </div>
          )}
          {unlinkedIntermediatesCount > 0 && (
            <SectionRow
              href="/recetas"
              title={`${unlinkedIntermediatesCount} intermedio${unlinkedIntermediatesCount === 1 ? '' : 's'} sin vincular al stock — el costeo de los platos que los usan está incompleto`}
              detail={
                unlinkedIntermediates?.names.length
                  ? `Sin receta que los produzca: ${unlinkedIntermediates.names.join(', ')}.`
                  : 'Vinculá cada receta intermedia con el item de stock que produce.'
              }
              meta="Revisar"
            />
          )}
          {costDivergenceCount > 0 && (
            <SectionRow
              href="/stock"
              title={`${costDivergenceCount} insumo${costDivergenceCount === 1 ? '' : 's'} con costo muy distinto entre Fudo y la app`}
              detail={
                costDivergence?.items.length
                  ? costDivergence.items
                    .slice(0, 3)
                    .map((i) => `${i.name}: $${i.costo_lve.toLocaleString('es-AR')} en la app vs $${i.costo_fudo.toLocaleString('es-AR')} en Fudo (${i.diff_pct}%)`)
                    .join(' · ')
                  : 'La diferencia supera el 30%. Uno de los dos costos está desactualizado.'
              }
              meta="revisar precio en Fudo o recepción"
            />
          )}
          {missingSupplierCount > 0 && (
            <SectionRow
              href="/proveedores/vincular"
              title={`${missingSupplierCount} item${missingSupplierCount === 1 ? '' : 's'} sin proveedor asignado`}
              detail="Vinculá cada item a su proveedor para poder pedir y controlar compras."
              meta="Vincular"
            />
          )}
          {setupIssues.slice(0, 30).map((issue) => (
            <SectionRow
              key={issue.id}
              href={setupIssueHref(issue)}
              title={issue.title}
              detail={issue.detail}
            />
          ))}
          {setupIssues.length > 30 && (
            <p className="px-4 py-2.5 text-xs text-[#a39e97]">
              + {setupIssues.length - 30} más en la vista de stock
            </p>
          )}
        </ControlSection>

        {/* d. Fichajes sospechosos */}
        <ControlSection
          id="sec-fichajes"
          title="Fichajes sospechosos"
          icon={ScanFace}
          tone="purple"
          count={attendanceAlerts.length}
          loading={attendance.loading}
          error={attendance.error}
          emptyText="Sin fichajes sospechosos en los últimos 7 días"
        >
          {attendanceAlerts.map((alert) => (
            <SectionRow
              key={alert.log_id}
              href="/equipo/asistencia"
              title={`${alert.first_name} ${alert.last_name}`}
              detail={
                (alert.suspicious_reasons ?? []).length > 0
                  ? alert.suspicious_reasons.join(' · ')
                  : 'Sin egreso registrado'
              }
              meta={`${format(new Date(alert.operative_date + 'T12:00:00'), 'EEE d/MM', { locale: es })} · ${format(new Date(alert.clock_in_at), 'HH:mm')}${alert.clock_out_at ? ` → ${format(new Date(alert.clock_out_at), 'HH:mm')}` : ' → ?'}`}
            />
          ))}
        </ControlSection>
      </FadeIn>

      {/* Historial reciente (audit trail) */}
      <FadeIn delay={0.08}>
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#faf0e4]">
              <History className="size-4.5 text-[#8b5e34]" strokeWidth={1.75} />
            </span>
            <span className="flex-1 text-sm font-semibold text-[#3d2c24]">Historial reciente</span>
          </div>
          <div className="border-t border-[#ebe6df]">
            {history.loading ? (
              <div className="flex items-center gap-2 px-4 py-4 text-sm text-[#a39e97]">
                <Loader2 className="size-4 animate-spin" />
                Cargando...
              </div>
            ) : history.error ? (
              <p className="px-4 py-4 text-sm text-[#ea504c]">{history.error}</p>
            ) : (history.data ?? []).length === 0 ? (
              <p className="px-4 py-4 text-sm text-[#a39e97]">Sin movimientos registrados</p>
            ) : (
              <div className="divide-y divide-[#f3efe9]">
                {(history.data ?? []).map((entry) => (
                  <HistoryRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
            <Link
              href="/auditoria"
              className="flex items-center justify-center gap-1 border-t border-[#f3efe9] px-4 py-3 text-xs font-semibold text-[#006d5a] transition-colors hover:bg-[#f7fbf9]"
            >
              Ver auditoría completa
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </section>
      </FadeIn>

      {/* Control de Mermas y Productos — solo socios */}
      {isSocio(profile?.role) && (
        <>
          <FadeIn delay={0.08}>
            <Link
              href="/admin/mermas"
              className="flex items-center justify-between gap-3 rounded-2xl bg-[#fff5f5] px-4 py-3.5 ring-1 ring-[#ea504c]/30 transition hover:bg-[#fee2e2]"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#ea504c]/10">
                  <AlertTriangle className="size-4 text-[#ea504c]" />
                </div>
                <div>
                  <p className="text-[13px] font-bold text-[#ea504c]">Control de Mermas</p>
                  <p className="text-[11px] text-[#ea504c]/70">Faltantes y entradas sin registrar · Solo socios</p>
                </div>
              </div>
              <ArrowRight className="size-4 shrink-0 text-[#ea504c]/60" />
            </Link>
          </FadeIn>
          <FadeIn delay={0.09}>
            <Link
              href="/admin/productos-control"
              className="flex items-center justify-between gap-3 rounded-2xl bg-[#fff5f5] px-4 py-3.5 ring-1 ring-[#ea504c]/30 transition hover:bg-[#fee2e2]"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#ea504c]/10">
                  <TrendingDown className="size-4 text-[#ea504c]" />
                </div>
                <div>
                  <p className="text-[13px] font-bold text-[#ea504c]">Control de Productos</p>
                  <p className="text-[11px] text-[#ea504c]/70">Stock Fudo vs. esperado · Merma implícita hoy · Solo socios</p>
                </div>
              </div>
              <ArrowRight className="size-4 shrink-0 text-[#ea504c]/60" />
            </Link>
          </FadeIn>
        </>
      )}

      {/* Reportes */}
      <FadeIn delay={0.1}>
        <h2 className="section-label mb-2">Reportes</h2>
        <div className="flex flex-wrap gap-2">
          {REPORT_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-[#3d2c24] ring-1 ring-[#ebe6df] transition-colors hover:bg-[#f7fbf9] hover:ring-[#cfe4dd]"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </FadeIn>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HistoryRow — entrada compacta de audit_trail con badge X → Y para stock
// ---------------------------------------------------------------------------

function HistoryRow({ entry }: { entry: AuditEntry }) {
  const qtyChange = getQtyChange(entry)

  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        {qtyChange ? (
          <div>
            <p className="truncate text-sm font-medium text-[#3d2c24]">
              {qtyChange.itemName ?? entry.description}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {(() => {
                const delta = qtyChange.newQty - qtyChange.oldQty
                const down = delta < 0
                const up = delta > 0
                return (
                  <>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                        down
                          ? 'bg-[#fdecea] text-[#ea504c]'
                          : up
                            ? 'bg-[#e8f5f1] text-[#006d5a]'
                            : 'bg-[#f3efe9] text-[#a39e97]'
                      }`}
                    >
                      {formatAuditQty(qtyChange.oldQty)} → {formatAuditQty(qtyChange.newQty)}
                      {up && <TrendingUp className="size-3" />}
                      {down && <TrendingDown className="size-3" />}
                    </span>
                    {delta !== 0 && (
                      <span
                        className={`text-[10px] font-semibold tabular-nums ${down ? 'text-[#ea504c]' : 'text-[#006d5a]'}`}
                      >
                        {up ? '+' : ''}{formatAuditQty(delta)}
                      </span>
                    )}
                    {qtyChange.context && (
                      <span className="text-[10px] text-[#a39e97]">{qtyChange.context}</span>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        ) : (
          <p className="line-clamp-2 text-sm text-[#3d2c24]">{entry.description}</p>
        )}
        {entry.user_name && (
          <span className="mt-0.5 flex items-center gap-1 text-[10px] text-[#a39e97]">
            <User className="size-2.5" />
            {entry.user_name}
          </span>
        )}
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-[#a39e97]">
        {format(new Date(entry.created_at), 'd/MM HH:mm', { locale: es })}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ControlSection — card colapsable con badge de conteo
// ---------------------------------------------------------------------------

type SectionTone = 'red' | 'orange' | 'yellow' | 'purple'

const TONE_STYLES: Record<SectionTone, { iconBg: string; iconText: string; badge: string }> = {
  red: { iconBg: 'bg-[#fdecea]', iconText: 'text-[#ea504c]', badge: 'bg-[#ea504c]' },
  orange: { iconBg: 'bg-[#fdf1e3]', iconText: 'text-[#d4943a]', badge: 'bg-[#d4943a]' },
  yellow: { iconBg: 'bg-[#fbf6e0]', iconText: 'text-[#b08a1e]', badge: 'bg-[#c9a227]' },
  purple: { iconBg: 'bg-[#f3edfb]', iconText: 'text-[#8b5cf6]', badge: 'bg-[#8b5cf6]' },
}

function ControlSection({
  id,
  title,
  icon: Icon,
  tone,
  count,
  loading,
  error,
  emptyText,
  children,
}: {
  id?: string
  title: string
  icon: LucideIcon
  tone: SectionTone
  count: number
  loading: boolean
  error: string | null
  emptyText: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  const styles = TONE_STYLES[tone]
  const isEmpty = !loading && !error && count === 0

  return (
    <section id={id} className="scroll-mt-20 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
      {/* Header colapsable */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${styles.iconBg}`}>
          <Icon className={`size-4.5 ${styles.iconText}`} strokeWidth={1.75} />
        </span>
        <span className="flex-1 text-sm font-semibold text-[#3d2c24]">{title}</span>
        {loading ? (
          <Loader2 className="size-4 animate-spin text-[#a39e97]" />
        ) : error ? (
          <span className="rounded-full bg-[#fdecea] px-2 py-0.5 text-[11px] font-semibold text-[#ea504c]">
            Error
          </span>
        ) : count > 0 ? (
          <span
            className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold text-white ${styles.badge}`}
          >
            {count}
          </span>
        ) : (
          <span className="rounded-full bg-[#e8f5f1] px-2 py-0.5 text-[11px] font-semibold text-[#006d5a]">
            OK
          </span>
        )}
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-[#a39e97]" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-[#a39e97]" />
        )}
      </button>

      {/* Contenido */}
      {open && (
        <div className="border-t border-[#ebe6df]">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-[#a39e97]">
              <Loader2 className="size-4 animate-spin" />
              Cargando...
            </div>
          ) : error ? (
            <p className="px-4 py-4 text-sm text-[#ea504c]">{error}</p>
          ) : isEmpty ? (
            <p className="px-4 py-4 text-sm text-[#a39e97]">{emptyText}</p>
          ) : (
            <div className="divide-y divide-[#f3efe9]">{children}</div>
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// SectionRow — ítem linkeable dentro de una sección
// ---------------------------------------------------------------------------

function SectionRow({
  href,
  title,
  detail,
  meta,
}: {
  href: string
  title: string
  detail?: string
  meta?: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#f9f7f3] active:bg-[#f3efe9]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-[#3d2c24]">{title}</p>
          {meta && (
            <span className="shrink-0 rounded-full bg-[#f5f0ea] px-2 py-0.5 text-[10px] font-medium text-[#a39e97]">
              {meta}
            </span>
          )}
        </div>
        {detail && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[#a39e97]">{detail}</p>
        )}
      </div>
      <ChevronRight className="size-4 shrink-0 text-[#d8d2c9]" />
    </Link>
  )
}
