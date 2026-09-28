'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ChevronDown,
  CheckCircle2,
  FileSpreadsheet,
  FlaskConical,
  Loader2,
  TriangleAlert,
  Upload,
  X,
  ShieldAlert,
} from 'lucide-react'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Tipos de la respuesta de /api/fudo/import-recetas
// ---------------------------------------------------------------------------

type UnmappedEntry = { name: string; uses: number; detail?: string }

type ImportResponse = {
  success: boolean
  error?: string
  dryRun?: boolean
  archivo?: {
    productos: number
    filasRecetas: number
    filasSubproductos: number
    productosConReceta: number
  }
  recetas?: { creadas: number; actualizadas: number; total: number }
  ingredientes?: { vinculados: number; desdeSubproductos: number; filasProcesadas: number }
  vinculos?: { menuItems: number; insumosProducidos: number }
  noMapeados?: {
    productosSinMenuItem: UnmappedEntry[]
    ingredientesSinStockItem: UnmappedEntry[]
    ingredientesSinFudo: UnmappedEntry[]
    subproductosSinStockItem: UnmappedEntry[]
    productosDesconocidos: UnmappedEntry[]
    productosSinIngredientes: UnmappedEntry[]
  }
  aplicado?: {
    recetasEscritas: number
    ingredientesInsertados: number
    menuItemsVinculados: number
    insumosProducidosVinculados: number
  }
  errores?: string[]
}

