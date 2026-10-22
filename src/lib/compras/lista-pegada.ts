// ---------------------------------------------------------------------------
// Lista pegada → renglones de pedido
// ---------------------------------------------------------------------------
// Cocina escribe los pedidos como en WhatsApp:
//   "5k de molida" · "Aceite de cocina — 10 lts" · "• Harina 000 — (falta cantidad)"
// Esto separa cantidad y producto, y busca el insumo de la app que corresponde.
// Si no lo encuentra, el renglón va igual como texto (el encargado lo ve).
// ---------------------------------------------------------------------------

export type InsumoPedible = { id: string; name: string; unit: string }
export type RenglonPegado = { texto: string; nombre: string; cantidad: string; insumo: InsumoPedible | null }

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'en', 'y', 'un', 'una', 'solo', 'pedazo', 'x'])

function tokens(s: string): string[] {
  return sinAcentos(s.toLowerCase())
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !PALABRAS_VACIAS.has(t))
}

const UNIDADES: [RegExp, string][] = [
  [/^(k|kg|kgs|kilo|kilos)$/i, 'kg'],
  [/^(g|gr|grs|gramos?)$/i, 'g'],
  [/^(l|lt|lts|litros?)$/i, 'l'],
  [/^(u|un|uni|unid|unidad|unidades)$/i, 'u'],
  [/^(cajas?)$/i, 'caja'],
  [/^(paq|paquetes?)$/i, 'paquete'],
  [/^(bolsas?)$/i, 'bolsa'],
  [/^(docenas?)$/i, 'docena'],
  [/^(maples?)$/i, 'maple'],
  [/^(bidon|bidones)$/i, 'bidón'],
  [/^(latas?)$/i, 'lata'],
  [/^(frascos?)$/i, 'frasco'],
  [/^(atados?)$/i, 'atado'],
]

function unidad(u: string | undefined, n: number): string {
  if (!u) return ''
  for (const [re, nombre] of UNIDADES) {
    if (re.test(u)) return n !== 1 && !['kg', 'g', 'l', 'u'].includes(nombre) ? `${nombre}${/[aeiou]$/.test(nombre) ? 's' : 'es'}`.replace('bidónes', 'bidones') : nombre
  }
  return ''
}

// Número: entero, decimal, fracción ("1/2", "3/4") o "½ ¼ ¾". Antes "1/2 kg de
// palta" no se entendía: quedaba todo como nombre y no encontraba el insumo.
const RE_NUM = String.raw`(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?|[½¼¾])`
const RE_CANT = String.raw`${RE_NUM}\s*([a-zA-ZáéíóúÁÉÍÓÚ]+)?`
const FRACCION: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 }

/** "1/2" → 0.5, "½" → 0.5, "2,5" → 2.5 (NaN si no es un número) */
export function leerNumero(s: string): number {
  const t = s.trim()
  if (t in FRACCION) return FRACCION[t]
  const mixto = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/) // "1 1/2"
  if (mixto) return Number(mixto[3]) > 0 ? Number(mixto[1]) + Number(mixto[2]) / Number(mixto[3]) : NaN
  const f = t.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (f) return Number(f[2]) > 0 ? Number(f[1]) / Number(f[2]) : NaN
  return parseFloat(t.replace(',', '.'))
}

/**
 * Cantidad escrita con fracción → decimal, para quien la lee con parseFloat:
 * "1/2kg" → "0,5kg", "½ kg" → "0,5 kg". Sin fracción la devuelve igual.
 */
export function fraccionADecimal(s: string): string {
  return s.replace(/(\d+\s+)?(\d+)\s*\/\s*(\d+)|[½¼¾]/g, (m) => {
    const n = leerNumero(m)
    return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000).replace('.', ',') : m
  })
}

const fmtNum = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',')

/** "5k" → "5 kg", "2 cajas" → "2 cajas", "1/2kg" → "0,5 kg". Devuelve null si no es una cantidad. */
function leerCantidad(s: string): string | null {
  const m = s.trim().match(new RegExp(`^${RE_CANT}\\.?$`))
  if (!m) return null
  const n = leerNumero(m[1])
  if (!Number.isFinite(n)) return null
  const u = unidad(m[2], n)
  if (m[2] && !u) return null
  return `${fmtNum(n)}${u ? ` ${u}` : ''}`
}

