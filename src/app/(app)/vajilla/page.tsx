'use client'

import { useEffect, useState, useCallback } from 'react'
import { isManagerOrAbove } from '@/lib/roles'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { logAuditClient } from '@/lib/audit'
import {
  Wine, UtensilsCrossed, Coffee, GlassWater, Grip,
  Pencil, Check, X, Minus, Plus, ClipboardCheck, Trash2, PlusCircle,
} from 'lucide-react'
import Link from 'next/link'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { LoadingState } from '@/components/ui/LoadingState'
import { Input } from '@/components/ui/input'

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type VajillaItem = {
  id: number
  item_name: string
  category: string
  quantity: number
  notes: string | null
}

const CATEGORIES: Record<string, { label: string; icon: typeof Wine; color: string; bg: string }> = {
  tazas_y_pocillos: { label: 'Tazas y Pocillos', icon: Coffee, color: '#8b5e34', bg: '#faf0e4' },
  vasos_y_copas:    { label: 'Vasos y Copas', icon: Wine, color: '#2d7d6a', bg: '#e8f5f1' },
  servicio:         { label: 'Servicio', icon: Grip, color: '#c67b4b', bg: '#fef3eb' },
  bebidas:          { label: 'Bebidas', icon: GlassWater, color: '#4a90d9', bg: '#eef4fc' },
  accesorios:       { label: 'Accesorios', icon: UtensilsCrossed, color: '#a39e97', bg: '#f3efe9' },
}

