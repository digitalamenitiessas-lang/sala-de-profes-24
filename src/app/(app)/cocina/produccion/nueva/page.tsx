'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, Check, Plus, Trash2,
  Package, AlertTriangle, Loader2, Leaf, TrendingUp, BookmarkPlus, ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { FadeIn } from '@/components/ui/motion'
import { PRODUCTION_BATCHES, matchIngredientToStock, type ProductionBatch } from '@/lib/recipes/production-batches'
import { convertQty } from '@/lib/produccion/units'
import { esCostoConfiable } from '@/lib/costos/confiable'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StockItem = {
  id: string
  name: string
  unit: string
  current_qty: number
  cost_per_unit: number
  /** Fuente del costo (migración 20260909); solo compra/manual/produccion valen.
   *  undefined = la API todavía no manda la columna (migración pendiente). */
  cost_source?: string | null
  shelf_life_days: number | null
  fudo_ingredient_id: string | null
  fudo_product_id: string | null
  fudo_skip: boolean | null
}

type Template = {
  id: number
  name: string
  description: string | null
  input_stock_item_id: string | null
  input_unit: string
  input_stock_item: { id: string; name: string; unit: string } | null
  inputs: {
    stock_item_id: string | null
    qty: number | null
    unit: string | null
    stock_items?: { id: string; name: string; unit: string } | null
  }[]
  outputs: {
    id: number
    stock_item_id: string | null
    output_name: string
    theoretical_yield_pct: number
    default_qty?: number | null
    output_unit: string
    is_waste: boolean
    notes: string | null
  }[]
}

type OutputRow = {
  localId: string
  stock_item_id: string | null
  stock_item_name: string
  output_name: string
  qty_produced: string
  theoretical_qty: number | null
  unit: string
  is_waste: boolean
  notes: string
  lot_code: string
  expires_on: string
}

type InputRow = {
  localId: string
  stock_item_id: string | null
  stock_item_name: string
  qty_used: string
  unit: string
  fromBatch?: boolean
  batchIngredientName?: string  // nombre original en la receta, para hint y re-escala
}

