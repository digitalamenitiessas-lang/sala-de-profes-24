'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { ENLACES, destinosDelMensaje, resolverDestino } from '@/lib/ai/destinos'

// ---------------------------------------------------------------------------
// Mensaje de La Vieja: markdown liviano + pantallas con un toque
// ---------------------------------------------------------------------------
// Traído de Santa Fe (baaab00). Lo usan el chat flotante y /asistente (antes
// cada uno tenía su copia). Cuando La Vieja nombra una pantalla con su dirección:
//   «**Horneado** (/cocina/horneado)» → se saca "(/cocina/…)" y abajo aparece
//     el botón «Ir a Horneado»
//   «[Conteo guiado](/stock/conteo)» → el texto es un link
//   «Entrá a /mi-turno» → «Entrá a Mi Turno» (link)
// Solo si la pantalla está en el menú de esa persona (lib/ai/destinos): una
// dirección inventada o de otro rol no da botón (entre paréntesis se oculta;
// suelta queda como texto).
// ---------------------------------------------------------------------------

const MAX_BOTONES = 3

type Tamano = 'chico' | 'normal'

export function MensajeBot({ texto, role, tamano = 'normal', onIr }: {
  texto: string
  role: string | null | undefined
  tamano?: Tamano
  /** Al tocar un link o botón (el chat flotante se cierra para ver la pantalla) */
  onIr?: () => void
}) {
  const destinos = destinosDelMensaje(texto, role).slice(0, MAX_BOTONES)
  const chico = tamano === 'chico'

  const enlazar = (t: string, k: string): React.ReactNode[] => {
    const out: React.ReactNode[] = []
    let desde = 0
    let n = 0
    for (const m of t.matchAll(ENLACES)) {
      const i = m.index ?? 0
      if (i > desde) out.push(t.slice(desde, i))
      desde = i + m[0].length
      const key = `${k}-${n++}`
      if (m[2] !== undefined) {
        // [texto](/ruta): el texto es el link (si la ruta no vale, queda el texto solo)
        const d = resolverDestino(m[2], role)
        out.push(d ? <LinkPantalla key={key} href={d.href} onIr={onIr}>{m[1]}</LinkPantalla> : m[1])
      } else if (m[5] !== undefined) {
        // /ruta suelta: el nombre de la pantalla, como link
        const d = resolverDestino(m[5], role)
        out.push(m[4])
        out.push(d ? <LinkPantalla key={key} href={d.href} onIr={onIr}>{d.label}</LinkPantalla> : m[5])
      }
      // (/ruta) después del nombre no se muestra: si es una pantalla suya la
      // lleva el botón de abajo, y si no, es una dirección técnica que no sirve
      // (el nombre ya está en el texto)
    }
    if (desde < t.length) out.push(t.slice(desde))
    return out
  }

  const inline = (t: string, k: string): React.ReactNode =>
    t.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
      parte.startsWith('**') && parte.endsWith('**') && parte.length > 4
        ? <strong key={`${k}b${i}`} className="font-semibold">{enlazar(parte.slice(2, -2), `${k}b${i}`)}</strong>
        : <span key={`${k}t${i}`}>{enlazar(parte, `${k}t${i}`)}</span>,
    )

  const lineas = texto.split('\n').map((linea, i) => {
    const k = `l${i}`
    if (linea.startsWith('### ')) {
      return <h4 key={k} className={`mb-1 text-xs font-bold first:mt-0 ${chico ? 'mt-2.5' : 'mt-3'}`}>{inline(linea.slice(4), k)}</h4>
    }
    if (linea.startsWith('## ')) {
      return <h3 key={k} className={`font-bold first:mt-0 ${chico ? 'mb-1 mt-2.5 text-[13px]' : 'mb-1.5 mt-3 text-sm'}`}>{inline(linea.slice(3), k)}</h3>
    }
    if (linea.startsWith('- ')) {
      return (
        <div key={k} className="flex gap-1.5 py-0.5 pl-1">
          <span className="shrink-0 text-[10px] leading-relaxed">•</span>
          <span>{inline(linea.slice(2), k)}</span>
        </div>
      )
    }
    const num = linea.match(/^(\d+)\.\s(.+)/)
    if (num) {
      return (
        <div key={k} className="flex gap-1.5 py-0.5 pl-1">
          <span className="shrink-0 font-semibold text-[#006d5a]">{num[1]}.</span>
          <span>{inline(num[2], k)}</span>
        </div>
      )
    }
    if (linea.trim() === '') return <div key={k} className={chico ? 'h-1' : 'h-1.5'} />
    return <p key={k} className="py-0.5">{inline(linea, k)}</p>
  })

  return (
    <>
      <div className="whitespace-pre-wrap">{lineas}</div>
      {destinos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {destinos.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              onClick={onIr}
              className="inline-flex items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-95"
            >
              Ir a {d.label}
              <ArrowRight className="size-3" />
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

function LinkPantalla({ href, onIr, children }: { href: string; onIr?: () => void; children: React.ReactNode }) {
  return (
    <Link href={href} onClick={onIr} className="font-semibold text-[#006d5a] underline decoration-[#006d5a]/40 underline-offset-2">
      {children}
    </Link>
  )
}