function separar(linea: string): { nombre: string; cantidad: string } {
  // "Producto — 10 lts" / "Producto: 2 cajas" / "Producto - 1 kg" / "Producto x 3"
  const sep = linea.match(/^(.+?)\s*(?:—|–|:|\s-\s|\sx\s)\s*(.+)$/i)
  if (sep) {
    const cant = leerCantidad(sep[2].replace(/\([^)]*\)/g, '').trim())
    if (cant) return { nombre: sep[1].trim(), cantidad: cant }
    if (/falta|\?|definir/i.test(sep[2])) return { nombre: sep[1].trim(), cantidad: '' }
  }
  // "5k de molida" / "10 kg primo"
  const ini = linea.match(new RegExp(`^${RE_CANT}\\s+(?:de\\s+)?(.+)$`, 'i'))
  if (ini) {
    const n = leerNumero(ini[1])
    const u = unidad(ini[2], n)
    if (u) return { nombre: ini[3].trim(), cantidad: `${fmtNum(n)} ${u}` }
    if (!ini[2]) return { nombre: ini[3].trim(), cantidad: fmtNum(n) }
    // "5 lomos": la palabra después del número es el producto
    return { nombre: `${ini[2]} ${ini[3]}`.trim(), cantidad: fmtNum(n) }
  }
  // "Molida 5k" (cantidad al final)
  const fin = linea.match(new RegExp(`^(.+?)\\s+${RE_CANT}$`, 'i'))
  if (fin) {
    const cant = leerCantidad(`${fin[2]}${fin[3] ? ` ${fin[3]}` : ''}`)
    if (cant) return { nombre: fin[1].trim(), cantidad: cant }
  }
  return { nombre: linea.trim(), cantidad: '' }
}

/**
 * Para un texto escrito a mano ("1/2 kg de palta", "palta — 2 kg"): el insumo
 * que corresponde, o null. Sirve para sugerirlo al pedir o al recibir.
 */
export function sugerirInsumo<T extends InsumoPedible>(texto: string, insumos: T[]): T | null {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  if (!limpio) return null
  return (buscarInsumo(separar(limpio).nombre, insumos) ?? buscarInsumo(limpio, insumos)) as T | null
}

/** Busca el insumo que mejor corresponde: tienen que estar todas las palabras del pedido. */
export function buscarInsumo(nombre: string, insumos: InsumoPedible[]): InsumoPedible | null {
  const q = tokens(nombre)
  if (q.length === 0) return null
  let mejor: { i: InsumoPedible; score: number } | null = null
  for (const i of insumos) {
    const t = tokens(i.name)
    // palabra del pedido = palabra del insumo, o prefijo (verdura → verduras); los números, exactos
    const ok = q.every((w) => t.some((x) => x === w || (!/^\d+$/.test(w) && w.length >= 4 && (x.startsWith(w) || w.startsWith(x) && x.length >= 4))))
    if (!ok) continue
    // Preferir el insumo con menos palabras de más ("Lomo" antes que "Tira de lomo")
    const score = q.length / t.length
    if (!mejor || score > mejor.score) mejor = { i, score }
  }
  return mejor?.i ?? null
}

/** Lo que escribió, si dice algo más que el nombre del insumo ("lomo un solo pedazo"). */
export function detalleDe(escrito: string, insumo: string): string | null {
  const n = (x: string) => sinAcentos(x.toLowerCase()).replace(/\s+/g, ' ').trim()
  return n(insumo).includes(n(escrito)) ? null : escrito.trim()
}

export function leerListaPegada(texto: string, insumos: InsumoPedible[]): RenglonPegado[] {
  const out: RenglonPegado[] = []
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.replace(/^[\s•·*\-–—>]+|\d+[.)]\s+(?=\D)/g, '').replace(/\s+/g, ' ').trim()
    if (!linea) continue
    // Títulos ("Pedidos de carne", "Verdulería:") no son productos
    if (/^pedidos?\b/i.test(linea) || /:$/.test(linea)) continue
    const { nombre, cantidad } = separar(linea)
    if (!nombre) continue
    out.push({ texto: linea, nombre, cantidad, insumo: buscarInsumo(nombre, insumos) })
  }
  return out
}