const VERDE = '#006d5a'

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function BigStat({ value, label, color = VERDE }: { value: number; label: string; color?: string }) {
  return (
    <div className="card-elevated rounded-2xl px-4 py-4 text-center">
      <p className="font-display text-3xl leading-none tracking-tight" style={{ color }}>
        {value}
      </p>
      <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-[#a39e97]">{label}</p>
    </div>
  )
}

function UnmappedSection({
  title,
  hint,
  entries,
  tone = 'warn',
}: {
  title: string
  hint: string
  entries: UnmappedEntry[]
  tone?: 'warn' | 'info'
}) {
  const [open, setOpen] = useState(false)
  const color = tone === 'warn' ? '#ea504c' : '#8b5e34'

  return (
    <div className="card-elevated overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
            style={{ backgroundColor: `${color}14`, color }}
          >
            {entries.length}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[#3d2c24]">{title}</span>
            <span className="block truncate text-[11px] text-[#a39e97]">{hint}</span>
          </span>
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-[#d1cdc7] transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <ul className="border-t border-[#f0ece7] px-4 py-2">
          {entries.map(entry => (
            <li
              key={entry.name}
              className="flex items-start justify-between gap-3 border-b border-[#f7f4f0] py-2 last:border-0"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-[#3d2c24]">{entry.name}</span>
                {entry.detail && (
                  <span className="block truncate text-[11px] text-[#a39e97]">{entry.detail}</span>
                )}
              </span>
              <span className="shrink-0 rounded-md bg-[#f7f4f0] px-1.5 py-0.5 text-[11px] font-semibold text-[#8b5e34]">
                {entry.uses} {entry.uses === 1 ? 'uso' : 'usos'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function ImportarRecetasFudoPage() {
  const { profile, loading } = useProfileContext()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<'dry' | 'real' | null>(null)
  const [result, setResult] = useState<ImportResponse | null>(null)
  const [confirming, setConfirming] = useState(false)

  const run = useCallback(
    async (dry: boolean) => {
      if (!file) {
        toast.error('Elegí primero el archivo productos.xls')
        return
      }

      setBusy(dry ? 'dry' : 'real')
      setResult(null)

      try {
        const body = new FormData()
        body.append('file', file)
        if (dry) body.append('dryRun', 'true')

        const res = await fetch(`/api/fudo/import-recetas${dry ? '?dry=1' : ''}`, {
          method: 'POST',
          body,
        })
        const data = (await res.json()) as ImportResponse

        setResult(data)

        if (!res.ok || data.error) {
          toast.error(data.error ?? 'No se pudo procesar el archivo')
        } else if (dry) {
          toast.success(`Simulación lista: ${data.recetas?.total ?? 0} recetas en el plan`)
        } else {
          toast.success(
            `Importado: ${data.aplicado?.recetasEscritas ?? 0} recetas, ${data.aplicado?.ingredientesInsertados ?? 0} ingredientes`,
          )
        }
      } catch {
        toast.error('Error de red al importar')
      } finally {
        setBusy(null)
        setConfirming(false)
      }
    },
    [file],
  )

  const noMapeados = result?.noMapeados
  const pendientes = noMapeados
    ? noMapeados.productosSinMenuItem.length +
      noMapeados.ingredientesSinStockItem.length +
      noMapeados.ingredientesSinFudo.length +
      noMapeados.subproductosSinStockItem.length +
      noMapeados.productosDesconocidos.length +
      noMapeados.productosSinIngredientes.length
    : 0

  if (loading) return null

  if (profile?.role !== 'socio') {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <ShieldAlert className="size-10 text-[#ea504c]/40" />
        <p className="font-display text-lg font-semibold text-[#3d2c24]">Sólo socios</p>
        <p className="text-sm text-[#a39e97]">
          La importación de recetas reescribe el costeo de toda la carta.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <FadeIn>
        <Link
          href="/admin/fudo"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#a39e97]"
        >
          <ArrowLeft className="size-3.5" />
          Fudo
        </Link>
        <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Importar recetas de Fudo</h2>
        <p className="section-label mt-1">
          La API de Fudo no expone las recetas — se sincronizan con el export del panel
        </p>
      </FadeIn>

      {/* Instrucciones */}
      <FadeIn delay={0.05}>
        <div className="card-elevated rounded-2xl p-4">
          <p className="text-[13px] font-semibold text-[#3d2c24]">Cómo conseguir el archivo</p>
          <ol className="mt-2.5 space-y-2">
            {[
              'Entrá al panel de Fudo → Productos.',
              'Tocá Exportar y descargá el archivo productos.xls.',
              'Subilo acá. Debe traer las hojas Productos, Recetas y Subproductos.',
            ].map((step, i) => (
              <li key={step} className="flex gap-2.5 text-[13px] leading-snug text-[#6b6259]">
                <span
                  className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ backgroundColor: `${VERDE}12`, color: VERDE }}
                >
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-3 border-t border-[#f0ece7] pt-3 text-[11px] leading-snug text-[#a39e97]">
            Todo se vincula por ID de Fudo, nunca por nombre. Cada importación reemplaza los
            ingredientes de las recetas que vengan en el archivo.
          </p>
        </div>
      </FadeIn>

      {/* Selector de archivo */}
      <FadeIn delay={0.1}>
        <div className="card-elevated rounded-2xl p-4">
          <input
            ref={inputRef}
            type="file"
            accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={e => {
              setFile(e.target.files?.[0] ?? null)
              setResult(null)
            }}
          />

          {file ? (
            <div className="flex items-center gap-3">
              <div
                className="flex size-11 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${VERDE}10` }}
              >
                <FileSpreadsheet className="size-5" style={{ color: VERDE }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#3d2c24]">{file.name}</p>
                <p className="text-xs text-[#a39e97]">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFile(null)
                  setResult(null)
                  if (inputRef.current) inputRef.current.value = ''
                }}
                className="flex size-8 items-center justify-center rounded-lg text-[#a39e97] active:bg-[#f7f4f0]"
                aria-label="Quitar archivo"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-[#d1cdc7] px-4 py-7 active:bg-[#faf8f6]"
            >
              <Upload className="size-6 text-[#c4bfb8]" />
              <span className="text-sm font-semibold text-[#3d2c24]">Elegir productos.xls</span>
              <span className="text-xs text-[#a39e97]">Export del panel de Fudo</span>
            </button>
          )}

          {/* Acciones */}
          <div className="mt-4 flex gap-2.5">
            <button
              type="button"
              disabled={!file || busy !== null}
              onClick={() => run(true)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#e5e0da] px-4 py-3 text-sm font-semibold text-[#3d2c24] transition active:scale-[0.98] disabled:opacity-40"
            >
              {busy === 'dry' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FlaskConical className="size-4" />
              )}
              Simular
            </button>

            <button
              type="button"
              disabled={!file || busy !== null}
              onClick={() => (confirming ? run(false) : setConfirming(true))}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
              style={{ backgroundColor: confirming ? '#ea504c' : VERDE }}
            >
              {busy === 'real' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {confirming ? 'Confirmar' : 'Importar'}
            </button>
          </div>

          {confirming && busy === null && (
            <p className="mt-2.5 text-center text-[11px] text-[#ea504c]">
              Se sobrescriben los ingredientes de las recetas del archivo. Tocá de nuevo para
              confirmar.
            </p>
          )}
        </div>
      </FadeIn>

      {/* Resultado */}
      {result && (
        <StaggerList className="space-y-3" staggerDelay={0.05}>
          {result.error && (
            <StaggerItem>
              <div className="flex items-start gap-2.5 rounded-2xl bg-[#ea504c0f] px-4 py-3.5">
                <TriangleAlert className="mt-px size-4 shrink-0 text-[#ea504c]" />
                <p className="text-[13px] leading-snug text-[#ea504c]">{result.error}</p>
              </div>
            </StaggerItem>
          )}

          {result.recetas && (
            <>
              <StaggerItem>
                <div className="flex items-center gap-2 px-1">
                  {result.dryRun ? (
                    <FlaskConical className="size-3.5 text-[#8b5e34]" />
                  ) : (
                    <CheckCircle2 className="size-3.5" style={{ color: VERDE }} />
                  )}
                  <p className="section-label">
                    {result.dryRun ? 'Simulación — no se escribió nada' : 'Importación aplicada'}
                  </p>
                </div>
              </StaggerItem>

              <StaggerItem>
                <div className="grid grid-cols-2 gap-2.5">
                  <BigStat value={result.recetas.creadas} label="Recetas nuevas" />
                  <BigStat
                    value={result.recetas.actualizadas}
                    label="Recetas actualizadas"
                    color="#8b5e34"
                  />
                  <BigStat
                    value={result.ingredientes?.vinculados ?? 0}
                    label="Ingredientes vinculados"
                  />
                  <BigStat
                    value={result.vinculos?.menuItems ?? 0}
                    label="Productos vinculados"
                    color="#8b5e34"
                  />
                </div>
              </StaggerItem>

              <StaggerItem>
                <div className="card-elevated space-y-1.5 rounded-2xl px-4 py-3.5 text-[12px] text-[#6b6259]">
                  <p className="flex justify-between">
                    <span>Archivo</span>
                    <span className="font-semibold text-[#3d2c24]">
                      {result.archivo?.productos ?? 0} productos · {result.archivo?.filasRecetas ?? 0}{' '}
                      líneas de receta · {result.archivo?.filasSubproductos ?? 0} subproductos
                    </span>
                  </p>
                  <p className="flex justify-between">
                    <span>Desde subproductos</span>
                    <span className="font-semibold text-[#3d2c24]">
                      {result.ingredientes?.desdeSubproductos ?? 0} ingredientes
                    </span>
                  </p>
                  <p className="flex justify-between">
                    <span>Insumos producidos vinculados</span>
                    <span className="font-semibold text-[#3d2c24]">
                      {result.vinculos?.insumosProducidos ?? 0}
                    </span>
                  </p>
                </div>
              </StaggerItem>
            </>
          )}

          {/* No mapeados */}
          {noMapeados && (
            <StaggerItem>
              <div className="space-y-2.5">
                <p className="section-label px-1">
                  {pendientes === 0 ? 'Todo mapeado' : 'Qué falta vincular'}
                </p>

                {pendientes === 0 ? (
                  <div className="flex items-center gap-2.5 rounded-2xl bg-[#006d5a0f] px-4 py-3.5">
                    <CheckCircle2 className="size-4 shrink-0" style={{ color: VERDE }} />
                    <p className="text-[13px] text-[#3d2c24]">
                      Cada producto e ingrediente del export encontró su par en la app.
                    </p>
                  </div>
                ) : (
                  <>
                    {noMapeados.productosSinMenuItem.length > 0 && (
                      <UnmappedSection
                        title="Productos sin item de menú"
                        hint="Sincronizá productos desde Fudo primero"
                        entries={noMapeados.productosSinMenuItem}
                      />
                    )}
                    {noMapeados.ingredientesSinStockItem.length > 0 && (
                      <UnmappedSection
                        title="Ingredientes sin insumo en la app"
                        hint="Existen en Fudo pero no hay stock_item vinculado"
                        entries={noMapeados.ingredientesSinStockItem}
                      />
                    )}
                    {noMapeados.ingredientesSinFudo.length > 0 && (
                      <UnmappedSection
                        title="Ingredientes fuera del catálogo de Fudo"
                        hint="El nombre del export no coincide con ningún ingrediente"
                        entries={noMapeados.ingredientesSinFudo}
                      />
                    )}
                    {noMapeados.subproductosSinStockItem.length > 0 && (
                      <UnmappedSection
                        title="Subproductos sin insumo"
                        hint="Suelen ser combos que apuntan a productos de venta"
                        entries={noMapeados.subproductosSinStockItem}
                        tone="info"
                      />
                    )}
                    {noMapeados.productosSinIngredientes.length > 0 && (
                      <UnmappedSection
                        title="Productos que quedaron sin receta"
                        hint="Ninguna de sus líneas pudo mapearse"
                        entries={noMapeados.productosSinIngredientes}
                        tone="info"
                      />
                    )}
                    {noMapeados.productosDesconocidos.length > 0 && (
                      <UnmappedSection
                        title="Nombres sin fila en la hoja Productos"
                        hint="El export puede estar incompleto"
                        entries={noMapeados.productosDesconocidos}
                        tone="info"
                      />
                    )}
                  </>
                )}
              </div>
            </StaggerItem>
          )}

          {result.errores && result.errores.length > 0 && (
            <StaggerItem>
              <div className="rounded-2xl bg-[#ea504c0f] px-4 py-3.5">
                <p className="mb-1.5 text-[13px] font-semibold text-[#ea504c]">
                  Errores durante la escritura
                </p>
                <ul className="space-y-1">
                  {result.errores.map(err => (
                    <li key={err} className="text-[12px] leading-snug text-[#ea504c]">
                      {err}
                    </li>
                  ))}
                </ul>
              </div>
            </StaggerItem>
          )}
        </StaggerList>
      )}
    </div>
  )
}