const CATEGORY_ORDER = ['tazas_y_pocillos', 'vasos_y_copas', 'servicio', 'bebidas', 'accesorios']
const CATEGORY_OPTIONS = CATEGORY_ORDER.map((k) => ({ value: k, label: CATEGORIES[k].label }))

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function VajillaPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [items, setItems] = useState<VajillaItem[]>([])
  const [loading, setLoading] = useState(true)

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editQty, setEditQty] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Add new state
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newQty, setNewQty] = useState('')
  const [newCategory, setNewCategory] = useState('accesorios')
  const [newNotes, setNewNotes] = useState('')

  // Delete confirm
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // Recuento (audit) mode
  const [recuentoMode, setRecuentoMode] = useState(false)
  const [recuentoQtys, setRecuentoQtys] = useState<Record<number, number>>({})
  const [savingRecuento, setSavingRecuento] = useState(false)

  const startRecuento = () => {
    // Pre-fill with current quantities
    const qtys: Record<number, number> = {}
    items.forEach((i) => { qtys[i.id] = i.quantity })
    setRecuentoQtys(qtys)
    setRecuentoMode(true)
  }

  const updateRecuentoQty = (id: number, val: number) => {
    setRecuentoQtys((prev) => ({ ...prev, [id]: Math.max(0, val) }))
  }

  const cancelRecuento = () => {
    setRecuentoMode(false)
    setRecuentoQtys({})
  }

  const saveRecuento = async () => {
    setSavingRecuento(true)
    try {
      const supabase = createClient()

      // Update all quantities that changed
      const updates = items.filter((i) => recuentoQtys[i.id] !== i.quantity)
      for (const item of updates) {
        await supabase
          .from('vajilla_stock')
          .update({ quantity: recuentoQtys[item.id] ?? item.quantity })
          .eq('id', item.id)
      }

      // Save snapshot (audit)
      const res = await fetch('/api/stock/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'vajilla',
          type: 'audit',
          label: `Recuento ${new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
        }),
      })

      if (!res.ok) throw new Error('Error al guardar auditoría')

      toast.success(`Auditoría guardada — ${updates.length} cambio${updates.length !== 1 ? 's' : ''} registrado${updates.length !== 1 ? 's' : ''}`)
      for (const item of updates) {
        logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'update_vajilla_qty', module: 'vajilla', entityType: 'vajilla_stock', description: `User contó vajilla: ${item.item_name} ${recuentoQtys[item.id]}` })
      }
      setRecuentoMode(false)
      setRecuentoQtys({})
      await fetchItems()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSavingRecuento(false)
    }
  }

  const canEdit = isManagerOrAbove(profile?.role)

  const fetchItems = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('vajilla_stock')
      .select('*')
      .order('category')
      .order('item_name')
    setItems(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!profileLoading) fetchItems()
  }, [profileLoading, fetchItems])

  // ---- Edit ----
  const startEdit = (item: VajillaItem) => {
    setEditingId(item.id)
    setEditName(item.item_name)
    setEditQty(String(item.quantity))
    setEditCategory(item.category)
    setEditNotes(item.notes ?? '')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditQty('')
    setEditCategory('')
    setEditNotes('')
  }

  const saveEdit = async (id: number) => {
    if (!editName.trim()) { toast.error('Nombre requerido'); return }
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('vajilla_stock')
      .update({
        item_name: editName.trim(),
        quantity: parseInt(editQty) || 0,
        category: editCategory,
        notes: editNotes.trim() || null,
      })
      .eq('id', id)

    if (error) {
      toast.error('Error al guardar')
    } else {
      toast.success('Actualizado')
      logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'update_vajilla_item', module: 'vajilla', entityType: 'vajilla_stock', description: `User editó vajilla: ${editName.trim()}` })
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, item_name: editName.trim(), quantity: parseInt(editQty) || 0, category: editCategory, notes: editNotes.trim() || null }
            : i,
        ),
      )
      cancelEdit()
    }
    setSaving(false)
  }

  const adjustQty = (delta: number) => {
    setEditQty(String(Math.max(0, (parseInt(editQty) || 0) + delta)))
  }

  // ---- Add new ----
  const addItem = async () => {
    if (!newName.trim()) { toast.error('Nombre requerido'); return }
    setSaving(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('vajilla_stock')
      .insert({
        item_name: newName.trim(),
        quantity: parseInt(newQty) || 0,
        category: newCategory,
        notes: newNotes.trim() || null,
      })
      .select()
      .single()

    if (error) {
      toast.error('Error al crear')
    } else {
      toast.success(`"${newName.trim()}" agregado`)
      logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'create_vajilla_item', module: 'vajilla', entityType: 'vajilla_stock', description: `User agregó vajilla: ${newName.trim()}` })
      setItems((prev) => [...prev, data as VajillaItem].sort((a, b) => a.category.localeCompare(b.category) || a.item_name.localeCompare(b.item_name)))
      setShowAdd(false)
      setNewName('')
      setNewQty('')
      setNewCategory('accesorios')
      setNewNotes('')
    }
    setSaving(false)
  }

  // ---- Delete ----
  const deleteItem = async (id: number) => {
    const supabase = createClient()
    const { error } = await supabase.from('vajilla_stock').delete().eq('id', id)
    if (error) {
      toast.error('Error al eliminar')
    } else {
      const deleted = items.find((i) => i.id === id)
      toast.success('Eliminado')
      logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'delete_vajilla_item', module: 'vajilla', entityType: 'vajilla_stock', description: `User eliminó vajilla: ${deleted?.item_name ?? id}` })
      setItems((prev) => prev.filter((i) => i.id !== id))
      setDeletingId(null)
    }
  }

  if (profileLoading || loading) return <LoadingState />

  // Group by category
  const grouped = CATEGORY_ORDER
    .map((cat) => ({
      key: cat,
      config: CATEGORIES[cat],
      items: items.filter((i) => i.category === cat),
    }))
    .filter((g) => g.items.length > 0)

  const totalItems = items.reduce((s, i) => s + i.quantity, 0)
  const totalTypes = items.length
  const withNotes = items.filter((i) => i.notes).length

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-28">
      {/* Recuento banner */}
      {recuentoMode && (
        <div className="rounded-2xl border-2 border-[#006d5a] bg-[#e8f5f1] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#006d5a]">
                <ClipboardCheck className="size-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#006d5a]">Recuento en curso</p>
                <p className="text-[11px] text-[#006d5a]/70">Contá cada item y ajustá la cantidad</p>
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={cancelRecuento}
              className="flex-1 rounded-xl border border-[#006d5a]/30 py-2.5 text-sm font-semibold text-[#006d5a] transition-colors hover:bg-white"
            >
              Cancelar
            </button>
            <button
              onClick={saveRecuento}
              disabled={savingRecuento}
              className="flex-1 rounded-xl bg-[#006d5a] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#005a4a] disabled:opacity-50"
            >
              {savingRecuento ? 'Guardando...' : '✓ Guardar auditoría'}
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-[#3d2c24]">Vajilla</h1>
            <p className="section-label mt-0.5">Inventario de vajilla y accesorios</p>
          </div>
          <div className="flex gap-2">
            {canEdit && !recuentoMode && (
              <button
                onClick={startRecuento}
                className="flex items-center gap-1.5 rounded-full bg-[#006d5a] px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-[#005a4a]"
              >
                <ClipboardCheck className="size-3.5" />
                Iniciar recuento
              </button>
            )}
            <Link
              href="/stock/historial"
              className="flex items-center gap-1.5 rounded-full bg-[#e8f5f1] px-3 py-1.5 text-[11px] font-bold text-[#006d5a] transition-colors hover:bg-[#c0e4da]"
            >
              <ClipboardCheck className="size-3.5" />
              Historial
            </Link>
          </div>
        </div>
      </FadeIn>

      {/* KPIs */}
      <StaggerList className="grid grid-cols-3 gap-2.5" staggerDelay={0.04}>
        <StaggerItem>
          <div className="kpi-card card-elevated rounded-xl p-4 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Piezas</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
              <AnimatedNumber value={totalItems} />
            </p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="kpi-card card-elevated rounded-xl p-4 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Items</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
              <AnimatedNumber value={totalTypes} />
            </p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="kpi-card card-elevated rounded-xl p-4 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Observ.</p>
            <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${withNotes > 0 ? 'text-[#d4943a]' : 'text-[#006d5a]'}`}>
              <AnimatedNumber value={withNotes} />
            </p>
          </div>
        </StaggerItem>
      </StaggerList>

      {/* Add new item form */}
      {canEdit && showAdd && (
        <FadeIn>
          <div className="card-elevated-lg rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold text-[#3d2c24]">Agregar item</p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre (ej: Platos hondos)"
              className="rounded-lg border-[#ebe6df] bg-[#faf8f5] text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                placeholder="Cantidad"
                className="rounded-lg border-[#ebe6df] bg-[#faf8f5] text-sm"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-3 text-sm text-[#3d2c24]"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <Input
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Notas (opcional)"
              className="rounded-lg border-[#ebe6df] bg-[#faf8f5] text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={addItem}
                disabled={saving || !newName.trim()}
                className="flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-4 py-2 text-xs font-semibold text-white active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="size-3.5" /> Agregar
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="flex items-center gap-1.5 rounded-xl bg-[#f3efe9] px-4 py-2 text-xs font-medium text-[#a39e97] active:scale-95"
              >
                Cancelar
              </button>
            </div>
          </div>
        </FadeIn>
      )}

      {/* Categories */}
      {grouped.map((group, gi) => {
        const Icon = group.config.icon
        const groupTotal = group.items.reduce((s, i) => s + i.quantity, 0)

        return (
          <FadeIn key={group.key} delay={0.05 * (gi + 1)}>
            <div className="space-y-2">
              {/* Category header */}
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <div
                    className="flex size-7 items-center justify-center rounded-lg"
                    style={{ backgroundColor: group.config.bg }}
                  >
                    <Icon className="size-3.5" style={{ color: group.config.color }} />
                  </div>
                  <span className="text-sm font-semibold text-[#3d2c24]">{group.config.label}</span>
                </div>
                <span className="text-xs font-bold tabular-nums text-[#a39e97]">{groupTotal} pzas</span>
              </div>

              {/* Items */}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isEditing = editingId === item.id
                  const isDeleting = deletingId === item.id

                  return (
                    <div
                      key={item.id}
                      className="card-elevated flex items-center gap-3 rounded-xl px-4 py-3"
                      style={{ borderLeftWidth: '3px', borderLeftColor: group.config.color }}
                    >
                      {isDeleting ? (
                        /* Delete confirmation */
                        <div className="flex-1 space-y-2">
                          <p className="text-sm font-medium text-[#ea504c]">¿Eliminar &quot;{item.item_name}&quot;?</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => deleteItem(item.id)}
                              className="flex items-center gap-1 rounded-lg bg-[#ea504c] px-3 py-1.5 text-xs font-semibold text-white active:scale-95"
                            >
                              <Trash2 className="size-3" /> Sí, eliminar
                            </button>
                            <button
                              onClick={() => setDeletingId(null)}
                              className="rounded-lg bg-[#f3efe9] px-3 py-1.5 text-xs font-medium text-[#a39e97] active:scale-95"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : isEditing ? (
                        /* Edit mode */
                        <div className="flex-1 space-y-2">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Nombre"
                            className="h-8 rounded-lg border-[#ebe6df] bg-[#faf8f5] text-sm font-medium text-[#3d2c24]"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => adjustQty(-1)}
                              className="flex size-10 items-center justify-center rounded-lg bg-[#f3efe9] text-[#3d2c24] active:scale-95"
                            >
                              <Minus className="size-4" />
                            </button>
                            <Input
                              type="number"
                              value={editQty}
                              onChange={(e) => setEditQty(e.target.value)}
                              className="h-10 w-16 rounded-lg border-[#ebe6df] bg-[#faf8f5] text-center text-sm font-bold tabular-nums text-[#3d2c24]"
                            />
                            <button
                              onClick={() => adjustQty(1)}
                              className="flex size-10 items-center justify-center rounded-lg bg-[#f3efe9] text-[#3d2c24] active:scale-95"
                            >
                              <Plus className="size-4" />
                            </button>
                          </div>
                          <select
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                            className="w-full rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-3 py-1.5 text-xs text-[#3d2c24]"
                          >
                            {CATEGORY_OPTIONS.map((c) => (
                              <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                          </select>
                          <Input
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            placeholder="Notas (ej: 2 fallas)"
                            className="h-8 rounded-lg border-[#ebe6df] bg-[#faf8f5] text-xs text-[#3d2c24]"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit(item.id)}
                              disabled={saving}
                              className="flex items-center gap-1 rounded-lg bg-[#006d5a] px-3 py-1.5 text-xs font-semibold text-white active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Check className="size-3" /> Guardar
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="flex items-center gap-1 rounded-lg bg-[#f3efe9] px-3 py-1.5 text-xs font-medium text-[#a39e97] active:scale-95"
                            >
                              <X className="size-3" /> Cancelar
                            </button>
                            <button
                              onClick={() => { cancelEdit(); setDeletingId(item.id) }}
                              className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[#ea504c] hover:bg-[#fef2f2] active:scale-95"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        </div>
                      ) : recuentoMode ? (
                        /* Recuento mode — inline qty edit */
                        <>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[#3d2c24]">{item.item_name}</p>
                            {item.notes && (
                              <p className="mt-0.5 text-[11px] text-[#d4943a]">⚠ {item.notes}</p>
                            )}
                            {(recuentoQtys[item.id] ?? item.quantity) !== item.quantity && (
                              <p className="mt-0.5 text-[11px] text-[#006d5a]">
                                Antes: {item.quantity} → Ahora: {recuentoQtys[item.id]}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => updateRecuentoQty(item.id, (recuentoQtys[item.id] ?? item.quantity) - 1)}
                              className="flex size-9 items-center justify-center rounded-lg bg-[#f3efe9] text-[#3d2c24] active:scale-95"
                            >
                              <Minus className="size-4" />
                            </button>
                            <input
                              type="number"
                              value={recuentoQtys[item.id] ?? item.quantity}
                              onChange={(e) => updateRecuentoQty(item.id, parseInt(e.target.value) || 0)}
                              className="h-9 w-14 rounded-lg border border-[#006d5a]/30 bg-[#e8f5f1] text-center text-sm font-bold tabular-nums text-[#006d5a] outline-none"
                            />
                            <button
                              onClick={() => updateRecuentoQty(item.id, (recuentoQtys[item.id] ?? item.quantity) + 1)}
                              className="flex size-9 items-center justify-center rounded-lg bg-[#f3efe9] text-[#3d2c24] active:scale-95"
                            >
                              <Plus className="size-4" />
                            </button>
                          </div>
                        </>
                      ) : (
                        /* Display mode */
                        <>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[#3d2c24]">{item.item_name}</p>
                            {item.notes && (
                              <p className="mt-0.5 text-[11px] text-[#d4943a]">⚠ {item.notes}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="min-w-[2.5rem] text-right font-display text-lg font-bold tabular-nums text-[#3d2c24]">
                              {item.quantity}
                            </span>
                            {canEdit && (
                              <button
                                onClick={() => startEdit(item)}
                                className="icon-btn flex size-10 items-center justify-center rounded-lg text-[#a39e97] transition-colors hover:bg-[#f3efe9] hover:text-[#3d2c24]"
                              >
                                <Pencil className="size-4" />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </FadeIn>
        )
      })}

      {/* FAB — Add item */}
      {canEdit && !showAdd && (
        <button
          onClick={() => setShowAdd(true)}
          className="fab fixed bottom-24 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-[#006d5a] text-white shadow-lg shadow-[#006d5a]/25 transition-all active:scale-95 hover:shadow-xl"
        >
          <PlusCircle className="size-6" />
        </button>
      )}
    </div>
  )
}