// Mapea unidades del recetario a las del wizard
const BATCH_UNIT_MAP: Record<string, string> = {
  g: 'g', ml: 'ml', kg: 'kg', lt: 'lt', u: 'unidad', unidad: 'unidad',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _localId = 0
function nextId() { return `local_${++_localId}` }

function makeInputRow(item: StockItem | null = null, unit = 'kg'): InputRow {
  return {
    localId: nextId(),
    stock_item_id: item?.id ?? null,
    stock_item_name: item?.name ?? '',
    qty_used: '',
    unit: item?.unit ?? unit,
  }
}

function formatQty(n: number) {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(3).replace(/\.?0+$/, '')
}

function formatMoney(n: number) {
  return `$${Math.round(n).toLocaleString('es-AR')}`
}

function toLocalDateInput(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDaysToDateInput(dateInput: string, days: number) {
  if (!dateInput || Number.isNaN(days)) return ''
  const base = new Date(`${dateInput}T00:00:00`)
  if (Number.isNaN(base.getTime())) return ''
  base.setDate(base.getDate() + days)
  return toLocalDateInput(base)
}

function dateInputToIso(dateInput: string) {
  if (!dateInput) return null
  const date = new Date(`${dateInput}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function suggestedExpiryDate(item: Pick<StockItem, 'shelf_life_days'> | null, productionDate: string) {
  if (!item || item.shelf_life_days == null) return ''
  return addDaysToDateInput(productionDate, item.shelf_life_days)
}

function getStockSource(item: StockItem | null) {
  if (!item) return null
  if (item.fudo_product_id) return { label: 'Fudo producto', tone: 'bg-[#e8f5f1] text-[#006d5a]', actionable: true }
  if (item.fudo_ingredient_id) return { label: 'Fudo insumo', tone: 'bg-[#e8f5f1] text-[#006d5a]', actionable: true }
  if (item.fudo_skip === true) return { label: 'Local LVE', tone: 'bg-[#f3efe9] text-[#7d6c64]', actionable: true }
  return { label: 'Sin mapeo Fudo', tone: 'bg-[#fef2f2] text-[#ea504c]', actionable: false }
}

function isFudoLinked(item: StockItem | null) {
  return Boolean(item?.fudo_ingredient_id || item?.fudo_product_id)
}

// Una salida puede ser un producto Fudo O un semielaborado propio local
// (fudo_skip): la milanesa cruda vive en LVE, Fudo no la vende.
function isValidOutput(item: StockItem | null) {
  return isFudoLinked(item) || Boolean((item as { fudo_skip?: boolean } | null)?.fudo_skip)
}

function efficiencyLabel(pct: number | null) {
  if (pct === null) return { text: '—', color: 'text-muted-foreground' }
  if (pct >= 90) return { text: 'Excelente', color: 'text-[#006d5a]' }
  if (pct >= 75) return { text: 'Buena',      color: 'text-[#d4943a]' }
  return { text: 'Baja',       color: 'text-[#ea504c]' }
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-all',
            i < current ? 'bg-[#006d5a]' : i === current ? 'bg-[#006d5a]/60' : 'bg-[#ebe6df]',
          )}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stock item search input
// ---------------------------------------------------------------------------

function StockSearch({
  items,
  value,
  onChange,
  placeholder = 'Buscar insumo...',
  className,
  requireFudoLink = false,
  allowFudoSkip = false,
  emptyText = 'No hay coincidencias',
  helperText,
}: {
  items: StockItem[]
  value: StockItem | null
  onChange: (item: StockItem | null) => void
  placeholder?: string
  className?: string
  requireFudoLink?: boolean
  allowFudoSkip?: boolean
  emptyText?: string
  helperText?: string
}) {
  const [query, setQuery] = useState(value?.name ?? '')
  const [open, setOpen] = useState(false)
  const eligibleItems = requireFudoLink
    ? items.filter((i) => isFudoLinked(i) || (allowFudoSkip && Boolean(i.fudo_skip)))
    : items

  const filtered = query.length >= 1
    ? eligibleItems.filter((i) => i.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : []

  return (
    <div className={cn('relative', className)}>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(null) }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => {
            setOpen(false)
            if (!value || query !== value.name) setQuery(value?.name ?? '')
          }, 120)
        }}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] placeholder:text-muted-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
      />
      {helperText && <p className="mt-1 text-[11px] text-muted-foreground">{helperText}</p>}
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-[#ebe6df] bg-white shadow-lg">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(item)
                setQuery(item.name)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] first:rounded-t-xl last:rounded-b-xl hover:bg-[#f5f2ee]"
            >
              <span className="font-medium text-[#3d2c24]">{item.name}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${getStockSource(item)?.tone}`}>
                  {getStockSource(item)?.label}
                </span>
                {formatQty(item.current_qty)} {item.unit}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && query.length >= 1 && filtered.length === 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[12px] text-muted-foreground shadow-lg">
          {emptyText}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

export default function NuevaProduccionPage() {
  const router = useRouter()
  const { profile } = useProfileContext()
  // Socio y encargado pueden validar su propia producción en un solo paso.
  const isManager = isManagerOrAbove(profile?.role)
  const [step, setStep] = useState(0)      // 0=insumo, 1=salidas, 2=resumen
  const [saving, setSaving] = useState(false)
  const [validatingNow, setValidatingNow] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Data
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [templates, setTemplates] = useState<Template[]>([])

  // Step 0 — inputs
  const [inputs, setInputs] = useState<InputRow[]>(() => [makeInputRow()])
  const [productionDate, setProductionDate] = useState(() => toLocalDateInput(new Date()))
  const [orderName, setOrderName] = useState('')
  const [productionMode, setProductionMode] = useState<'template' | 'free'>('free')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [selectedBatch, setSelectedBatch] = useState<ProductionBatch | null>(null)
  const [notes, setNotes] = useState('')

  // Step 1 — outputs
  const [outputs, setOutputs] = useState<OutputRow[]>([])
  const previousProductionDate = useRef(productionDate)

  const inputDetails = inputs.map((input) => {
    const item = input.stock_item_id
      ? stockItems.find((stockItem) => stockItem.id === input.stock_item_id) ?? null
      : null
    return {
      ...input,
      item,
      qty: parseFloat(input.qty_used) || 0,
      unit: input.unit || item?.unit || 'kg',
    }
  })
  const primaryInputItem = inputDetails[0]?.item ?? null
  const primaryInputUnit = inputDetails[0]?.unit ?? 'kg'
  const primaryInputQty = inputDetails[0]?.qty ?? 0
  const inputTotalsByUnit = inputDetails.reduce<Record<string, number>>((acc, input) => {
    if (input.qty <= 0) return acc
    acc[input.unit] = (acc[input.unit] ?? 0) + input.qty
    return acc
  }, {})
  const inputUnitEntries = Object.entries(inputTotalsByUnit)

  // Load data
  useEffect(() => {
    const load = async () => {
      const [stockRes, tmplRes] = await Promise.all([
        fetch('/api/stock/items?preset=full'),
        fetch('/api/produccion/templates'),
      ])

      if (stockRes.ok) {
        const stockList = await stockRes.json()
        const items: StockItem[] = (stockList.items ?? []).map((i: Record<string, unknown>) => ({
          id: String(i.id),
          name: String(i.name),
          unit: String(i.unit),
          current_qty: Number(i.current_qty ?? 0),
          cost_per_unit: Number(i.cost_per_unit ?? 0),
          cost_source: 'cost_source' in i ? (i.cost_source == null ? null : String(i.cost_source)) : undefined,
          shelf_life_days: i.shelf_life_days == null ? null : Number(i.shelf_life_days),
          fudo_ingredient_id: i.fudo_ingredient_id == null ? null : String(i.fudo_ingredient_id),
          fudo_product_id: i.fudo_product_id == null ? null : String(i.fudo_product_id),
          fudo_skip: i.fudo_skip == null ? null : Boolean(i.fudo_skip),
        }))
        setStockItems(items)
      }

      if (tmplRes.ok) {
        const tj = await tmplRes.json()
        setTemplates(tj.templates ?? [])
      }
    }
    load()
  }, [])

  // ?receta=<slug> — llega desde "¿Qué producir hoy?" con la receta a precargar.
  // window.location en vez de useSearchParams para no requerir <Suspense>.
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('receta')
    if (!slug) return
    const batch = PRODUCTION_BATCHES.find(b => b.slug === slug) ?? null
    if (!batch) return
    setSelectedBatch(batch)
    setProductionMode('template')
  }, [])

  // Auto-generate order name
  useEffect(() => {
    if (primaryInputItem) {
      const date = new Date(`${productionDate}T00:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
      setOrderName(`${primaryInputItem.name} — ${date}`)
    }
  }, [primaryInputItem, productionDate])

  // Al elegir una receta: autocargar el insumo PRINCIPAL (nalga), los secundarios
  // y la SALIDA (milanesa cruda). El cocinero solo ajusta cantidades.
  useEffect(() => {
    if (!selectedBatch) {
      setInputs(prev => prev.filter(i => !i.fromBatch))
      return
    }
    const fudoItems = stockItems.filter(item => isFudoLinked(item))

    // Insumo principal (define la escala del lote)
    const mainMatch = matchIngredientToStock(selectedBatch.mainIngredientName, fudoItems)
    const mainRow: InputRow = {
      localId: nextId(),
      stock_item_id: mainMatch?.id ?? null,
      stock_item_name: mainMatch?.name ?? '',
      qty_used: '',
      unit: mainMatch?.unit ?? selectedBatch.baseUnit,
    }
    const batchRows: InputRow[] = selectedBatch.secondary.map(si => {
      const matched = matchIngredientToStock(si.name, fudoItems)
      return {
        localId: nextId(),
        stock_item_id: matched?.id ?? null,
        stock_item_name: matched?.name ?? '',
        qty_used: '',  // se calcula cuando el usuario ponga la qty principal
        unit: matched?.unit ?? BATCH_UNIT_MAP[si.unit] ?? si.unit,
        fromBatch: true,
        batchIngredientName: si.name,
      }
    })
    setInputs([mainRow, ...batchRows])

    // Salida: el elaborado que se produce (busca en TODO el stock, incluye locales)
    if (selectedBatch.output) {
      const outMatch = matchIngredientToStock(selectedBatch.output.name, stockItems)
      setOutputs([{
        localId: nextId(),
        stock_item_id: outMatch?.id ?? null,
        stock_item_name: outMatch?.name ?? '',
        output_name: selectedBatch.output.name,
        qty_produced: '',
        theoretical_qty: null,
        unit: outMatch?.unit ?? selectedBatch.output.unit,
        is_waste: false,
        notes: '',
        lot_code: '',
        expires_on: suggestedExpiryDate(outMatch ?? null, productionDate),
      }])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatch, stockItems])

  // Cuando cambia la qty del insumo principal: re-escalar secundarias y la salida.
  // OJO: la receta declara cada ingrediente en SU propia unidad (ej. gramos),
  // que puede no ser la unidad real del stock_item matcheado (ej. kg a granel,
  // o "unidad" para huevos/insumos contados). Hay que CONVERTIR antes de
  // asignar qty_used — antes esto asignaba el número crudo de la receta con
  // la etiqueta de la unidad del stock, sin convertir (40g de sal aparecían
  // como "40 kg"; 600g de huevo escalado aparecía como "120 unidad").
  useEffect(() => {
    if (!selectedBatch || primaryInputQty <= 0) return
    const ratio = primaryInputQty / selectedBatch.baseQty
    setInputs(prev => prev.map(input => {
      if (!input.fromBatch || !input.batchIngredientName) return input
      const si = selectedBatch.secondary.find(s => s.name === input.batchIngredientName)
      if (!si) return input
      const rawQty = si.qty * ratio
      const stockItem = input.stock_item_id ? stockItems.find(item => item.id === input.stock_item_id) : null
      if (!stockItem) return { ...input, qty_used: formatQty(rawQty) }
      const converted = convertQty(rawQty, si.unit, stockItem.unit)
      if (converted == null) {
        // No convertible (ej. gramos -> unidad sin factor de conversión).
        // Dejar vacío para que el cocinero cargue la cantidad real a mano,
        // en vez de mostrar un número mal escalado que pase sin error.
        return { ...input, qty_used: '', unit: stockItem.unit }
      }
      return { ...input, qty_used: formatQty(converted), unit: stockItem.unit }
    }))
    if (selectedBatch.output) {
      const outYield = selectedBatch.output.yieldPerBase * ratio
      setOutputs(prev => prev.map(o => o.is_waste ? o : { ...o, qty_produced: formatQty(outYield), theoretical_qty: outYield }))
    }
  // primaryInputQty es derivado — no queremos que esto reaccione a cambios en inputs (loop)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryInputQty, selectedBatch, stockItems])

  // Al elegir una plantilla: precargar TODOS los insumos y salidas guardados,
  // con sus cantidades de referencia. El cocinero solo ajusta lo real. Así no
  // hay que elegir a mano cada renglón (menos error de carga).
  const applyTemplate = useCallback(() => {
    if (!selectedTemplate) return

    // Insumos: los múltiples guardados; si no hay, el input único legacy
    const tplInputs = selectedTemplate.inputs ?? []
    if (tplInputs.length > 0) {
      const rows: InputRow[] = tplInputs
        .map((ti) => {
          const found = stockItems.find((s) => s.id === ti.stock_item_id) ?? null
          if (found && !isFudoLinked(found)) return null
          return {
            localId: nextId(),
            stock_item_id: found?.id ?? ti.stock_item_id ?? null,
            stock_item_name: found?.name ?? ti.stock_items?.name ?? '',
            qty_used: ti.qty != null ? String(ti.qty) : '',
            unit: found?.unit ?? ti.unit ?? 'kg',
          }
        })
        .filter((r): r is InputRow => r !== null)
      if (rows.length > 0) setInputs(rows)
    } else if (selectedTemplate.input_stock_item) {
      const found = stockItems.find((s) => s.id === selectedTemplate.input_stock_item!.id)
      setInputs([{
        ...makeInputRow(),
        stock_item_id: found && isFudoLinked(found) ? found.id : null,
        stock_item_name: found && isFudoLinked(found) ? found.name : '',
        unit: found?.unit ?? selectedTemplate.input_unit,
      }])
    }

    // Salidas: precargar con la cantidad de referencia (default_qty) o el % legacy
    const rows: OutputRow[] = selectedTemplate.outputs.map((o) => {
      const linkedItem = stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null
      const refQty = o.default_qty != null
        ? o.default_qty
        : (primaryInputQty > 0 ? primaryInputQty * o.theoretical_yield_pct / 100 : null)
      return {
        localId: nextId(),
        stock_item_id: o.stock_item_id,
        stock_item_name: linkedItem?.name ?? '',
        output_name: o.output_name,
        qty_produced: refQty != null ? formatQty(refQty) : '',
        theoretical_qty: refQty,
        unit: linkedItem?.unit ?? o.output_unit,
        is_waste: o.is_waste,
        notes: o.notes ?? '',
        lot_code: '',
        expires_on: o.is_waste ? '' : suggestedExpiryDate(linkedItem, productionDate),
      }
    })
    setOutputs(rows)
  }, [primaryInputQty, productionDate, selectedTemplate, stockItems])

  // Al seleccionar una plantilla, aplicarla automáticamente
  useEffect(() => {
    if (selectedTemplate) applyTemplate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate?.id])

  useEffect(() => {
    const previousDate = previousProductionDate.current
    if (previousDate === productionDate) return

    setOutputs((current) => current.map((output) => {
      if (output.is_waste || !output.stock_item_id) return output

      const linkedItem = stockItems.find((stockItem) => stockItem.id === output.stock_item_id) ?? null
      if (!linkedItem || linkedItem.shelf_life_days == null) return output

      const previousSuggestion = suggestedExpiryDate(linkedItem, previousDate)
      const nextSuggestion = suggestedExpiryDate(linkedItem, productionDate)

      if (!output.expires_on || output.expires_on === previousSuggestion) {
        return { ...output, expires_on: nextSuggestion }
      }

      return output
    }))

    previousProductionDate.current = productionDate
  }, [productionDate, stockItems])

  // ── Step 0 validation ──
  const inputsValid = inputDetails.length > 0 && inputDetails.every((input) => (
    input.item && isFudoLinked(input.item) && input.qty > 0 && input.unit
  ))
  const step0Valid = Boolean(inputsValid && orderName.trim() && productionDate)

  // ── Step 1 helpers ──
  const outputTotalsByUnit = outputs.reduce<Record<string, number>>((acc, output) => {
    const qty = parseFloat(output.qty_produced)
    if (isNaN(qty) || qty <= 0) return acc
    const unit = output.unit || primaryInputUnit
    acc[unit] = (acc[unit] ?? 0) + qty
    return acc
  }, {})
  const balanceByUnit = Array.from(new Set([
    ...Object.keys(inputTotalsByUnit),
    ...Object.keys(outputTotalsByUnit),
  ])).map((unit) => ({
    unit,
    input: inputTotalsByUnit[unit] ?? 0,
    output: outputTotalsByUnit[unit] ?? 0,
    diff: (inputTotalsByUnit[unit] ?? 0) - (outputTotalsByUnit[unit] ?? 0),
  }))
  const comparableBalanceRows = balanceByUnit.filter((row) => row.input > 0 && row.output > 0)
  const balanceOk = comparableBalanceRows.length > 0 && comparableBalanceRows.every((row) => Math.abs(row.diff) < 0.001)
  const singleInputUnit = inputUnitEntries.length === 1 ? inputUnitEntries[0] : null
  const totalInputQty = singleInputUnit ? singleInputUnit[1] : inputDetails.reduce((sum, input) => sum + input.qty, 0)
  const totalWasteSameUnit = singleInputUnit
    ? outputs
      .filter((o) => o.is_waste && o.unit === singleInputUnit[0])
      .reduce((s, o) => s + (parseFloat(o.qty_produced) || 0), 0)
    : 0
  const efficiency = singleInputUnit && totalInputQty > 0
    ? Math.round((1 - totalWasteSameUnit / totalInputQty) * 1000) / 10
    : null

  // Costo estimado de la producción (mismo cálculo que el backend, en vivo).
  // Solo suman los insumos con costo REAL (cost_source compra/manual/producción);
  // el resto se lista como "sin costo real" y el total queda parcial. Si la API
  // todavía no manda cost_source (migración pendiente), criterio legacy: costo > 0.
  const costEstimate = (() => {
    let totalCost = 0
    let missingCost = false
    let costed = false
    const missingNames: string[] = []
    for (const input of inputDetails) {
      if (!input.item || input.qty <= 0) continue
      const qtyInStockUnit = convertQty(input.qty, input.unit, input.item.unit)
      if (qtyInStockUnit == null) continue
      const unitCost = input.item.cost_per_unit || 0
      const confiable = input.item.cost_source === undefined
        ? unitCost > 0
        : esCostoConfiable(input.item.cost_source, unitCost)
      if (!confiable) {
        missingCost = true
        if (!missingNames.includes(input.item.name) && missingNames.length < 6) missingNames.push(input.item.name)
        continue
      }
      costed = true
      totalCost += qtyInStockUnit * unitCost
    }
    const producedQty = outputs
      .filter((o) => !o.is_waste)
      .reduce((s, o) => s + (parseFloat(o.qty_produced) || 0), 0)
    const producedUnit = outputs.find((o) => !o.is_waste)?.unit ?? 'u'
    return {
      totalCost,
      producedQty,
      producedUnit,
      perUnit: producedQty > 0 ? totalCost / producedQty : 0,
      missingCost,
      missingNames,
      costed,
    }
  })()

  function addInput() {
    setInputs((prev) => [...prev, makeInputRow(null, primaryInputUnit)])
  }

  function updateInput(localId: string, patch: Partial<InputRow>) {
    setInputs((prev) => prev.map((input) => input.localId === localId ? { ...input, ...patch } : input))
  }

  function removeInput(localId: string) {
    setInputs((prev) => prev.length <= 1 ? prev : prev.filter((input) => input.localId !== localId))
  }

  function addOutput(isWaste = false) {
    setOutputs((prev) => [...prev, {
      localId: nextId(),
      stock_item_id: null,
      stock_item_name: '',
      output_name: isWaste ? 'Merma' : '',
      qty_produced: '',
      theoretical_qty: null,
      unit: primaryInputUnit,
      is_waste: isWaste,
      notes: '',
      lot_code: '',
      expires_on: '',
    }])
  }

  function updateOutput(localId: string, patch: Partial<OutputRow>) {
    setOutputs((prev) => prev.map((o) => o.localId === localId ? { ...o, ...patch } : o))
  }

  function removeOutput(localId: string) {
    setOutputs((prev) => prev.filter((o) => o.localId !== localId))
  }

  const step1Valid = outputs.length > 0 && outputs.every((o) => {
    const linkedItem = o.stock_item_id ? stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null : null
    const qty = parseFloat(o.qty_produced)
    return o.output_name
      && (o.is_waste ? qty >= 0 : qty > 0)
      && (o.is_waste || (linkedItem && isValidOutput(linkedItem)))
  })
  const finishedOutputs = outputs.filter((output) => !output.is_waste)
  const checklist = [
    { label: 'Materias primas Fudo', ok: inputsValid },
    { label: 'Producto final Fudo', ok: finishedOutputs.length > 0 && finishedOutputs.every((output) => {
      const linkedItem = output.stock_item_id ? stockItems.find((stockItem) => stockItem.id === output.stock_item_id) ?? null : null
      return linkedItem && isValidOutput(linkedItem)
    }) },
    { label: 'Cantidades cargadas', ok: inputDetails.every((input) => input.qty > 0) && outputs.every((output) => parseFloat(output.qty_produced) >= 0) },
    { label: isManager ? 'Podés validar vos mismo' : 'Queda para validación', ok: true },
  ]
  const readyForReview = step0Valid && step1Valid

  // ── Guardar la producción actual como plantilla reutilizable ──
  const [savingTemplate, setSavingTemplate] = useState(false)
  async function saveAsTemplate() {
    const validInputs = inputDetails.filter((i) => i.item && isFudoLinked(i.item))
    if (validInputs.length === 0) { setError('Cargá al menos un insumo para guardar la plantilla.'); return }
    const finished = outputs.filter((o) => !o.is_waste && o.stock_item_id)
    if (finished.length === 0) { setError('Cargá el producto que sale para guardar la plantilla.'); return }

    const suggested = finished[0]?.output_name || orderName || ''
    const name = window.prompt('Nombre de la plantilla (ej: "Milanesa cruda"):', suggested)
    if (!name?.trim()) return

    setSavingTemplate(true)
    setError(null)
    try {
      const res = await fetch('/api/produccion/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          inputs: validInputs.map((i) => ({ stock_item_id: i.item!.id, qty: i.qty, unit: i.unit })),
          outputs: outputs.map((o) => ({
            stock_item_id: o.stock_item_id,
            output_name: o.output_name,
            default_qty: parseFloat(o.qty_produced) || null,
            output_unit: o.unit,
            is_waste: o.is_waste,
            notes: o.notes || null,
          })),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error ?? 'No se pudo guardar la plantilla')
      toast.success(`Plantilla "${name.trim()}" guardada — la próxima vez elegila y se precarga todo`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar la plantilla')
    } finally {
      setSavingTemplate(false)
    }
  }

  // ── Submit ──
  // validateNow (solo socio/encargado): crea la orden y la valida en la misma
  // acción, reutilizando el endpoint de validación existente (create → complete).
  // La misma persona que produce puede validar: la validación protege los
  // NÚMEROS (vínculos Fudo, unidades, eficiencia), no exige otro par de ojos.
  async function handleConfirm(validateNow = false) {
    if (!inputsValid) {
      setError('Producción bloqueada: todas las materias primas deben elegirse desde el autocompletado y estar vinculadas a Fudo.')
      return
    }
    const blockedOutputs = outputs
      .filter((o) => !o.is_waste)
      .map((o) => stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null)
      .filter((item) => !item || !isValidOutput(item))
    if (blockedOutputs.length > 0) {
      setError(`Producción bloqueada: todos los productos finales deben elegirse desde el autocompletado y estar vinculados a Fudo (${blockedOutputs.map((item) => item?.name ?? 'salida sin item').join(', ')}).`)
      return
    }
    const ok = window.confirm(validateNow
      ? `Validar "${orderName}" ahora?\n\nEsto descuenta insumos, suma producción terminada y sincroniza Fudo en el mismo paso.`
      : 'La producción quedará pendiente de validación por socio o encargado. Stock y Fudo no se modifican todavía. ¿Enviar?')
    if (!ok) return
    if (validateNow) setValidatingNow(true)
    else setSaving(true)
    setError(null)
    try {
      // UNA sola request: crea la orden con insumos/salidas y, si el manager
      // eligió validar ahora, la completa en el mismo endpoint (stock, lotes,
      // sync Fudo y auditoría). Antes eran dos requests y si la segunda fallaba
      // la orden quedaba huérfana en pending_review sin reintento.
      const res = await fetch('/api/produccion/orders/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: orderName,
          template_id: selectedTemplate?.id ?? null,
          notes: notes || null,
          inputs: inputDetails.map((input) => ({
            stock_item_id: input.item!.id,
            qty_used: input.qty,
            unit: input.unit,
          })),
          outputs: outputs
            .filter((o) => o.output_name && !isNaN(parseFloat(o.qty_produced)))
            .map((o) => ({
              stock_item_id: o.stock_item_id,
              output_name: o.output_name,
              qty_produced: parseFloat(o.qty_produced),
              theoretical_qty: o.theoretical_qty,
              unit: o.unit,
              is_waste: o.is_waste,
              notes: o.notes || null,
              lot_code: o.lot_code.trim() || null,
              produced_at: dateInputToIso(productionDate),
              expires_at: o.expires_on ? dateInputToIso(o.expires_on) : null,
            })),
          auto_complete: validateNow && isManager,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        if (validateNow && json.order_id) {
          // La orden quedó creada pero no se pudo cerrar: va a la cola de validación con el motivo
          toast.error(`La producción quedó enviada a validación, pero no se pudo validar automáticamente: ${json.error ?? 'error desconocido'}`)
          router.push('/stock/produccion')
          return
        }
        throw new Error(json.error ?? 'Error al procesar la producción')
      }

      if (validateNow && json.status === 'completed') {
        const synced = typeof json.fudo?.synced === 'number' ? json.fudo.synced : null
        const costo = typeof json.cost_per_output_unit === 'number' ? ` · $${Math.round(json.cost_per_output_unit).toLocaleString('es-AR')}/u` : ''
        toast.success(synced !== null
          ? `Producción validada · Fudo ${synced} item${synced !== 1 ? 's' : ''}${costo}`
          : `Producción validada y aplicada${costo}`)
      }
      for (const w of (json?.warnings ?? []) as string[]) if (w.includes('Fudo')) toast.info(w)

      // Success — navigate to validation queue
      router.push('/stock/produccion')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      if (validateNow) setValidatingNow(false)
      else setSaving(false)
    }
  }

  const STEPS = [
    {
      label: 'Qué entra',
      title: 'Elegí las materias primas',
      help: 'Ejemplo milanesas: carne, pan rallado y huevo, todos elegidos desde items vinculados a Fudo. Nada se descuenta todavía; queda pendiente de validación.',
    },
    {
      label: 'Qué sale',
      title: 'Cargá el producto que queda listo',
      help: 'Ejemplo milanesas: cargás Milanesa cruda como salida, la cantidad obtenida, merma si hubo, lote y vencimiento.',
    },
    {
      label: 'Impacto',
      title: 'Revisá exactamente qué stock cambia',
      help: 'El chef envía la producción a validación. Recién cuando el encargado aprueba, LVE mueve stock y sincroniza Fudo.',
    },
  ]
  const currentStep = STEPS[step]

  return (
    <div className="min-h-screen bg-[#faf8f5] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#ebe6df] bg-[#faf8f5]/95 backdrop-blur-md">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => step === 0 ? router.back() : setStep(step - 1)}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {currentStep.label}
              </p>
              <p className="text-[15px] font-bold text-[#3d2c24]">Nueva producción</p>
            </div>
            <span className="text-[12px] font-medium text-muted-foreground">
              {step + 1}/{STEPS.length}
            </span>
          </div>
          <div className="mt-2">
            <StepIndicator current={step} total={STEPS.length} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-4">
        <FadeIn>
          <div className="mb-4 rounded-2xl border border-[#ebe6df] bg-white p-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#006d5a]">
              Paso {step + 1}: {currentStep.label}
            </p>
            <h2 className="mt-1 text-[16px] font-bold text-[#3d2c24]">{currentStep.title}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[#7d6c64]">{currentStep.help}</p>
          </div>
        </FadeIn>

        {/* ── STEP 0: Insumo ── */}
        {step === 0 && (
          <FadeIn>
            <div className="space-y-4">
              <div className="rounded-2xl bg-[#2f241f] p-4 text-white shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">
                  Ejemplo real: milanesas
                </p>
                <h2 className="mt-1 text-[17px] font-bold">Cómo se carga una producción</h2>
                <div className="mt-3 space-y-2 text-[12px] text-white/75">
                  <div className="flex gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-[#2f241f]">1</span>
                    <span><strong className="text-white">Entrada:</strong> carne, pan rallado, huevo u otras materias primas desde Fudo.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-[#2f241f]">2</span>
                    <span><strong className="text-white">Salida:</strong> Milanesa cruda/lista como item de stock.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-[#2f241f]">3</span>
                    <span><strong className="text-white">Control:</strong> merma, lote, vencimiento y rendimiento.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-[#2f241f]">4</span>
                    <span><strong className="text-white">Validación:</strong> encargado aprueba y recién ahí LVE sincroniza Fudo.</span>
                  </div>
                </div>
                <p className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-[11px] leading-relaxed text-white/70">
                  Importante: la materia prima y el producto final se eligen solo desde items vinculados a Fudo. Si no aparece, primero hay que mapearlo.
                </p>
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <div className="mb-3">
                  <h2 className="text-[13px] font-semibold text-[#3d2c24]">Recetario</h2>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    Elegí una receta para precargar los insumos proporcionales, o cargá libre si no está en el recetario.
                  </p>
                </div>

                <select
                  value={selectedBatch?.slug ?? ''}
                  onChange={(e) => {
                    const batch = PRODUCTION_BATCHES.find(b => b.slug === e.target.value) ?? null
                    setSelectedBatch(batch)
                    if (batch) setProductionMode('template')
                    else { setProductionMode('free'); setSelectedTemplate(null) }
                  }}
                  className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                >
                  <option value="">Sin receta — cargo libre</option>
                  {PRODUCTION_BATCHES.map(b => (
                    <option key={b.slug} value={b.slug}>{b.displayName}</option>
                  ))}
                </select>

                {selectedBatch && (
                  <div className="mt-2 rounded-xl bg-[#e8f5f1] px-3 py-2 text-[11px] text-[#006d5a]">
                    <p className="font-semibold">
                      Base: {selectedBatch.baseQty} {selectedBatch.baseUnit} de {selectedBatch.mainIngredientName}
                      {primaryInputQty > 0 && (
                        <span className="ml-2 rounded-full bg-[#006d5a] px-2 py-0.5 text-[10px] text-white font-bold">
                          ×{formatQty(primaryInputQty / selectedBatch.baseQty)} escala
                        </span>
                      )}
                    </p>
                    {selectedBatch.secondary.length > 0 && (
                      <p className="mt-0.5 opacity-75">
                        {selectedBatch.secondary.length} insumos precargados
                        {primaryInputQty > 0 && ' — cantidades ajustadas'}
                      </p>
                    )}
                    {selectedBatch.yieldNote && (
                      <p className="mt-0.5 italic opacity-60">{selectedBatch.yieldNote}</p>
                    )}
                  </div>
                )}

                {/* DB templates (cuando existan) */}
                {templates.length > 0 && (
                  <div className="mt-3 border-t border-[#ebe6df] pt-3">
                    <label className="mb-1 block text-[12px] font-medium text-muted-foreground">
                      Plantilla de rendimientos (opcional)
                    </label>
                    <select
                      value={selectedTemplate?.id ?? ''}
                      onChange={(e) => {
                        const tmpl = templates.find((t) => t.id === Number(e.target.value)) ?? null
                        setSelectedTemplate(tmpl)
                        setProductionMode(tmpl ? 'template' : 'free')
                      }}
                      className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                    >
                      <option value="">Sin plantilla</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    {selectedTemplate?.description && (
                      <p className="mt-1.5 text-[12px] text-muted-foreground">{selectedTemplate.description}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#ea504c]">
                      Baja stock Fudo
                    </p>
                    <h2 className="text-[13px] font-semibold text-[#3d2c24]">Materias primas</h2>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      Cada entrada baja stock y debe estar vinculada a Fudo.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addInput}
                    className="flex shrink-0 items-center gap-1 rounded-xl bg-[#006d5a] px-3 py-2 text-[12px] font-semibold text-white"
                  >
                    <Plus className="size-3.5" />
                    Agregar
                  </button>
                </div>

                <div className="space-y-3">
                  {inputs.map((input, idx) => {
                    const linkedItem = input.stock_item_id
                      ? stockItems.find((stockItem) => stockItem.id === input.stock_item_id) ?? null
                      : null
                    const qty = parseFloat(input.qty_used)
                    const isBatch = Boolean(input.fromBatch)
                    const searchPlaceholder = isBatch && input.batchIngredientName
                      ? `Buscar "${input.batchIngredientName}"...`
                      : idx === 0
                        ? 'Buscar materia prima (ej: Nalga, pan rallado, huevo)...'
                        : 'Buscar insumo...'

                    return (
                      <div
                        key={input.localId}
                        className={cn(
                          'rounded-2xl border p-3',
                          isBatch
                            ? 'border-[#006d5a]/30 bg-[#e8f5f1]/40'
                            : 'border-[#ebe6df] bg-[#faf8f5]',
                        )}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-[#7d6c64]">
                              Materia prima {idx + 1}
                            </p>
                            {isBatch && (
                              <span className="rounded-full bg-[#006d5a] px-2 py-0.5 text-[9px] font-bold text-white">
                                Del recetario
                              </span>
                            )}
                          </div>
                          {inputs.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeInput(input.localId)}
                              className="rounded-lg p-1 text-muted-foreground hover:bg-red-50 hover:text-[#ea504c]"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>

                        <label className="mb-1 block text-[12px] font-medium text-muted-foreground">
                          Item que baja del stock
                        </label>
                        <StockSearch
                          key={`${input.localId}-${input.stock_item_id ?? 'empty'}`}
                          items={stockItems}
                          value={linkedItem}
                          onChange={(item) => updateInput(input.localId, {
                            stock_item_id: item?.id ?? null,
                            stock_item_name: item?.name ?? '',
                            unit: item?.unit ?? input.unit,
                          })}
                          placeholder={searchPlaceholder}
                          requireFudoLink
                          helperText="Autocompletado cerrado: solo aparecen items vinculados a Fudo."
                          emptyText="No encontré ese item con vínculo Fudo. Primero mapealo en stock."
                        />
                        {linkedItem && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span>Stock actual: {formatQty(linkedItem.current_qty)} {linkedItem.unit}</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${getStockSource(linkedItem)?.tone}`}>
                              {getStockSource(linkedItem)?.label}
                            </span>
                          </div>
                        )}

                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[12px] font-medium text-muted-foreground">Cantidad usada</label>
                            <input
                              type="number"
                              step="0.001"
                              min="0"
                              value={input.qty_used}
                              onChange={(e) => updateInput(input.localId, { qty_used: e.target.value })}
                              placeholder="0.000"
                              className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[12px] font-medium text-muted-foreground">Unidad</label>
                            <select
                              value={input.unit}
                              onChange={(e) => updateInput(input.localId, { unit: e.target.value })}
                              className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                            >
                              {['kg', 'g', 'l', 'ml', 'unidad', 'atado', 'bandeja'].map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {linkedItem && !Number.isNaN(qty) && qty > linkedItem.current_qty && (
                          <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-[12px] text-[#ea504c]">
                            <AlertTriangle className="size-3.5 shrink-0" />
                            Cantidad mayor al stock disponible ({formatQty(linkedItem.current_qty)} {linkedItem.unit})
                          </div>
                        )}
                      </div>
                    )
                  })}

                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-muted-foreground">Fecha de elaboración</label>
                    <input
                      type="date"
                      value={productionDate}
                      onChange={(e) => setProductionDate(e.target.value)}
                      className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Se usa para sugerir vencimientos y crear el lote en LVE. Fudo se actualiza recién con aprobación.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <h2 className="mb-3 text-[13px] font-semibold text-[#3d2c24]">Nombre de la producción</h2>
                <input
                  type="text"
                  value={orderName}
                  onChange={(e) => setOrderName(e.target.value)}
                  placeholder="Ej: Milanesas — 9 may"
                  className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                />
                <div className="mt-3">
                  <label className="mb-1 block text-[12px] font-medium text-muted-foreground">Notas (opcional)</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Ej: carne limpia, corte fino, pendiente revisar merma"
                    className="w-full resize-none rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-[14px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                  />
                </div>
              </div>
            </div>
          </FadeIn>
        )}

        {/* ── STEP 1: Salidas ── */}
        {step === 1 && (
          <FadeIn>
            <div className="space-y-3">
              {/* Input summary */}
              <div className="rounded-xl bg-[#e8f5f1] px-3 py-2">
                <div className="flex items-center gap-2">
                <Package className="size-4 text-[#006d5a]" />
                <span className="text-[13px] font-semibold text-[#006d5a]">
                    Entradas: {inputDetails.length} materia{inputDetails.length !== 1 ? 's' : ''} prima{inputDetails.length !== 1 ? 's' : ''}
                </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {inputDetails.map((input) => (
                    <span key={input.localId} className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-[#006d5a]">
                      {input.item?.name ?? 'Sin item'} · {formatQty(input.qty)} {input.unit}
                    </span>
                  ))}
                </div>
              </div>

              {/* Unit control */}
              {balanceByUnit.length > 0 && (
                <div className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-[#8b5e34]">
                  <div className="flex items-center gap-2 font-semibold">
                    {balanceOk ? <Check className="size-3.5 text-[#006d5a]" /> : <AlertTriangle className="size-3.5" />}
                    Control por unidad
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {balanceByUnit.map((row) => (
                      <div key={row.unit} className="flex items-center justify-between gap-2">
                        <span>{row.unit}</span>
                        <span>
                          entra {formatQty(row.input)} · sale {formatQty(row.output)}
                          {row.input > 0 && row.output > 0 && Math.abs(row.diff) >= 0.001
                            ? ` · dif. ${formatQty(Math.abs(row.diff))}`
                            : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#8b5e34]/80">
                    Si mezclás kg con unidades, LVE registra ambos movimientos pero no fuerza balance matemático entre unidades distintas.
                  </p>
                </div>
              )}

              {/* Template pre-fill button */}
              {selectedTemplate && outputs.length === 0 && (
                <button
                  onClick={applyTemplate}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#006d5a]/40 bg-[#006d5a]/5 py-3 text-[13px] font-medium text-[#006d5a]"
                >
                  <TrendingUp className="size-4" />
                  Usar guía &quot;{selectedTemplate.name}&quot;
                </button>
              )}

              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#006d5a]">
                  Sube stock Fudo
                </p>
                <h2 className="mt-1 text-[13px] font-semibold text-[#3d2c24]">Productos finales</h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Cada producto final debe elegirse desde Fudo. Merma/descarte no sube stock.
                </p>
              </div>

              {/* Output rows */}
              {outputs.map((o, idx) => (
                <div
                  key={o.localId}
                  className={cn(
                    'rounded-2xl bg-white p-4 shadow-sm ring-1',
                    o.is_waste ? 'ring-[#ea504c]/20' : 'ring-[#ebe6df]',
                  )}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className={cn(
                      'text-[11px] font-semibold uppercase tracking-wider',
                      o.is_waste ? 'text-[#ea504c]' : 'text-[#006d5a]',
                    )}>
                      {o.is_waste ? 'Merma / descarte' : `Producto obtenido ${idx + 1 - outputs.slice(0, idx).filter((x) => x.is_waste).length}`}
                    </span>
                    <button
                      onClick={() => removeOutput(o.localId)}
                      className="rounded-lg p-1 text-muted-foreground hover:bg-red-50 hover:text-[#ea504c]"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {!o.is_waste && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                          Item de stock que sube
                        </label>
                        <StockSearch
                          key={`${o.localId}-${o.stock_item_id ?? 'empty'}`}
                          items={stockItems}
                          value={stockItems.find((s) => s.id === o.stock_item_id) ?? null}
                          onChange={(item) => {
                            const previousLinkedItem = stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null
                            const previousSuggestion = suggestedExpiryDate(previousLinkedItem, productionDate)
                            const nextSuggestion = suggestedExpiryDate(item, productionDate)
                            const shouldReplaceName = !o.output_name || o.output_name === previousLinkedItem?.name

                            updateOutput(o.localId, {
                              stock_item_id: item?.id ?? null,
                              stock_item_name: item?.name ?? '',
                              output_name: shouldReplaceName ? item?.name ?? '' : o.output_name,
                              unit: item?.unit ?? o.unit,
                              expires_on: !o.expires_on || o.expires_on === previousSuggestion
                                ? nextSuggestion
                                : o.expires_on,
                            })
                          }}
                          placeholder="Buscar producto final (ej: Milanesa cruda)..."
                          requireFudoLink
                          allowFudoSkip
                          helperText="Obligatorio: elegí el item Fudo o semielaborado local que sube stock."
                          emptyText="No encontré ese producto. Si es Fudo mapealo en stock; si es local activá fudo_skip."
                        />
                        {o.stock_item_id && (() => {
                          const linkedItem = stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null
                          if (!linkedItem) return null
                          const source = getStockSource(linkedItem)
                          return (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${source?.tone}`}>
                                {source?.label}
                              </span>
                              {!isValidOutput(linkedItem) && (
                                <span className="text-[11px] font-semibold text-[#ea504c]">
                                  Bloqueado hasta mapear con Fudo
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    )}

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Nombre visible de la salida
                      </label>
                      <input
                        type="text"
                        value={o.output_name}
                        onChange={(e) => updateOutput(o.localId, { output_name: e.target.value })}
                        placeholder="Ej: Milanesa cruda, Merma hueso..."
                        className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[13px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                      />
                    </div>

                    {o.is_waste && inputDetails.filter((inp) => inp.item).length > 0 && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                          ¿De qué insumo viene? (opcional)
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {inputDetails
                            .filter((inp) => inp.item)
                            .map((inp) => (
                              <button
                                key={inp.item!.id}
                                type="button"
                                onClick={() => updateOutput(o.localId, {
                                  stock_item_id: o.stock_item_id === inp.item!.id ? null : inp.item!.id,
                                  stock_item_name: o.stock_item_id === inp.item!.id ? '' : inp.item!.name,
                                })}
                                className={cn(
                                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-all',
                                  o.stock_item_id === inp.item!.id
                                    ? 'bg-[#ea504c] text-white'
                                    : 'bg-[#faf8f5] text-[#7d6c64] ring-1 ring-[#ebe6df]',
                                )}
                              >
                                {inp.item!.name}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                          Cantidad obtenida
                          {o.theoretical_qty !== null && (
                            <span className="ml-1 text-muted-foreground/60">
                              (teórico: {formatQty(o.theoretical_qty)})
                            </span>
                          )}
                        </label>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={o.qty_produced}
                          onChange={(e) => updateOutput(o.localId, { qty_produced: e.target.value })}
                          placeholder="0.000"
                          className={cn(
                            'w-full rounded-xl border bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-1',
                            o.theoretical_qty !== null && parseFloat(o.qty_produced) > 0
                              ? parseFloat(o.qty_produced) < o.theoretical_qty * 0.9
                                ? 'border-[#ea504c]/40 focus:border-[#ea504c] focus:ring-[#ea504c]'
                                : 'border-[#006d5a]/40 focus:border-[#006d5a] focus:ring-[#006d5a]'
                              : 'border-[#ebe6df] focus:border-[#006d5a] focus:ring-[#006d5a]',
                          )}
                        />
                        {o.theoretical_qty !== null && parseFloat(o.qty_produced) > 0 &&
                          parseFloat(o.qty_produced) < o.theoretical_qty * 0.9 && (
                          <p className="mt-0.5 text-[10px] text-[#ea504c]">
                            Por debajo del rendimiento esperado
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Unidad</label>
                        <select
                          value={o.unit}
                          onChange={(e) => updateOutput(o.localId, { unit: e.target.value })}
                          className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[13px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                        >
                          {['kg', 'g', 'l', 'ml', 'unidad', 'porción', 'atado'].map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {!o.is_waste && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                            Lote
                          </label>
                          <input
                            type="text"
                            value={o.lot_code}
                            onChange={(e) => updateOutput(o.localId, { lot_code: e.target.value })}
                            placeholder="Opcional, si no se genera solo"
                            className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[13px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                            Vencimiento
                          </label>
                          <input
                            type="date"
                            value={o.expires_on}
                            onChange={(e) => updateOutput(o.localId, { expires_on: e.target.value })}
                            className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[13px] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                          />
                        </div>
                      </div>
                    )}

                    {!o.is_waste && (() => {
                      const linkedItem = o.stock_item_id
                        ? stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null
                        : null

                      if (!linkedItem || linkedItem.shelf_life_days == null) return null

                      return (
                        <p className="rounded-xl bg-[#fdf6ec] px-3 py-2 text-[11px] text-[#8b5e34]">
                          Vida útil configurada: {linkedItem.shelf_life_days} días.
                          {!o.expires_on && ' Si no elegís fecha, LVE la calcula automáticamente.'}
                        </p>
                      )
                    })()}

                    <input
                      type="text"
                      value={o.notes}
                      onChange={(e) => updateOutput(o.localId, { notes: e.target.value })}
                      placeholder="Notas (opcional)"
                      className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[12px] text-muted-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                    />
                  </div>
                </div>
              ))}

              {/* Add buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => addOutput(false)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#006d5a]/40 py-2.5 text-[13px] font-medium text-[#006d5a]"
                >
                  <Plus className="size-4" />
                  Producto final
                </button>
                <button
                  onClick={() => addOutput(true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#ea504c]/30 py-2.5 text-[13px] font-medium text-[#ea504c]"
                >
                  <Leaf className="size-4" />
                  Merma / descarte
                </button>
              </div>
            </div>
          </FadeIn>
        )}

        {/* ── STEP 2: Resumen ── */}
        {step === 2 && (
          <FadeIn>
            <div className="space-y-3">
              {error && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-[#ea504c]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {error}
                </div>
              )}

              {/* Header card */}
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <p className="text-[13px] text-muted-foreground">Producción</p>
                <p className="mt-0.5 text-[16px] font-bold text-[#3d2c24]">{orderName}</p>
                <p className="mt-1 text-[12px] text-muted-foreground">Elaboración: {productionDate}</p>
                {notes && <p className="mt-1 text-[12px] text-muted-foreground">{notes}</p>}
              </div>

              {/* Input */}
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Entradas</p>
                <div className="space-y-2">
                  {inputDetails.map((input) => (
                    <div key={input.localId} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="font-medium text-[#3d2c24]">{input.item?.name ?? 'Sin item'}</span>
                        {input.item && (
                          <p className={`mt-1 w-fit rounded-full px-1.5 py-0.5 text-[9px] font-bold ${getStockSource(input.item)?.tone}`}>
                            {getStockSource(input.item)?.label}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 font-bold text-[#3d2c24]">{formatQty(input.qty)} {input.unit}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Outputs */}
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Salidas</p>
                <div className="space-y-2">
                  {outputs.map((o) => {
                    const qty = parseFloat(o.qty_produced) || 0
                    const pct = singleInputUnit && o.unit === singleInputUnit[0] && totalInputQty > 0
                      ? (qty / totalInputQty * 100).toFixed(1)
                      : null
                    const isBelow = o.theoretical_qty !== null && qty < o.theoretical_qty * 0.9
                    const linkedItem = o.stock_item_id
                      ? stockItems.find((stockItem) => stockItem.id === o.stock_item_id) ?? null
                      : null
                    const source = getStockSource(linkedItem)
                    return (
                      <div key={o.localId} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={cn(
                            'size-2 shrink-0 rounded-full',
                            o.is_waste ? 'bg-[#ea504c]' : 'bg-[#006d5a]',
                          )} />
                          <div className="min-w-0">
                            <span className={cn('truncate text-[13px]', o.is_waste ? 'text-[#ea504c]' : 'text-[#3d2c24]')}>
                              {o.output_name}
                            </span>
                            {(!o.is_waste && (o.lot_code || o.expires_on)) && (
                              <p className="truncate text-[10px] text-muted-foreground">
                                {o.lot_code ? `Lote ${o.lot_code}` : 'Lote automatico'}
                                {o.expires_on ? ` · vence ${o.expires_on}` : ''}
                              </p>
                            )}
                            {!o.is_waste && source && (
                              <p className={`mt-1 w-fit rounded-full px-1.5 py-0.5 text-[9px] font-bold ${source.tone}`}>
                                {source.label}
                              </p>
                            )}
                          </div>
                          {isBelow && <AlertTriangle className="size-3 shrink-0 text-[#d4943a]" />}
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="text-[13px] font-bold text-[#3d2c24]">{formatQty(qty)} {o.unit}</span>
                          {pct !== null && <span className="ml-1.5 text-[11px] text-muted-foreground">({pct}%)</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Unit control */}
                <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-[#8b5e34]">
                  <div className="flex items-center justify-between gap-2 font-semibold">
                    <span>Control por unidad</span>
                    {balanceOk && <span className="text-[#006d5a]">OK</span>}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {balanceByUnit.map((row) => (
                      <div key={row.unit} className="flex items-center justify-between gap-2">
                        <span>{row.unit}</span>
                        <span>entra {formatQty(row.input)} · sale {formatQty(row.output)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Efficiency */}
              {efficiency !== null && (
                <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Eficiencia</p>
                  <div className="flex items-center gap-3">
                    <div className="h-2 flex-1 rounded-full bg-[#f5f2ee]">
                      <div
                        className={cn('h-2 rounded-full transition-all', efficiency >= 90 ? 'bg-[#006d5a]' : efficiency >= 75 ? 'bg-[#d4943a]' : 'bg-[#ea504c]')}
                        style={{ width: `${Math.min(efficiency, 100)}%` }}
                      />
                    </div>
                    <div className="text-right">
                      <span className={cn('text-[20px] font-bold', efficiencyLabel(efficiency).color)}>
                        {efficiency}%
                      </span>
                      <p className={cn('text-[11px]', efficiencyLabel(efficiency).color)}>
                        {efficiencyLabel(efficiency).text}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Costo de producción */}
              {costEstimate.costed && (
                <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Costo de producción</p>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Costo total de materias primas</p>
                      <p className="text-[18px] font-bold text-[#3d2c24]">{formatMoney(costEstimate.totalCost)}</p>
                    </div>
                    {costEstimate.producedQty > 0 && (
                      <div className="text-right">
                        <p className="text-[11px] text-muted-foreground">Por unidad producida</p>
                        <p className="text-[22px] font-bold text-[#006d5a]">
                          {formatMoney(costEstimate.perUnit)}
                          <span className="ml-1 text-[12px] font-medium text-muted-foreground">/ {costEstimate.producedUnit}</span>
                        </p>
                      </div>
                    )}
                  </div>
                  {costEstimate.missingCost && (
                    <p className="mt-2 text-[11px] text-[#d4943a]">
                      Sin costo real de: {costEstimate.missingNames.join(', ') || 'algún insumo'} — el total es parcial.
                      Se completa al recibir una compra con precio o cargándolo a mano en la ficha.
                    </p>
                  )}
                </div>
              )}

              {/* Stock warning */}
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] text-[#d4943a]">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Al enviar, no se mueve stock todavía. Queda pendiente para encargado: al aprobar se descuentan las materias primas,
                  se suman las salidas, se crean lotes/vencimientos en LVE y se sincroniza Fudo.
                </span>
              </div>
            </div>
          </FadeIn>
        )}

        <div className="sticky bottom-3 z-20 mt-5 rounded-[1.25rem] border border-[#ebe6df] bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Control rápido</p>
              <p className="mt-0.5 text-[13px] font-semibold text-[#3d2c24]">
                {readyForReview
                  ? (isManager ? 'Listo para validar o enviar' : 'Listo para enviar a validación')
                  : 'Faltan datos para validar'}
              </p>
            </div>
            <span className={cn(
              'rounded-full px-2 py-1 text-[11px] font-bold',
              readyForReview ? 'bg-[#e8f5f1] text-[#006d5a]' : 'bg-amber-50 text-[#d4943a]',
            )}>
              {inputs.length} entrada{inputs.length !== 1 ? 's' : ''} · {finishedOutputs.length} salida{finishedOutputs.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {checklist.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 text-[11px] text-[#7d6c64]">
                <span className={cn('size-2 rounded-full', item.ok ? 'bg-[#006d5a]' : 'bg-[#d4943a]')} />
                {item.label}
              </div>
            ))}
          </div>
        </div>

        {/* Guardar como plantilla — para no volver a cargar todo a mano */}
        {step === 2 && (
          <button
            onClick={saveAsTemplate}
            disabled={savingTemplate}
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#c8a97a] bg-[#fdf6ec] py-2.5 text-[13px] font-semibold text-[#8b5e34] disabled:opacity-50 active:scale-[0.99]"
          >
            {savingTemplate ? <Loader2 className="size-4 animate-spin" /> : <BookmarkPlus className="size-4" />}
            Guardar como plantilla (entra esto → sale esto)
          </button>
        )}

        {/* ── Navigation buttons ── */}
        <div className="mt-6 flex gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-1 rounded-xl border border-[#ebe6df] bg-white px-4 py-3 text-[14px] font-medium text-[#3d2c24]"
            >
              <ChevronLeft className="size-4" />
              Atrás
            </button>
          )}

          {step < 2 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={step === 0 ? !step0Valid : !step1Valid}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-3 text-[14px] font-semibold text-white disabled:opacity-50 active:scale-[0.99]"
            >
              {step === 1 && <span>Revisar impacto</span>}
              {step === 0 && <span>Seguir: qué sale</span>}
              <ChevronRight className="size-4" />
            </button>
          ) : (
            <div className="flex flex-1 flex-col gap-2">
              {/* Atajo manager: crea la orden y la valida en la misma acción */}
              {isManager && (
                <button
                  onClick={() => handleConfirm(true)}
                  disabled={saving || validatingNow}
                  className="flex items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-3 text-[14px] font-semibold text-white disabled:opacity-60 active:scale-[0.99]"
                >
                  {validatingNow ? (
                    <><Loader2 className="size-4 animate-spin" />Validando y aplicando...</>
                  ) : (
                    <><ShieldCheck className="size-4" />Validar y aplicar ahora</>
                  )}
                </button>
              )}
              <button
                onClick={() => handleConfirm(false)}
                disabled={saving || validatingNow}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold disabled:opacity-60 active:scale-[0.99]',
                  isManager
                    ? 'border border-[#006d5a]/30 bg-white text-[#006d5a]'
                    : 'bg-[#006d5a] text-white',
                )}
              >
                {saving ? (
                  <><Loader2 className="size-4 animate-spin" />Enviando a validación...</>
                ) : (
                  <><Check className="size-4" />Enviar a validación</>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
