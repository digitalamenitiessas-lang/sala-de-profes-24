'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  RefreshCw,
  Store,
  Search,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Package,
  MapPin,
  CreditCard,
  Loader2,
  FileSpreadsheet,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MenuCategory = {
  id: number
  name: string
  fudo_category_id: string | null
  sort_order: number | null
}

type MenuItem = {
  id: string
  name: string
  sale_price: number | null
  fudo_product_id: string | null
  menu_category_id: number | null
  is_active: boolean | null
}

type SyncResult = {
  success: boolean
  importedCategories?: number
  importedProducts?: number
  error?: string
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FudoAdminPage() {
  const supabase = createClient()

  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [autoSynced, setAutoSynced] = useState(false)

  // ---------------------------------------------------------------------------
  // Fetch data
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [catRes, itemRes] = await Promise.all([
      supabase
        .from('menu_categories')
        .select('id, name, fudo_category_id, sort_order')
        .order('sort_order'),
      supabase
        .from('menu_items')
        .select('id, name, sale_price, fudo_product_id, menu_category_id, is_active')
        .not('fudo_product_id', 'is', null)
        .order('name'),
    ])

    if (catRes.data) setCategories(catRes.data)
    if (itemRes.data) setItems(itemRes.data)
    setLoading(false)
  }, [supabase])

  // ---------------------------------------------------------------------------
  // Auto-sync on page load (5 min cooldown)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (autoSynced) return
    const COOLDOWN_KEY = 'fudo_last_auto_sync'
    const COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes
    const lastAuto = localStorage.getItem(COOLDOWN_KEY)
    const now = Date.now()

    if (lastAuto && now - Number(lastAuto) < COOLDOWN_MS) {
      setAutoSynced(true)
      return
    }

    setAutoSynced(true)
    setSyncing(true)
    fetch('/api/fudo/sync/products', { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          localStorage.setItem(COOLDOWN_KEY, String(now))
          setLastSync(new Date().toLocaleTimeString('es-AR'))
          toast.success(`Auto-sync: ${data.importedProducts} productos actualizados`)
          fetchData()
        }
      })
      .catch(() => {})
      .finally(() => setSyncing(false))
  }, [autoSynced, fetchData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/fudo/sync/products', { method: 'POST' })
      const data: SyncResult = await res.json()

      if (data.success) {
        toast.success(
          `Sincronizado: ${data.importedCategories} categorías, ${data.importedProducts} productos`,
        )
        setLastSync(new Date().toLocaleTimeString('es-AR'))
        await fetchData()
      } else {
        toast.error(data.error ?? 'Error al sincronizar')
      }
    } catch {
      toast.error('Error de conexión con Fudo')
    } finally {
      setSyncing(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const filtered = search.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : items

  const itemsByCategory = categories
    .filter((c) => c.fudo_category_id)
    .map((cat) => ({
      ...cat,
      items: filtered.filter((i) => i.menu_category_id === cat.id),
    }))
    .filter((group) => group.items.length > 0)

  const uncategorized = filtered.filter(
    (i) => !i.menu_category_id || !categories.some((c) => c.id === i.menu_category_id),
  )

  const totalActive = items.filter((i) => i.is_active).length
  const totalInactive = items.filter((i) => !i.is_active).length

  function toggleCat(catId: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  function expandAll() {
    setExpandedCats(new Set(categories.map((c) => String(c.id))))
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-lg font-bold text-[#3d2c24]">
            Fudo POS
          </h1>
          <p className="text-xs text-[#a39e97]">
            Productos y categorías sincronizados
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-95 disabled:opacity-50"
        >
          {syncing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {syncing ? 'Sincronizando...' : 'Sincronizar'}
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-white p-3 ring-1 ring-[#ebe6df]">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase text-[#a39e97]">
            <Package className="size-3" />
            Productos
          </div>
          <p className="mt-1 font-display text-xl font-bold text-[#3d2c24]">
            {items.length}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-3 ring-1 ring-[#ebe6df]">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase text-[#a39e97]">
            <Store className="size-3" />
            Categorías
          </div>
          <p className="mt-1 font-display text-xl font-bold text-[#3d2c24]">
            {categories.filter((c) => c.fudo_category_id).length}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-3 ring-1 ring-[#ebe6df]">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase text-[#006d5a]">
            <DollarSign className="size-3" />
            Activos
          </div>
          <p className="mt-1 font-display text-xl font-bold text-[#006d5a]">
            {totalActive}
          </p>
          {totalInactive > 0 && (
            <p className="text-[10px] text-[#a39e97]">{totalInactive} inactivos</p>
          )}
        </div>
      </div>

      {lastSync && (
        <p className="text-center text-[10px] text-[#a39e97]">
          Última sync: {lastSync}
        </p>
      )}

      {/* Importar recetas desde el export XLS de Fudo */}
      <Link href="/admin/fudo/importar">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df] transition-all active:scale-[0.99]">
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#006d5a]/10">
              <FileSpreadsheet className="size-5 text-[#006d5a]" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[#3d2c24]">Importar recetas</span>
              <span className="block truncate text-xs text-[#a39e97]">
                Subí el export productos.xls del panel de Fudo
              </span>
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-[#d1cdc7]" />
        </div>
      </Link>

      {/* Paralelo LVE vs Fudo — motor de stock propio en sombra */}
      <Link href="/admin/fudo/paralelo">
        <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df] transition-all active:scale-[0.99]">
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#006d5a]/10">
              <Activity className="size-5 text-[#006d5a]" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[#3d2c24]">Paralelo LVE vs Fudo</span>
              <span className="block truncate text-xs text-[#a39e97]">
                El motor de stock propio comparado contra Fudo, día por día
              </span>
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-[#d1cdc7]" />
        </div>
      </Link>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#c4bfb8]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto..."
          className="w-full rounded-xl border border-[#ebe6df] bg-white py-2.5 pl-9 pr-3 text-sm text-[#3d2c24] outline-none placeholder:text-[#c4bfb8] focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]/20"
        />
      </div>

      {/* Expand all */}
      {!search && (
        <button
          onClick={expandAll}
          className="text-xs font-medium text-[#006d5a] hover:underline"
        >
          Expandir todas las categorías
        </button>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-[#006d5a]" />
        </div>
      )}

      {/* Categories & Products */}
      {!loading && (
        <div className="space-y-2">
          {itemsByCategory.map((group) => {
            const isExpanded = expandedCats.has(String(group.id)) || !!search.trim()
            return (
              <div
                key={group.id}
                className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]"
              >
                {/* Category header */}
                <button
                  onClick={() => toggleCat(String(group.id))}
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[#faf8f5]"
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? (
                      <ChevronDown className="size-4 text-[#006d5a]" />
                    ) : (
                      <ChevronRight className="size-4 text-[#a39e97]" />
                    )}
                    <span className="text-sm font-semibold text-[#3d2c24]">
                      {group.name}
                    </span>
                  </div>
                  <span className="rounded-full bg-[#f5f0eb] px-2 py-0.5 text-[10px] font-semibold text-[#a39e97]">
                    {group.items.length}
                  </span>
                </button>

                {/* Items */}
                {isExpanded && (
                  <div className="border-t border-[#ebe6df]">
                    {group.items.map((item) => (
                      <ProductRow key={item.id} item={item} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {/* Uncategorized */}
          {uncategorized.length > 0 && (
            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
              <div className="px-4 py-3">
                <span className="text-sm font-semibold text-[#a39e97]">
                  Sin categoría ({uncategorized.length})
                </span>
              </div>
              <div className="border-t border-[#ebe6df]">
                {uncategorized.map((item) => (
                  <ProductRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}

          {filtered.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-12">
              <Store className="size-8 text-[#ebe6df]" />
              <p className="mt-2 text-sm text-[#a39e97]">
                {search ? 'Sin resultados' : 'No hay productos sincronizados'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Discrepancias LVE ↔ Fudo */}
      <div className="space-y-2 pt-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-[#a39e97]">
          Discrepancias con Fudo
        </h2>
        <DiscrepanciasSection />
      </div>

      {/* Fudo info cards */}
      <div className="space-y-2 pt-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-[#a39e97]">
          Datos del POS
        </h2>
        <FudoInfoCards />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Discrepancias LVE ↔ Fudo — reporte de /api/admin/fudo/audit en 4 grupos
// simples, cada uno con su acción para resolver.
// ---------------------------------------------------------------------------

type AuditIssueItem = { key: string; name: string; detail: string }
type AuditGroup = {
  id: string
  title: string
  action: { label: string; href: string } | null
  hint: string
  items: AuditIssueItem[]
}

const STOCK_ISSUE_LABELS: Record<string, string> = {
  fudo_product_missing: 'el producto ya no existe en Fudo',
  fudo_ingredient_missing: 'el ingrediente ya no existe en Fudo',
  product_stock_null: 'sin stock cargado en Fudo',
  ingredient_stock_null: 'sin stock cargado en Fudo',
  product_stockControl_false: 'sin control de stock activado en Fudo',
  ingredient_stockControl_false: 'sin control de stock activado en Fudo',
  stock_mismatch_ge_1: 'stock LVE ≠ stock Fudo',
  name_mismatch: 'nombre distinto en Fudo',
  unit_suspect_fractional_unit: 'cantidad fraccionada en unidad entera',
}

function DiscrepanciasSection() {
  const [groups, setGroups] = useState<AuditGroup[] | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loadingAudit, setLoadingAudit] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  const loadAudit = useCallback(async () => {
    setLoadingAudit(true)
    setAuditError(null)
    try {
      const res = await fetch('/api/admin/fudo/audit')
      const report = await res.json()
      if (!res.ok) throw new Error(report.error ?? 'No se pudo correr la auditoría')

      const missing: AuditIssueItem[] = [
        ...(report.missingStockControlledProducts ?? []).map((p: { id: string; name: string | null; stock: number | null }) => ({
          key: `mp-${p.id}`,
          name: p.name ?? `Producto ${p.id}`,
          detail: `producto Fudo con stock ${p.stock ?? '—'} sin item en LVE`,
        })),
        ...(report.missingStockControlledIngredients ?? []).map((i: { id: string; name: string | null; stock: number | null }) => ({
          key: `mi-${i.id}`,
          name: i.name ?? `Ingrediente ${i.id}`,
          detail: `ingrediente Fudo con stock ${i.stock ?? '—'} sin item en LVE`,
        })),
      ]

      const stockIssues: AuditIssueItem[] = (report.stockIssues ?? []).map((issue: { id: string; name: string; issues: string[]; fudo_stock: number | null; current_qty: number }) => ({
        key: `si-${issue.id}`,
        name: issue.name,
        detail: issue.issues.map((code) => STOCK_ISSUE_LABELS[code] ?? code).join(' · ')
          + (issue.issues.includes('stock_mismatch_ge_1') ? ` (LVE ${issue.current_qty} / Fudo ${issue.fudo_stock ?? '—'})` : ''),
      }))

      const menuIssues: AuditIssueItem[] = (report.menuIssues ?? []).map((issue: { id: string; name: string; issues: string[]; app_price: number | null; fudo_price: number | null; fudo_name: string | null }) => ({
        key: `me-${issue.id}`,
        name: issue.name,
        detail: issue.issues
          .map((code) => code === 'price_mismatch'
            ? `precio LVE $${issue.app_price ?? '—'} / Fudo $${issue.fudo_price ?? '—'}`
            : code === 'name_mismatch'
              ? `en Fudo se llama “${issue.fudo_name}”`
              : 'activo/inactivo distinto en Fudo')
          .join(' · '),
      }))

      const duplicates: AuditIssueItem[] = [
        ...(report.duplicateProductLinks ?? []).map((d: { id: string; names: string[] }) => ({
          key: `dp-${d.id}`,
          name: d.names.join(' + '),
          detail: `mismo producto Fudo (${d.id}) vinculado a varios items`,
        })),
        ...(report.duplicateIngredientLinks ?? []).map((d: { id: string; names: string[] }) => ({
          key: `di-${d.id}`,
          name: d.names.join(' + '),
          detail: `mismo ingrediente Fudo (${d.id}) vinculado a varios items`,
        })),
      ]

      setGroups([
        {
          id: 'missing',
          title: 'Faltan en LVE',
          hint: 'Tienen control de stock en Fudo pero ningún item acá. Se crean/vinculan desde Mapeo.',
          action: { label: 'Ir a Mapeo', href: '/admin/stock/mapeo' },
          items: missing,
        },
        {
          id: 'stock',
          title: 'Stock / vínculos con problemas',
          hint: 'Diferencias entre lo que dice LVE y lo que dice Fudo. Un “Traer datos de Fudo” en Stock suele alinearlos; si persiste, revisá el vínculo.',
          action: { label: 'Abrir Stock', href: '/stock' },
          items: stockIssues,
        },
        {
          id: 'menu',
          title: 'Menú: nombre o precio distinto',
          hint: 'Se corrigen solos con el botón Sincronizar de arriba (Fudo manda).',
          action: null,
          items: menuIssues,
        },
        {
          id: 'dup',
          title: 'Vínculos duplicados',
          hint: 'Dos items apuntando al mismo producto/ingrediente de Fudo: hay que desvincular uno en Mapeo.',
          action: { label: 'Ir a Mapeo', href: '/admin/stock/mapeo' },
          items: duplicates,
        },
      ])
      setGeneratedAt(report.generatedAt ?? null)
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Error al auditar')
    } finally {
      setLoadingAudit(false)
    }
  }, [])

  useEffect(() => {
    loadAudit()
  }, [loadAudit])

  const totalIssues = (groups ?? []).reduce((sum, g) => sum + g.items.length, 0)

  return (
    <div className="rounded-2xl bg-white ring-1 ring-[#ebe6df]">
      <div className="flex items-center justify-between border-b border-[#ebe6df]/60 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-[#3d2c24]">
            {loadingAudit && !groups
              ? 'Comparando LVE con Fudo…'
              : totalIssues === 0
                ? 'Todo alineado con Fudo ✓'
                : `${totalIssues} discrepancias para resolver`}
          </p>
          {generatedAt && (
            <p className="text-[10px] text-[#a39e97]">
              Última auditoría: {new Date(generatedAt).toLocaleTimeString('es-AR')}
            </p>
          )}
        </div>
        <button
          onClick={loadAudit}
          disabled={loadingAudit}
          className="flex items-center gap-1.5 rounded-xl bg-[#f3efe9] px-3 py-2 text-xs font-semibold text-[#3d2c24] transition-all active:scale-95 disabled:opacity-50"
        >
          {loadingAudit ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Auditar
        </button>
      </div>

      {auditError && (
        <p className="px-4 py-3 text-xs text-[#ea504c]">{auditError}</p>
      )}

      {groups?.filter((g) => g.items.length > 0).map((group) => {
        const open = openGroup === group.id
        return (
          <div key={group.id} className="border-b border-[#ebe6df]/50 last:border-b-0">
            <button
              onClick={() => setOpenGroup(open ? null : group.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold text-[#3d2c24]">
                {group.title}
                <span className="ml-2 rounded-full bg-[#fff7f7] px-2 py-0.5 text-[11px] font-bold text-[#ea504c] ring-1 ring-[#f3d0cf]">
                  {group.items.length}
                </span>
              </span>
              {open ? <ChevronDown className="size-4 text-[#a39e97]" /> : <ChevronRight className="size-4 text-[#a39e97]" />}
            </button>
            {open && (
              <div className="px-4 pb-3">
                <p className="mb-2 text-[11px] leading-relaxed text-[#a39e97]">{group.hint}</p>
                <div className="space-y-1.5">
                  {group.items.map((item) => (
                    <div key={item.key} className="rounded-xl bg-[#faf8f5] px-3 py-2">
                      <p className="text-xs font-semibold text-[#3d2c24]">{item.name}</p>
                      <p className="text-[11px] text-[#7d6c64]">{item.detail}</p>
                    </div>
                  ))}
                </div>
                {group.action && (
                  <a
                    href={group.action.href}
                    className="mt-2 inline-flex items-center gap-1 rounded-xl bg-[#006d5a] px-3 py-2 text-xs font-semibold text-white active:scale-95"
                  >
                    {group.action.label}
                    <ChevronRight className="size-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Product row
// ---------------------------------------------------------------------------

function ProductRow({ item }: { item: MenuItem }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between border-b border-[#ebe6df]/50 px-4 py-2.5 last:border-b-0',
        !item.is_active && 'opacity-40',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            item.is_active ? 'bg-[#006d5a]' : 'bg-[#ea504c]',
          )}
        />
        <span className="truncate text-sm text-[#3d2c24]">{item.name}</span>
      </div>
      <span className="shrink-0 pl-2 text-xs font-semibold tabular-nums text-[#3d2c24]">
        ${item.sale_price?.toLocaleString('es-AR') ?? '—'}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fudo info cards — rooms, tables, payment methods
// ---------------------------------------------------------------------------

function FudoInfoCards() {
  const [data, setData] = useState<{
    rooms: { name: string; tableCount: number }[]
    paymentMethods: { name: string; active: boolean }[]
  } | null>(null)

  useEffect(() => {
    fetch('/api/fudo/info')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
  }, [])

  if (!data) return null

  return (
    <div className="grid grid-cols-2 gap-2">
      {/* Rooms & Tables */}
      <div className="rounded-2xl bg-white p-3 ring-1 ring-[#ebe6df]">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase text-[#a39e97]">
          <MapPin className="size-3" />
          Salones & Mesas
        </div>
        <div className="space-y-1">
          {data.rooms.map((room) => (
            <div key={room.name} className="flex items-center justify-between">
              <span className="text-xs text-[#3d2c24]">{room.name}</span>
              <span className="text-[10px] font-semibold text-[#a39e97]">
                {room.tableCount} mesas
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Payment Methods */}
      <div className="rounded-2xl bg-white p-3 ring-1 ring-[#ebe6df]">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase text-[#a39e97]">
          <CreditCard className="size-3" />
          Medios de pago
        </div>
        <div className="space-y-1">
          {data.paymentMethods.map((pm) => (
            <div key={pm.name} className="flex items-center gap-1.5">
              <div
                className={cn(
                  'size-1.5 rounded-full',
                  pm.active ? 'bg-[#006d5a]' : 'bg-[#ea504c]',
                )}
              />
              <span className="text-xs text-[#3d2c24]">{pm.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
