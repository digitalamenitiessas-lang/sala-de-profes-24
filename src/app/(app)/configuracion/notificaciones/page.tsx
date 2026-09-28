'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bell, BellOff, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { ROLE_OPTIONS } from '@/lib/constants'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// Configuración de notificaciones push — solo socio
// ---------------------------------------------------------------------------
// Por cada evento: activar/desactivar, y elegir qué roles + qué usuarios
// puntuales lo reciben. Guardado en app_settings vía /api/notification-settings.
// ---------------------------------------------------------------------------

type EventConfig = {
  label: string
  description: string
  enabled: boolean
  target_roles: AppRole[]
  target_user_ids: string[]
}

type ProfileOption = { id: string; name: string; role: AppRole }

export default function NotificacionesConfigPage() {
  const [settings, setSettings] = useState<Record<string, EventConfig>>({})
  const [profiles, setProfiles] = useState<ProfileOption[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const [res, profRes] = await Promise.all([
          fetch('/api/notification-settings'),
          createClient().from('profiles').select('id, first_name, last_name, role').eq('is_active', true).order('first_name'),
        ])
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'No se pudo cargar')
        const data = await res.json()
        setSettings(data.settings ?? {})
        setProfiles(
          (profRes.data ?? []).map((p) => ({
            id: p.id,
            name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Sin nombre',
            role: p.role as AppRole,
          })),
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al cargar')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function patch(eventKey: string, body: Partial<Pick<EventConfig, 'enabled' | 'target_roles' | 'target_user_ids'>>) {
    setSavingKey(eventKey)
    try {
      const res = await fetch('/api/notification-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventKey, ...body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar')
      setSettings(data.settings)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSavingKey(null)
    }
  }

  function toggleRole(eventKey: string, role: AppRole) {
    const cfg = settings[eventKey]
    const has = cfg.target_roles.includes(role)
    const next = has ? cfg.target_roles.filter((r) => r !== role) : [...cfg.target_roles, role]
    patch(eventKey, { target_roles: next })
  }

  function toggleUser(eventKey: string, userId: string) {
    const cfg = settings[eventKey]
    const has = cfg.target_user_ids.includes(userId)
    const next = has ? cfg.target_user_ids.filter((id) => id !== userId) : [...cfg.target_user_ids, userId]
    patch(eventKey, { target_user_ids: next })
  }

  const entries = useMemo(() => Object.entries(settings), [settings])

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-4">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/configuracion" className="rounded-full p-1.5 hover:bg-black/5">
          <ArrowLeft className="size-5 text-[#3d2c24]" />
        </Link>
        <div className="flex items-center gap-2">
          <Bell className="size-5 text-[#006d5a]" />
          <h1 className="text-[18px] font-bold text-[#3d2c24]">Notificaciones push</h1>
        </div>
      </div>

      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        Elegí qué eventos mandan notificación real al celular/PC, y quién la recibe (por rol o por persona puntual).
        Solo vos como socio podés ver y cambiar esto.
      </p>

      <EquipoConAvisos />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(([key, cfg]) => {
            const saving = savingKey === key
            const expanded = expandedKey === key
            return (
              <div key={key} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#3d2c24]">{cfg.label}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{cfg.description}</p>
                  </div>
                  <button
                    onClick={() => patch(key, { enabled: !cfg.enabled })}
                    disabled={saving}
                    className={`flex h-7 w-12 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-50 ${cfg.enabled ? 'justify-end bg-[#006d5a]' : 'justify-start bg-[#ebe6df]'}`}
                  >
                    <span className="size-6 rounded-full bg-white shadow" />
                  </button>
                </div>

                {cfg.enabled && (
                  <>
                    <button
                      onClick={() => setExpandedKey(expanded ? null : key)}
                      className="mt-3 flex items-center gap-1 text-[12px] font-medium text-[#006d5a]"
                    >
                      {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      {cfg.target_roles.length + cfg.target_user_ids.length} destinatario{cfg.target_roles.length + cfg.target_user_ids.length !== 1 ? 's' : ''} — {expanded ? 'ocultar' : 'ver/editar'}
                    </button>

                    {expanded && (
                      <div className="mt-3 space-y-3 border-t border-[#ebe6df] pt-3">
                        <div>
                          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Por rol</p>
                          <div className="flex flex-wrap gap-1.5">
                            {ROLE_OPTIONS.map((opt) => {
                              const active = cfg.target_roles.includes(opt.value)
                              return (
                                <button
                                  key={opt.value}
                                  onClick={() => toggleRole(key, opt.value)}
                                  disabled={saving}
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${active ? 'bg-[#006d5a] text-white' : 'bg-[#f5f2ee] text-[#7d6c64]'}`}
                                >
                                  {opt.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <div>
                          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Personas puntuales</p>
                          <div className="flex flex-wrap gap-1.5">
                            {profiles.map((p) => {
                              const active = cfg.target_user_ids.includes(p.id)
                              return (
                                <button
                                  key={p.id}
                                  onClick={() => toggleUser(key, p.id)}
                                  disabled={saving}
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${active ? 'bg-[#3d2c24] text-white' : 'bg-[#f5f2ee] text-[#7d6c64]'}`}
                                >
                                  {p.name}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {!cfg.enabled && (
                  <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <BellOff className="size-3" /> Este evento no manda push a nadie ahora
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Quién tiene los avisos activados: sin eso las notificaciones no le llegan
function EquipoConAvisos() {
  const [equipo, setEquipo] = useState<{ id: string; nombre: string; role: string; dispositivos: number }[] | null>(null)
  const [verTodos, setVerTodos] = useState(false)
  useEffect(() => {
    fetch('/api/push/equipo', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setEquipo(j?.equipo ?? null))
      .catch(() => {})
  }, [])
  if (!equipo) return null
  const clave = equipo.filter((e) => ['socio', 'encargado', 'chef'].includes(e.role))
  const lista = verTodos ? equipo : clave
  const con = lista.filter((e) => e.dispositivos > 0).length
  return (
    <div className="mb-4 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-[#ebe6df]">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-semibold text-[#3d2c24]">Quién tiene los avisos activados</p>
        <p className="text-[12px] font-semibold tabular-nums text-[#006d5a]">{con} de {lista.length}</p>
      </div>
      <p className="mt-0.5 text-[11.5px] text-[#a39e97]">
        A quien no los tenga no le llega ninguna notificación. Cada uno los activa desde su celular (aparece un aviso en Inicio).
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {lista.map((e) => (
          <span key={e.id} className={e.dispositivos > 0 ? 'flex items-center gap-1 rounded-full bg-[#e8f5f1] px-2.5 py-1 text-[11.5px] text-[#006d5a]' : 'flex items-center gap-1 rounded-full bg-[#fef2f2] px-2.5 py-1 text-[11.5px] text-[#ea504c]'}>
            {e.dispositivos > 0 ? <Bell className="size-3" /> : <BellOff className="size-3" />} {e.nombre || 'Sin nombre'}
          </span>
        ))}
      </div>
      <button onClick={() => setVerTodos((v) => !v)} className="mt-2 text-[11.5px] font-semibold text-[#006d5a]">
        {verTodos ? 'Ver solo socios, encargados y chef' : 'Ver todo el equipo'}
      </button>
    </div>
  )
}
