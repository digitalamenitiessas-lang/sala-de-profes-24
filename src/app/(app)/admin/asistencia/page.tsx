'use client'

import { useCallback, useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth, subWeeks } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Users, AlertTriangle, Clock, CheckCircle, XCircle, Download,
  Settings, Wifi, WifiOff, Smartphone, RefreshCw, ChevronRight,
  Shield, Calendar, Search, Check, X
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import { cn } from '@/lib/utils'
import type { AttendanceDashboardRow, AttendanceAnomaly, WifiAccessPoint, AttendanceConfig } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Tab = 'overview' | 'employees' | 'anomalies' | 'corrections' | 'config' | 'devices'

type CorrectionRow = {
  id: string
  employee: { first_name: string; last_name: string; role: string }
  correction_type: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  new_value: Record<string, unknown>
}

type DeviceRow = {
  id: string
  employee_id: string
  device_fingerprint: string
  device_name: string | null
  user_agent: string | null
  registered_at: string
  is_active: boolean
  profiles: { first_name: string; last_name: string; role: string } | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    socio: 'bg-purple-100 text-purple-700',
    encargado: 'bg-blue-100 text-blue-700',
    chef: 'bg-orange-100 text-orange-700',
    cocina: 'bg-amber-100 text-amber-700',
    barista: 'bg-cyan-100 text-cyan-700',
    runner: 'bg-green-100 text-green-700',
    bacha: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold', colors[role] ?? 'bg-gray-100 text-gray-600')}>
      {role}
    </span>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize', colors[severity] ?? 'bg-gray-100 text-gray-600')}>
      {severity}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function AdminAsistenciaPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  // Date range
  const today = new Date()
  const [fromDate, setFromDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'))
  const [toDate, setToDate] = useState(format(today, 'yyyy-MM-dd'))

  // Dashboard data
  const [employees, setEmployees] = useState<AttendanceDashboardRow[]>([])
  const [anomalies, setAnomalies] = useState<AttendanceAnomaly[]>([])
  const [corrections, setCorrections] = useState<CorrectionRow[]>([])
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [wifiAPs, setWifiAPs] = useState<WifiAccessPoint[]>([])
  const [config, setConfig] = useState<Record<string, Record<string, unknown>>>({})
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  // Config edit
  const [editingConfig, setEditingConfig] = useState(false)
  const [configForm, setConfigForm] = useState({
    radius: 300,
    daily_limit: 8,
    unusual_before: '05:00',
    unusual_after: '23:30',
    wifi_check: true,
    gps_check: true,
    device_check: true,
  })

  // WiFi AP form
  const [newAP, setNewAP] = useState({ name: '', bssid: '', ssid: '' })
  const [addingAP, setAddingAP] = useState(false)

  // Search
  const [search, setSearch] = useState('')

  // -----------------------------------------------------------------------
  // Auth check
  // -----------------------------------------------------------------------
  const isAdmin = profile && ['socio', 'encargado'].includes(profile.role)

  // -----------------------------------------------------------------------
  // Load data
  // -----------------------------------------------------------------------
  const loadDashboard = useCallback(async () => {
    if (!isAdmin) return
    setLoading(true)
    try {
      const [dashRes, anomRes, corrRes, devRes, cfgRes] = await Promise.all([
        fetch(`/api/attendance/dashboard?from=${fromDate}&to=${toDate}`),
        fetch(`/api/attendance/anomalies?resolved=false`),
        fetch(`/api/attendance/corrections?status=pending`),
        fetch(`/api/attendance/devices`),
        fetch(`/api/attendance/config`),
      ])

      if (dashRes.ok) {
        const d = await dashRes.json()
        setEmployees(d.employees ?? [])
        setWifiAPs(d.wifi_aps ?? [])
      }
      if (anomRes.ok) {
        const d = await anomRes.json()
        setAnomalies(d.anomalies ?? [])
      }
      if (corrRes.ok) {
        const d = await corrRes.json()
        setCorrections(d.corrections ?? [])
      }
      if (devRes.ok) {
        const d = await devRes.json()
        setDevices(d.devices ?? [])
      }
      if (cfgRes.ok) {
        const d = await cfgRes.json()
        const c = d.config as Record<string, Record<string, unknown>>
        setConfig(c)
        setConfigForm({
          radius: (c.location?.radius_meters as number) ?? 300,
          daily_limit: (c.extra_hours?.daily_limit_hours as number) ?? 8,
          unusual_before: (c.working_hours?.unusual_before as string) ?? '05:00',
          unusual_after: (c.working_hours?.unusual_after as string) ?? '23:30',
          wifi_check: (c.anomaly_checks?.wifi as boolean) ?? true,
          gps_check: (c.anomaly_checks?.gps as boolean) ?? true,
          device_check: (c.anomaly_checks?.device as boolean) ?? true,
        })
      }
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [isAdmin, fromDate, toDate, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadDashboard() }, [loadDashboard])

  // -----------------------------------------------------------------------
  // Resolve anomaly
  // -----------------------------------------------------------------------
  async function resolveAnomaly(id: string) {
    const res = await fetch('/api/attendance/anomalies', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, resolution_notes: 'Revisado y aprobado por admin' }),
    })
    if (res.ok) {
      setAnomalies(prev => prev.filter(a => a.id !== id))
      toast.success('Anomalía resuelta')
    } else toast.error('Error al resolver anomalía')
  }

  // -----------------------------------------------------------------------
  // Approve / reject correction
  // -----------------------------------------------------------------------
  async function handleCorrection(id: string, action: 'approve' | 'reject') {
    const res = await fetch('/api/attendance/corrections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    if (res.ok) {
      setCorrections(prev => prev.filter(c => c.id !== id))
      toast.success(action === 'approve' ? 'Corrección aprobada' : 'Corrección rechazada')
    } else toast.error('Error')
  }

  // -----------------------------------------------------------------------
  // Approve / revoke device
  // -----------------------------------------------------------------------
  async function toggleDevice(id: string, activate: boolean) {
    const res = await fetch('/api/attendance/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: id, is_active: activate }),
    })
    if (res.ok) {
      setDevices(prev => prev.map(d => d.id === id ? { ...d, is_active: activate } : d))
      toast.success(activate ? 'Dispositivo aprobado' : 'Dispositivo revocado')
    } else toast.error('Error')
  }

  // -----------------------------------------------------------------------
  // Save config
  // -----------------------------------------------------------------------
  async function saveConfig() {
    const updates = [
      { key: 'location', value: { ...config.location, radius_meters: configForm.radius } },
      { key: 'extra_hours', value: { ...config.extra_hours, daily_limit_hours: configForm.daily_limit } },
      { key: 'working_hours', value: { ...config.working_hours, unusual_before: configForm.unusual_before, unusual_after: configForm.unusual_after } },
      { key: 'anomaly_checks', value: { ...config.anomaly_checks, wifi: configForm.wifi_check, gps: configForm.gps_check, device: configForm.device_check } },
    ]
    const res = await fetch('/api/attendance/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })
    if (res.ok) { setEditingConfig(false); toast.success('Configuración guardada'); setRefreshKey(k => k + 1) }
    else toast.error('Error al guardar config')
  }

  // -----------------------------------------------------------------------
  // Add WiFi AP
  // -----------------------------------------------------------------------
  async function addWifiAP() {
    if (!newAP.name.trim()) { toast.error('Nombre requerido'); return }
    // We insert directly via supabase from admin context
    // For now use a fetch to a quick endpoint — or use client directly
    // Since we don't have a dedicated AP endpoint, we can insert from client
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { error } = await supabase.from('wifi_access_points').insert({
      name: newAP.name,
      bssid: newAP.bssid || null,
      ssid: newAP.ssid || null,
    })
    if (!error) {
      toast.success('AP agregado')
      setNewAP({ name: '', bssid: '', ssid: '' })
      setAddingAP(false)
      setRefreshKey(k => k + 1)
    } else toast.error('Error al agregar AP')
  }

  // -----------------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------------
  function handleExport() {
    window.open(`/api/attendance/export?from=${fromDate}&to=${toDate}`, '_blank')
  }

  // -----------------------------------------------------------------------
  // Loading / auth
  // -----------------------------------------------------------------------
  if (profileLoading || loading) return <LoadingState message="Cargando asistencia…" />
  if (!isAdmin) return <div className="flex min-h-[60vh] items-center justify-center"><p className="text-muted-foreground">Sin permisos.</p></div>

  const currently_in = employees.filter(e => e.is_currently_in).length
  const total_open_anomalies = anomalies.length
  const filtered_employees = employees.filter(e =>
    search ? `${e.first_name} ${e.last_name}`.toLowerCase().includes(search.toLowerCase()) : true
  )

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-28">
      <FadeIn className="pt-4">
        {/* Header */}
        <div className="flex items-center justify-between px-1">
          <div>
            <h1 className="font-display text-2xl font-bold text-[#3d2c24]">Asistencia</h1>
            <p className="section-label">Panel de control</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRefreshKey(k => k + 1)} className="h-8 px-3">
              <RefreshCw className="size-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} className="h-8 px-3 gap-1.5">
              <Download className="size-3.5" />
              <span className="text-xs">Exportar</span>
            </Button>
          </div>
        </div>
      </FadeIn>

      {/* Date range */}
      <FadeIn delay={0.05}>
        <div className="card-elevated flex items-center gap-3 px-4 py-3">
          <Calendar className="size-4 text-[#a39e97] shrink-0" />
          <div className="flex flex-1 items-center gap-2">
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="flex-1 rounded-lg border border-[#ebe6df] bg-[#fefcf9] px-3 py-1.5 text-xs" />
            <span className="text-xs text-[#a39e97]">—</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="flex-1 rounded-lg border border-[#ebe6df] bg-[#fefcf9] px-3 py-1.5 text-xs" />
          </div>
          <Button size="sm" variant="outline" onClick={() => { setFromDate(format(subWeeks(today, 1), 'yyyy-MM-dd')); setToDate(format(today, 'yyyy-MM-dd')) }}
            className="h-7 px-2 text-[10px]">Esta semana</Button>
        </div>
      </FadeIn>

      {/* KPI cards */}
      <FadeIn delay={0.08}>
        <div className="grid grid-cols-3 gap-3">
          <div className="card-elevated flex flex-col items-center py-3">
            <p className="font-display text-3xl font-bold text-[#006d5a]">{currently_in}</p>
            <p className="section-label mt-1 text-center">Trabajando</p>
          </div>
          <div className="card-elevated flex flex-col items-center py-3">
            <p className={cn('font-display text-3xl font-bold', total_open_anomalies > 0 ? 'text-[#d4943a]' : 'text-[#3d2c24]')}>
              {total_open_anomalies}
            </p>
            <p className="section-label mt-1 text-center">Anomalías</p>
          </div>
          <div className="card-elevated flex flex-col items-center py-3">
            <p className={cn('font-display text-3xl font-bold', corrections.length > 0 ? 'text-[#ea504c]' : 'text-[#3d2c24]')}>
              {corrections.length}
            </p>
            <p className="section-label mt-1 text-center">Correcciones</p>
          </div>
        </div>
      </FadeIn>

      {/* Tabs */}
      <FadeIn delay={0.1}>
        <div className="flex overflow-x-auto gap-1 rounded-xl bg-[#f7f3ee] p-1">
          {([
            { id: 'overview', label: 'Resumen', icon: Users },
            { id: 'anomalies', label: `Anomalías ${total_open_anomalies > 0 ? `(${total_open_anomalies})` : ''}`, icon: AlertTriangle },
            { id: 'corrections', label: `Correcciones ${corrections.length > 0 ? `(${corrections.length})` : ''}`, icon: CheckCircle },
            { id: 'devices', label: 'Dispositivos', icon: Smartphone },
            { id: 'config', label: 'Config', icon: Settings },
          ] as { id: Tab; label: string; icon: React.ElementType }[]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-all',
                activeTab === tab.id
                  ? 'bg-white text-[#006d5a] shadow-sm'
                  : 'text-[#a39e97] hover:text-[#3d2c24]',
              )}
            >
              <tab.icon className="size-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </FadeIn>

      {/* --- OVERVIEW TAB --- */}
      {activeTab === 'overview' && (
        <FadeIn>
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Search className="size-4 text-[#a39e97]" />
              <input type="text" placeholder="Buscar empleado…" value={search} onChange={e => setSearch(e.target.value)}
                className="flex-1 text-sm outline-none bg-transparent text-[#3d2c24] placeholder:text-[#a39e97]" />
            </div>
            <StaggerList className="space-y-2">
              {filtered_employees.map(emp => (
                <StaggerItem key={emp.employee_id}>
                  <div className="card-elevated flex items-center gap-3 rounded-xl px-4 py-3">
                    <div
                      className={cn('size-2.5 rounded-full shrink-0', emp.is_currently_in ? 'bg-[#006d5a]' : 'bg-[#ebe6df]')}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#3d2c24] truncate">
                        {emp.first_name} {emp.last_name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <RoleBadge role={emp.role} />
                        {emp.last_event_time && (
                          <span className="text-[10px] text-[#a39e97]">
                            {emp.is_currently_in ? 'Ingresó' : 'Egresó'} {format(new Date(emp.last_event_time), 'HH:mm')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular-nums text-[#3d2c24]">{Number(emp.total_hours).toFixed(1)}h</p>
                      <p className="text-[10px] text-[#a39e97]">{emp.days_worked}d / {fromDate.slice(5)}-{toDate.slice(5)}</p>
                      {emp.open_anomalies > 0 && (
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <AlertTriangle className="size-3 text-[#d4943a]" />
                          <span className="text-[10px] text-[#d4943a]">{emp.open_anomalies}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </StaggerItem>
              ))}
              {filtered_employees.length === 0 && (
                <div className="py-8 text-center text-sm text-[#a39e97]">Sin resultados</div>
              )}
            </StaggerList>
          </div>
        </FadeIn>
      )}

      {/* --- ANOMALIES TAB --- */}
      {activeTab === 'anomalies' && (
        <FadeIn>
          <div className="space-y-2.5">
            {anomalies.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Shield className="size-10 text-[#006d5a]/30" />
                <p className="text-sm font-medium text-[#3d2c24]">Sin anomalías pendientes</p>
                <p className="text-xs text-[#a39e97]">¡Todo en orden!</p>
              </div>
            ) : (
              anomalies.map(a => {
                const emp = a as unknown as { profiles: { first_name: string; last_name: string; role: string } | null }
                const evtInfo = a as unknown as { clock_events: { event_type: string; timestamp: string } | null }
                return (
                  <div key={a.id} className="card-elevated rounded-xl px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-[#3d2c24]">
                          {emp.profiles?.first_name} {emp.profiles?.last_name}
                        </p>
                        <p className="text-xs text-[#a39e97]">
                          {evtInfo.clock_events?.event_type === 'clock_in' ? '🟢 Ingreso' : '🔴 Egreso'}{' '}
                          {evtInfo.clock_events?.timestamp
                            ? format(new Date(evtInfo.clock_events.timestamp), "d MMM HH:mm", { locale: es })
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={a.severity} />
                        <Button size="sm" variant="outline" onClick={() => resolveAnomaly(a.id)}
                          className="h-7 px-2.5 text-[10px] text-[#006d5a] border-[#006d5a]/30">
                          Resolver
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg bg-[#f7f3ee] px-3 py-2">
                      <p className="text-xs font-medium text-[#3d2c24]">
                        {a.anomaly_type === 'gps_out_of_range' && '📍 GPS fuera del rango'}
                        {a.anomaly_type === 'wifi_mismatch' && '📶 Red WiFi no reconocida'}
                        {a.anomaly_type === 'unknown_device' && '📱 Dispositivo no registrado'}
                        {a.anomaly_type === 'rapid_succession' && '⚡ Fichaje muy rápido'}
                        {a.anomaly_type === 'unusual_hour' && '🕐 Horario inusual'}
                      </p>
                      {a.details && Object.keys(a.details).length > 0 && (
                        <p className="text-[10px] text-[#a39e97] mt-0.5">
                          {JSON.stringify(a.details).slice(0, 120)}
                        </p>
                      )}
                    </div>
                    <p className="text-[10px] text-[#a39e97]">
                      {format(new Date(a.created_at), "d MMM yyyy, HH:mm", { locale: es })}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        </FadeIn>
      )}

      {/* --- CORRECTIONS TAB --- */}
      {activeTab === 'corrections' && (
        <FadeIn>
          <div className="space-y-2.5">
            {corrections.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <CheckCircle className="size-10 text-[#006d5a]/30" />
                <p className="text-sm font-medium text-[#3d2c24]">Sin correcciones pendientes</p>
              </div>
            ) : (
              corrections.map(c => (
                <div key={c.id} className="card-elevated rounded-xl px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#3d2c24]">
                        {c.employee?.first_name} {c.employee?.last_name}
                      </p>
                      <RoleBadge role={c.employee?.role} />
                      <p className="mt-1 text-xs text-[#a39e97] capitalize">
                        {c.correction_type === 'add_missing' ? 'Agregar evento faltante' :
                         c.correction_type === 'change_time' ? 'Cambiar horario' :
                         'Eliminar evento'}
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => handleCorrection(c.id, 'approve')}
                        className="flex size-8 items-center justify-center rounded-lg bg-[#e8f5f1] text-[#006d5a] hover:bg-[#d0ede5]">
                        <Check className="size-4" />
                      </button>
                      <button onClick={() => handleCorrection(c.id, 'reject')}
                        className="flex size-8 items-center justify-center rounded-lg bg-red-50 text-[#ea504c] hover:bg-red-100">
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#f7f3ee] px-3 py-2">
                    <p className="text-xs text-[#3d2c24]">{c.reason}</p>
                    {c.new_value?.timestamp && (
                      <p className="text-[10px] text-[#a39e97] mt-0.5">
                        Nuevo timestamp: {format(new Date(c.new_value.timestamp as string), 'dd/MM/yyyy HH:mm')}
                      </p>
                    )}
                  </div>
                  <p className="text-[10px] text-[#a39e97]">
                    Solicitado: {format(new Date(c.created_at), "d MMM yyyy, HH:mm", { locale: es })}
                  </p>
                </div>
              ))
            )}
          </div>
        </FadeIn>
      )}

      {/* --- DEVICES TAB --- */}
      {activeTab === 'devices' && (
        <FadeIn>
          <div className="space-y-2.5">
            <p className="section-label px-1">Dispositivos registrados — Aprobá los nuevos dispositivos de empleados</p>
            {devices.length === 0 ? (
              <div className="py-8 text-center text-sm text-[#a39e97]">Sin dispositivos registrados</div>
            ) : (
              devices.map(d => (
                <div key={d.id} className="card-elevated flex items-center gap-3 rounded-xl px-4 py-3">
                  <Smartphone className={cn('size-5 shrink-0', d.is_active ? 'text-[#006d5a]' : 'text-[#a39e97]')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#3d2c24]">
                      {d.profiles?.first_name} {d.profiles?.last_name}
                      {d.profiles?.role && <RoleBadge role={d.profiles.role} />}
                    </p>
                    <p className="text-[10px] text-[#a39e97] truncate">
                      {d.device_name ?? 'Dispositivo sin nombre'}
                    </p>
                    <p className="text-[10px] text-[#a39e97]/70 truncate">
                      FP: {d.device_fingerprint.slice(0, 12)}… · {format(new Date(d.registered_at), 'd MMM HH:mm', { locale: es })}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <span className={cn('text-[10px] font-medium', d.is_active ? 'text-[#006d5a]' : 'text-[#a39e97]')}>
                      {d.is_active ? 'Aprobado' : 'Pendiente'}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => toggleDevice(d.id, !d.is_active)}
                      className={cn('h-7 px-2 text-[10px]', d.is_active ? 'text-[#ea504c]' : 'text-[#006d5a]')}>
                      {d.is_active ? 'Revocar' : 'Aprobar'}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </FadeIn>
      )}

      {/* --- CONFIG TAB --- */}
      {activeTab === 'config' && (
        <FadeIn>
          <div className="space-y-4">
            {/* GPS Config */}
            <div className="card-elevated rounded-xl px-4 py-4 space-y-3">
              <div className="flex items-center gap-2">
                <Settings className="size-4 text-[#a39e97]" />
                <h3 className="text-sm font-semibold text-[#3d2c24]">GPS y horarios</h3>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="section-label">Radio GPS (metros)</label>
                  <input type="number" value={configForm.radius} onChange={e => setConfigForm(f => ({ ...f, radius: +e.target.value }))}
                    disabled={!editingConfig}
                    className="mt-1 w-full rounded-lg border border-[#ebe6df] bg-[#fefcf9] px-3 py-2 text-sm disabled:opacity-60" />
                </div>
                <div>
                  <label className="section-label">Límite horas diarias</label>
                  <input type="number" value={configForm.daily_limit} onChange={e => setConfigForm(f => ({ ...f, daily_limit: +e.target.value }))}
                    disabled={!editingConfig}
                    className="mt-1 w-full rounded-lg border border-[#ebe6df] bg-[#fefcf9] px-3 py-2 text-sm disabled:opacity-60" />
                </div>
                <div>
                  <label className="section-label">Horario inusual antes de</label>
                  <input type="time" value={configForm.unusual_before} onChange={e => setConfigForm(f => ({ ...f, unusual_before: e.target.value }))}
                    disabled={!editingConfig}
                    className="mt-1 w-full rounded-lg border border-[#ebe6df] bg-[#fefcf9] px-3 py-2 text-sm disabled:opacity-60" />
                </div>
                <div>
                  <label className="section-label">Horario inusual después de</label>
                  <input type="time" value={configForm.unusual_after} onChange={e => setConfigForm(f => ({ ...f, unusual_after: e.target.value }))}
                    disabled={!editingConfig}
                    className="mt-1 w-full rounded-lg border border-[#ebe6df] bg-[#fefcf9] px-3 py-2 text-sm disabled:opacity-60" />
                </div>
              </div>

              <div className="space-y-2">
                <p className="section-label">Validaciones activas</p>
                {[
                  { key: 'gps_check' as const, label: 'GPS / Ubicación' },
                  { key: 'wifi_check' as const, label: 'Red WiFi' },
                  { key: 'device_check' as const, label: 'Dispositivo' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox" checked={configForm[key]} disabled={!editingConfig}
                      onChange={e => setConfigForm(f => ({ ...f, [key]: e.target.checked }))}
                      className="rounded accent-[#006d5a]"
                    />
                    <span className="text-sm text-[#3d2c24]">{label}</span>
                  </label>
                ))}
              </div>

              <div className="flex gap-2 pt-1">
                {editingConfig ? (
                  <>
                    <Button onClick={saveConfig} className="bg-[#006d5a] text-white text-xs h-8 px-4">
                      Guardar
                    </Button>
                    <Button variant="outline" onClick={() => setEditingConfig(false)} className="text-xs h-8 px-4">
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setEditingConfig(true)} className="text-xs h-8 px-4">
                    Editar configuración
                  </Button>
                )}
              </div>
            </div>

            {/* WiFi APs */}
            <div className="card-elevated rounded-xl px-4 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wifi className="size-4 text-[#a39e97]" />
                  <h3 className="text-sm font-semibold text-[#3d2c24]">Puntos de acceso WiFi válidos</h3>
                </div>
                <Button variant="outline" size="sm" onClick={() => setAddingAP(!addingAP)} className="h-7 text-xs px-3">
                  {addingAP ? 'Cancelar' : '+ Agregar'}
                </Button>
              </div>

              {addingAP && (
                <div className="space-y-2 rounded-lg bg-[#f7f3ee] p-3">
                  <input placeholder="Nombre del AP *" value={newAP.name} onChange={e => setNewAP(n => ({ ...n, name: e.target.value }))}
                    className="w-full rounded-lg border border-[#ebe6df] bg-white px-3 py-2 text-xs" />
                  <input placeholder="SSID (nombre de red)" value={newAP.ssid} onChange={e => setNewAP(n => ({ ...n, ssid: e.target.value }))}
                    className="w-full rounded-lg border border-[#ebe6df] bg-white px-3 py-2 text-xs" />
                  <input placeholder="BSSID (MAC del router, opcional)" value={newAP.bssid} onChange={e => setNewAP(n => ({ ...n, bssid: e.target.value }))}
                    className="w-full rounded-lg border border-[#ebe6df] bg-white px-3 py-2 text-xs" />
                  <Button onClick={addWifiAP} className="w-full bg-[#006d5a] text-white text-xs h-8">
                    Guardar AP
                  </Button>
                </div>
              )}

              {wifiAPs.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg bg-[#fdf6ec] px-3 py-2">
                  <WifiOff className="size-4 text-[#d4943a]" />
                  <p className="text-xs text-[#d4943a]">Sin APs registrados — la validación WiFi no es efectiva</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {wifiAPs.map(ap => (
                    <div key={ap.id} className="flex items-center gap-2 rounded-lg bg-[#f7f3ee] px-3 py-2">
                      <Wifi className="size-3.5 text-[#006d5a] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[#3d2c24]">{ap.name}</p>
                        {ap.ssid && <p className="text-[10px] text-[#a39e97]">SSID: {ap.ssid}</p>}
                        {ap.bssid && <p className="text-[10px] text-[#a39e97]">BSSID: {ap.bssid}</p>}
                      </div>
                      <ChevronRight className="size-3 text-[#a39e97] shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  )
}
