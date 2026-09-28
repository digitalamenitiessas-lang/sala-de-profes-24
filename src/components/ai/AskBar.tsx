'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Sparkles, Loader2, X, ArrowRight, CornerDownLeft } from 'lucide-react'
import { FadeIn } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// AskBar — preguntar en castellano desde cualquier pantalla
// ---------------------------------------------------------------------------
// Una sola barra, el mismo motor detrás (/api/ask). La IA interpreta la
// pregunta; los números salen siempre de la base, nunca los inventa.
// ---------------------------------------------------------------------------

type AskColumn = { key: string; label: string; align?: 'left' | 'right' }

type AskResponse = {
  answer: string
  columns: AskColumn[]
  rows: Record<string, string | number | null>[]
  matched: number
  href?: string
  note?: string
  via: 'ia' | 'reglas'
  error?: string
}

type Props = {
  scope: 'stock' | 'numeros' | 'control' | 'hoy'
  /** Ejemplos que se muestran cuando la barra está vacía. */
  examples?: string[]
  placeholder?: string
}

const DEFAULT_EXAMPLES: Record<Props['scope'], string[]> = {
  stock: ['¿qué me falta en cocina?', '¿qué hay en negativo?', '¿qué no cuento hace una semana?'],
  numeros: ['¿qué plato deja más plata?', '¿qué vendí más esta semana?', '¿a quién le compro más?'],
  control: ['¿qué insumos están sin proveedor?', '¿qué quedó sin área?', '¿qué hay en negativo?'],
  hoy: ['¿qué tengo que comprar?', '¿qué produje esta semana?', '¿qué me falta en pastelería?'],
}

export function AskBar({ scope, examples, placeholder }: Props) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AskResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sugerencias = examples ?? DEFAULT_EXAMPLES[scope]

  async function ask(q: string) {
    const pregunta = q.trim()
    if (!pregunta || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: pregunta, scope }),
      })
      const data = (await res.json()) as AskResponse
      if (!res.ok) throw new Error(data.error ?? 'No pude resolver la consulta')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pude resolver la consulta')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const clear = () => { setQuestion(''); setResult(null); setError(null) }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Sparkles className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8b5e34]" />
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void ask(question) }}
          placeholder={placeholder ?? 'Preguntá en castellano…'}
          className="w-full rounded-2xl border border-[#e6dfd7] bg-white py-2.5 pl-10 pr-20 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#8b5e34] focus:outline-none"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {(question || result) && (
            <button onClick={clear} className="rounded-full p-1.5 text-[#a39e97] hover:bg-[#f3efe9]" aria-label="Limpiar">
              <X className="size-3.5" />
            </button>
          )}
          <button
            onClick={() => void ask(question)}
            disabled={loading || !question.trim()}
            className="flex size-8 items-center justify-center rounded-xl bg-[#8b5e34] text-white disabled:opacity-40"
            aria-label="Preguntar"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <CornerDownLeft className="size-4" />}
          </button>
        </div>
      </div>

      {!result && !error && !loading && (
        <div className="flex flex-wrap gap-1.5">
          {sugerencias.map((s) => (
            <button
              key={s}
              onClick={() => { setQuestion(s); void ask(s) }}
              className="rounded-full bg-[#faf8f5] px-2.5 py-1 text-[11px] font-medium text-[#7d6c64] ring-1 ring-[#ebe6df] active:scale-95"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-2xl bg-[#fff7f7] px-4 py-3 text-[12px] text-[#ea504c] ring-1 ring-[#f3d0cf]">
          {error}
        </div>
      )}

      {result && (
        <FadeIn>
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
            <div className="border-b border-[#f5f0ea] bg-[#faf8f5] px-4 py-3">
              <p className="text-[13px] font-semibold leading-snug text-[#3d2c24]">{result.answer}</p>
              {result.note && <p className="mt-1 text-[11px] leading-snug text-[#a39e97]">{result.note}</p>}
            </div>

            {result.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-[#f5f0ea] text-[10px] uppercase tracking-wider text-[#a39e97]">
                      {result.columns.map((c) => (
                        <th key={c.key} className={`px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f5f0ea]">
                    {result.rows.map((row, i) => {
                      const href = typeof row._href === 'string' ? row._href : null
                      return (
                        <tr key={i} className={href ? 'hover:bg-[#faf8f5]' : undefined}>
                          {result.columns.map((c, ci) => {
                            const value = row[c.key] ?? '—'
                            const esPrimera = ci === 0
                            return (
                              <td
                                key={c.key}
                                className={`px-3 py-2 text-[#3d2c24] ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${esPrimera ? 'font-medium' : 'text-[#7d6c64]'}`}
                              >
                                {esPrimera && href
                                  ? <Link href={href} className="underline decoration-[#d9d2c9] underline-offset-2">{value}</Link>
                                  : value}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-[#f5f0ea] px-4 py-2.5">
              <span className="text-[10px] text-[#a39e97]">
                {result.matched > result.rows.length ? `Mostrando ${result.rows.length} de ${result.matched}` : `${result.matched} resultado${result.matched === 1 ? '' : 's'}`}
                {result.via === 'reglas' && ' · sin IA'}
              </span>
              {result.href && (
                <Link href={result.href} className="flex items-center gap-1 text-[11px] font-semibold text-[#006d5a]">
                  Abrir pantalla <ArrowRight className="size-3" />
                </Link>
              )}
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  )
}
