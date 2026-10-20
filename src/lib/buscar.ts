// ---------------------------------------------------------------------------
// Búsqueda de productos por palabras (lupa de Stock, Conteo y Elaborados)
// ---------------------------------------------------------------------------
// Cada palabra escrita tiene que estar en el nombre, en cualquier orden, sin
// importar mayúsculas, tildes ni espacios: "vaso 6 oz", "6oz vaso" y "vaso 6"
// encuentran "Vaso polipapel 6oz". Sin imports de servidor.
// ---------------------------------------------------------------------------

export function normalizarTexto(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** ¿El nombre coincide con lo buscado? (búsqueda vacía = sí) */
export function coincideBusqueda(nombre: string, busqueda: string): boolean {
  const palabras = normalizarTexto(busqueda).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return true
  const n = normalizarTexto(nombre)
  const junto = n.replace(/\s+/g, '')
  return palabras.every((p) => n.includes(p) || junto.includes(p))
}
