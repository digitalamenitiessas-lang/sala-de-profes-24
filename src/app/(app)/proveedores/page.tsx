'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { isManagerOrAbove } from '@/lib/roles'
import { Truck, Plus, Search, Loader2, RefreshCw, AlertTriangle, ArrowRight, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logAuditClient } from '@/lib/audit'
import { useProfileContext } from '@/lib/hooks/use-profile'
import type { Supplier, SupplierInsert } from '@/types/database'
import { getSemaphore } from '@/components/stock/StockSemaphoreBadge'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/EmptyState'
import type { LowStockItem, SupplierFormData } from './_components/types'
import { EMPTY_FORM } from './_components/types'
import { SupplierCard } from './_components/SupplierCard'
import { LowStockRow } from './_components/LowStockRow'
import { SupplierDialog } from './_components/SupplierDialog'
import { DeleteSupplierDialog } from './_components/DeleteSupplierDialog'
import { AssignItemsDialog } from './_components/AssignItemsDialog'

export default function ProveedoresPage() {
  const { profile, loading: profileLoading } = useProfileContext()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showOnlyWithAlerts, setShowOnlyWithAlerts] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [formData, setFormData] = useState<SupplierFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [assignSupplier, setAssignSupplier] = useState<Supplier | null>(null)
  const [allStockItems, setAllStockItems] = useState<LowStockItem[]>([])

  const isEncargado = isManagerOrAbove(profile?.role)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const [suppRes, stockRes] = await Promise.all([
        supabase.from('suppliers').select('*').eq('is_active', true).order('name', { ascending: true }),
        supabase.from('stock_items').select('id, name, current_qty, min_qty, unit, supplier_id, category, is_produced').eq('is_active', true),
      ])

      if (suppRes.error) throw suppRes.error
      setSuppliers(suppRes.data ?? [])

      // Lo producido en cocina no se compra. bar_stock_items es legado: la barra
      // vive en stock_items (area = 'barra').
      const allStock = ((stockRes.data ?? []) as (LowStockItem & { is_produced: boolean | null })[]).filter((i) => !i.is_produced)
      setAllStockItems(allStock)
      setLowStockItems(allStock.filter((item) => {
        const sem = getSemaphore(item.current_qty, item.min_qty)
        return sem === 'red' || sem === 'yellow'
      }))
    } catch (err) {
      console.error(err)
      toast.error('Error al cargar proveedores')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (profile) fetchData()
  }, [profile, fetchData])

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/fudo/sync/providers', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast.success(`${data.created} nuevos, ${data.synced} actualizados`)
        await fetchData()
      } else {
        toast.error(data.error ?? 'Error al sincronizar')
      }
    } catch {
      toast.error('Error de conexión')
    } finally {
      setSyncing(false)
    }
  }

  const lowStockBySupplier = useMemo(() => {
    const map = new Map<number, LowStockItem[]>()
    for (const item of lowStockItems) {
      if (item.supplier_id) {
        const list = map.get(item.supplier_id) ?? []
        list.push(item)
        map.set(item.supplier_id, list)
      }
    }
    return map
  }, [lowStockItems])

  const unlinkedLowStock = useMemo(() => lowStockItems.filter((i) => !i.supplier_id), [lowStockItems])
  const suppliersWithAlerts = useMemo(() => new Set([...lowStockBySupplier.keys()]), [lowStockBySupplier])

  const filtered = useMemo(() => {
    let result = suppliers
    if (showOnlyWithAlerts) result = result.filter((s) => suppliersWithAlerts.has(s.id))
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((s) =>
        s.name.toLowerCase().includes(q) ||
        s.contact_name?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q) ||
        s.phone?.includes(q),
      )
    }
    return result
  }, [suppliers, searchQuery, showOnlyWithAlerts, suppliersWithAlerts])

  function openCreateDialog() {
    setEditingSupplier(null)
    setFormData(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEditDialog(supplier: Supplier) {
    setEditingSupplier(supplier)
    setFormData({
      name: supplier.name,
      category: supplier.category ?? '',
      contact_name: supplier.contact_name ?? '',
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      notes: supplier.notes ?? '',
      order_days: supplier.order_days ?? [],
      lead_time_days: supplier.lead_time_days?.toString() ?? '',
    })
    setDialogOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formData.name.trim()) { toast.error('El nombre del proveedor es obligatorio'); return }
    setSaving(true)
    try {
      const supabase = createClient()
      const payload: SupplierInsert = {
        name: formData.name.trim(),
        category: formData.category.trim() || 'otros',
        contact_name: formData.contact_name.trim() || null,
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        notes: formData.notes.trim() || null,
        order_days: formData.order_days,
        lead_time_days: formData.lead_time_days ? Number(formData.lead_time_days) : null,
      }
      if (editingSupplier) {
        const { error } = await supabase.from('suppliers').update(payload).eq('id', editingSupplier.id)
        if (error) throw error
        logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'update_supplier', module: 'proveedores', entityType: 'supplier', entityId: String(editingSupplier.id), description: `${profile?.first_name ?? 'User'} editó proveedor: ${formData.name.trim()}` })
        toast.success('Proveedor actualizado')
      } else {
        const { error } = await supabase.from('suppliers').insert(payload)
        if (error) throw error
        logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'create_supplier', module: 'proveedores', entityType: 'supplier', description: `${profile?.first_name ?? 'User'} creó proveedor: ${formData.name.trim()}` })
        toast.success('Proveedor creado')
      }
      setDialogOpen(false)
      fetchData()
    } catch (err) {
      console.error(err)
      toast.error('Error al guardar proveedor')
    } finally {
      setSaving(false)
    }
  }

  function openDeleteDialog(supplier: Supplier) {
    setSupplierToDelete(supplier)
    setDeleteDialogOpen(true)
  }

  async function handleDelete() {
    if (!supplierToDelete) return
    setDeleting(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from('suppliers').update({ is_active: false }).eq('id', supplierToDelete.id)
      if (error) throw error
      logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'delete_supplier', module: 'proveedores', entityType: 'supplier', entityId: String(supplierToDelete.id), description: `${profile?.first_name ?? 'User'} desactivó proveedor: ${supplierToDelete.name}` })
      toast.success('Proveedor eliminado')
      setDeleteDialogOpen(false)
      setSupplierToDelete(null)
      fetchData()
    } catch (err) {
      console.error(err)
      toast.error('Error al eliminar proveedor')
    } finally {
      setDeleting(false)
    }
  }

  function openAssignDialog(supplier: Supplier) {
    setAssignSupplier(supplier)
    setAssignDialogOpen(true)
  }

  function buildWhatsAppMessage(supplier: Supplier): string {
    const items = lowStockBySupplier.get(supplier.id)
    let msg = `Hola, soy de La Vieja Escuela. Te escribo para hacer un pedido.`
    if (items && items.length > 0) {
      msg += `\n\nNecesitamos:`
      for (const item of items) {
        const needed = Math.max(0, item.min_qty - item.current_qty)
        const semaphore = getSemaphore(item.current_qty, item.min_qty)
        const urgency = semaphore === 'red' ? ' (URGENTE)' : ''
        msg += `\n- ${item.name}: quedan ${item.current_qty} ${item.unit}, necesitamos ${needed > 0 ? needed : 'reponer'}${urgency}`
      }
    }
    return msg
  }

  if (profileLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-[#006d5a]" />
          <p className="text-sm text-[#a39e97]">Cargando...</p>
        </div>
      </div>
    )
  }

  if (profile && !isEncargado) {
    return (
      <div className="mx-auto max-w-lg pb-28 pt-2">
        <div className="card-elevated-lg rounded-2xl p-8 text-center">
          <Truck className="mx-auto size-10 text-[#a39e97]" />
          <p className="mt-4 text-sm font-medium text-[#3d2c24]">Acceso restringido</p>
          <p className="mt-1 text-xs text-[#a39e97]">Esta sección es solo para encargados.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative mx-auto max-w-2xl space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#3d2c24]">Proveedores</h1>
          <p className="section-label">Directorio de contactos</p>
        </div>
        {isEncargado && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-3 py-2 text-sm font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-95 disabled:opacity-50"
          >
            {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {syncing ? 'Sincronizando...' : 'Sync Fudo'}
          </button>
        )}
      </div>

      <VinculosAviso />

      {/* Alert banner */}
      {suppliersWithAlerts.size > 0 && (
        <button
          onClick={() => setShowOnlyWithAlerts(!showOnlyWithAlerts)}
          className={`flex w-full items-center gap-3 rounded-2xl p-4 text-left transition-all ${
            showOnlyWithAlerts ? 'bg-[#ea504c]/10 ring-2 ring-[#ea504c]/30' : 'bg-[#fef7ed] ring-1 ring-[#d4943a]/20'
          }`}
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#ea504c]/10">
            <AlertTriangle className="size-5 text-[#ea504c]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#3d2c24]">{lowStockItems.length} productos con stock bajo</p>
            <p className="text-xs text-[#a39e97]">
              {suppliersWithAlerts.size} proveedores necesitan pedido
              {unlinkedLowStock.length > 0 && ` · ${unlinkedLowStock.length} sin proveedor`}
              {' · '}
              <span className="font-medium text-[#006d5a]">{showOnlyWithAlerts ? 'Ver todos' : 'Filtrar'}</span>
            </p>
          </div>
        </button>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
        <Input
          placeholder="Buscar por nombre, contacto, email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-12 rounded-xl border-[#ebe6df] bg-[#faf8f5] pl-10 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-2 focus-visible:ring-[#006d5a]"
        />
      </div>

      {/* Supplier list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Sin proveedores"
          description={
            searchQuery ? 'No se encontraron proveedores con esa busqueda'
            : showOnlyWithAlerts ? 'No hay proveedores con alertas de stock'
            : 'Agrega tu primer proveedor para comenzar'
          }
        />
      ) : (
        <div className="grid gap-3">
          {filtered.map((supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              isEncargado={isEncargado}
              lowStockItems={lowStockBySupplier.get(supplier.id) ?? []}
              linkedCount={allStockItems.filter((i) => i.supplier_id === supplier.id).length}
              whatsAppMessage={buildWhatsAppMessage(supplier)}
              onEdit={() => openEditDialog(supplier)}
              onDelete={() => openDeleteDialog(supplier)}
              onAssign={() => openAssignDialog(supplier)}
            />
          ))}
        </div>
      )}

      {/* Unlinked low stock */}
      {unlinkedLowStock.length > 0 && !searchQuery && (
        <div className="space-y-2 pt-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-[#a39e97]">
            Sin proveedor asignado ({unlinkedLowStock.length})
          </h2>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-[#ebe6df]">
            <div className="space-y-2">
              {unlinkedLowStock.slice(0, 10).map((item) => <LowStockRow key={item.id} item={item} />)}
              {unlinkedLowStock.length > 10 && (
                <p className="pt-1 text-center text-xs text-[#a39e97]">+{unlinkedLowStock.length - 10} más</p>
              )}
            </div>
          </div>
        </div>
      )}

      {isEncargado && (
        <button onClick={openCreateDialog} className="fab" aria-label="Agregar proveedor">
          <Plus className="size-6" />
        </button>
      )}

      <SupplierDialog
        open={dialogOpen}
        onClose={setDialogOpen}
        editingSupplier={editingSupplier}
        formData={formData}
        onFormChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
        onSubmit={handleSubmit}
        saving={saving}
      />

      <DeleteSupplierDialog
        open={deleteDialogOpen}
        onClose={setDeleteDialogOpen}
        supplierName={supplierToDelete?.name}
        onConfirm={handleDelete}
        deleting={deleting}
      />

      <AssignItemsDialog
        open={assignDialogOpen}
        onClose={(o) => { setAssignDialogOpen(o); if (!o) void fetchData() }}
        supplier={assignSupplier}
      />
    </div>
  )
}

// Aviso de vínculos: grande solo mientras haya algo por revisar; si está todo
// en orden queda un acceso chico a días de pedido y vínculos.
function VinculosAviso() {
  const [r, setR] = useState<{ conflictos: number; sin_proveedor: number; calendario: number } | null>(null)
  useEffect(() => {
    let vivo = true
    fetch('/api/proveedores/vinculos?resumen=1', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (vivo) setR(json) })
      .catch(() => {})
    return () => { vivo = false }
  }, [])
  if (!r) return null
  const revisar = r.conflictos + r.sin_proveedor
  if (revisar === 0 && r.calendario === 0) {
    return (
      <Link href="/proveedores/vincular?tab=productos" className="flex items-center justify-end gap-1 text-[12px] font-semibold text-[#006d5a]">
        Vínculos y días de pedido <ArrowRight className="size-3.5" />
      </Link>
    )
  }
  return (
    <Link
      href={revisar > 0 ? '/proveedores/vincular' : '/proveedores/vincular?tab=calendario'}
      className="flex items-center justify-between gap-3 rounded-2xl bg-[#006d5a] px-4 py-3 text-white shadow-sm transition hover:bg-[#005a4a]"
    >
      <div className="flex items-center gap-2.5">
        <Sparkles className="size-5 shrink-0" />
        <div>
          <p className="text-[14px] font-bold leading-tight">
            {revisar > 0 ? `${revisar} insumo${revisar === 1 ? '' : 's'} para revisar` : `${r.calendario} proveedores sin días de pedido`}
          </p>
          <p className="text-[11px] text-white/80">
            {revisar > 0
              ? [r.conflictos > 0 && `${r.conflictos} no coinciden con Fudo`, r.sin_proveedor > 0 && `${r.sin_proveedor} sin proveedor`].filter(Boolean).join(' · ')
              : 'Fudo sugiere qué días se les compra'}
          </p>
        </div>
      </div>
      <ArrowRight className="size-5 shrink-0" />
    </Link>
  )
}
