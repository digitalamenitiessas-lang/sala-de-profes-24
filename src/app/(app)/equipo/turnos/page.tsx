'use client'

import { useEffect, useState, useCallback } from 'react'
import { isManagerOrAbove } from '@/lib/roles'
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval } from 'date-fns'
import { es } from 'date-fns/locale/es'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Plus, Loader2, ShieldAlert, Upload, CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import { errorToast } from '@/lib/toast-helpers'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import type { AppRole, ShiftInsert } from '@/types/database'
import { logAuditClient } from '@/lib/audit'
import type { ShiftCardData } from '@/components/shifts/ShiftCard'

import { ShiftDialog } from './_components/ShiftDialog'
import { DeleteShiftDialog } from './_components/DeleteShiftDialog'
import { PreviewDialog, ReplaceConfirmDialog, UploadResultBanner } from './_components/ExcelDialogs'
import { WeekGrid } from './_components/WeekGrid'

type ShiftWithProfile = ShiftCardData & { created_by: string }
type EmployeeOption = { id: string; first_name: string; last_name: string; role: AppRole }

export default function EquipoTurnosPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [supabase] = useState(() => createClient())

  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  )
  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 })
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: weekEnd })
  const weekLabel = `${format(currentWeekStart, "d 'de' MMM", { locale: es })} - ${format(weekEnd, "d 'de' MMM, yyyy", { locale: es })}`

  const [shifts, setShifts] = useState<ShiftWithProfile[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)

  // Shift create/edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingShift, setEditingShift] = useState<ShiftWithProfile | null>(null)
  const [saving, setSaving] = useState(false)
  const [formUserId, setFormUserId] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formStartTime, setFormStartTime] = useState('')
  const [formEndTime, setFormEndTime] = useState('')
  const [formRole, setFormRole] = useState<AppRole>('runner')
  const [formNotes, setFormNotes] = useState('')

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingShift, setDeletingShift] = useState<ShiftWithProfile | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Excel upload
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{
    created: number; skipped: number; errors: number
    details: { created: string[]; skipped: string[]; errors: string[] }
  } | null>(null)
  const [showUploadResult, setShowUploadResult] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [previewData, setPreviewData] = useState<{ name: string; shifts: { day: string; time: string }[] }[] | null>(null)
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false)
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false)
  const [existingCount, setExistingCount] = useState(0)
  const [pendingReplace, setPendingReplace] = useState(false)

  const isEncargado = isManagerOrAbove(profile?.role)

  const fetchShifts = useCallback(async () => {
    setLoading(true)
    try {
      const fromDate = format(currentWeekStart, 'yyyy-MM-dd')
      const toDate = format(endOfWeek(currentWeekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase
        .from('shifts')
        .select('id, user_id, shift_date, start_time, end_time, shift_role, notes, created_by, profiles!shifts_user_id_fkey(first_name, last_name)')
        .gte('shift_date', fromDate)
        .lte('shift_date', toDate)
        .order('start_time', { ascending: true })

      if (error) throw error

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: ShiftWithProfile[] = (data ?? []).map((s: any) => ({
        id: s.id,
        user_id: s.user_id,
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        shift_role: s.shift_role,
        notes: s.notes,
        created_by: s.created_by,
        profile: s.profiles ? { first_name: s.profiles.first_name, last_name: s.profiles.last_name } : null,
      }))
      setShifts(mapped)
    } catch (err) {
      console.error('Error al cargar turnos:', err)
      errorToast('No pudimos cargar los turnos de la semana', err)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWeekStart, supabase])

  useEffect(() => {
    if (!isEncargado) return
    supabase.from('profiles').select('id, first_name, last_name, role').eq('is_active', true).order('first_name')
      .then(({ data, error }) => {
        if (!error) setEmployees(data ?? [])
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEncargado])

  useEffect(() => {
    if (isEncargado) fetchShifts()
  }, [isEncargado, fetchShifts])

  // Shift dialog helpers
  function openCreateDialog() {
    setEditingShift(null)
    setFormUserId('')
    setFormDate(format(new Date(), 'yyyy-MM-dd'))
    setFormStartTime('08:00')
    setFormEndTime('16:00')
    setFormRole('runner')
    setFormNotes('')
    setDialogOpen(true)
  }

  function openEditDialog(shift: ShiftWithProfile) {
    setEditingShift(shift)
    setFormUserId(shift.user_id)
    setFormDate(shift.shift_date)
    setFormStartTime(shift.start_time.slice(0, 5))
    setFormEndTime(shift.end_time.slice(0, 5))
    setFormRole(shift.shift_role)
    setFormNotes(shift.notes ?? '')
    setDialogOpen(true)
  }

  function openCreateForSlot(userId: string, date: Date, role: AppRole) {
    setEditingShift(null)
    setFormUserId(userId)
    setFormDate(format(date, 'yyyy-MM-dd'))
    setFormStartTime('08:00')
    setFormEndTime('16:00')
    setFormRole(role)
    setFormNotes('')
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!profile) return
    if (!formUserId || !formDate || !formStartTime || !formEndTime) {
      toast.error('Completa todos los campos obligatorios')
      return
    }
    setSaving(true)
    try {
      if (editingShift) {
        const { error } = await supabase.from('shifts').update({
          user_id: formUserId, shift_date: formDate, start_time: formStartTime,
          end_time: formEndTime, shift_role: formRole, notes: formNotes || null,
        }).eq('id', editingShift.id)
        if (error) throw error
        const emp = employees.find(e => e.id === formUserId)
        toast.success('Turno actualizado correctamente')
        logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'update_shift', module: 'turnos', entityType: 'shift', description: `Admin editó turno de: ${emp?.first_name ?? formUserId}` })
      } else {
        const insertData: ShiftInsert = {
          user_id: formUserId, shift_date: formDate, start_time: formStartTime,
          end_time: formEndTime, shift_role: formRole, notes: formNotes || null, created_by: profile.id,
        }
        const { error } = await supabase.from('shifts').insert(insertData)
        if (error) throw error
        const emp = employees.find(e => e.id === formUserId)
        toast.success('Turno creado correctamente')
        logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'create_shift', module: 'turnos', entityType: 'shift', description: `Admin creó turno para: ${emp?.first_name ?? formUserId}` })
      }
      setDialogOpen(false)
      await fetchShifts()
    } catch (err) {
      errorToast('No se pudo guardar el turno', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deletingShift) return
    setDeleting(true)
    try {
      const { error } = await supabase.from('shifts').delete().eq('id', deletingShift.id)
      if (error) throw error
      toast.success('Turno eliminado correctamente')
      logAuditClient({ userId: profile?.id ?? null, userName: profile?.first_name ?? null, action: 'delete_shift', module: 'turnos', entityType: 'shift', description: `Admin eliminó turno de: ${deletingShift.profile?.first_name ?? deletingShift.user_id}` })
      setDeleteDialogOpen(false)
      setDeletingShift(null)
      await fetchShifts()
    } catch (err) {
      errorToast('No se pudo eliminar el turno', err)
    } finally {
      setDeleting(false)
    }
  }

  // Excel upload flow
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setPendingFile(file)

    try {
      const XLSX = (await import('xlsx'))
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })
      const dayNames = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo']
      const preview: { name: string; shifts: { day: string; time: string }[] }[] = []
      let currentRole = ''
      for (const row of rows) {
        if (!row || row.length === 0) continue
        const first = String(row[0] ?? '').trim()
        if (!first) continue
        if (first === first.toUpperCase() && first.length > 2 && !String(row[1] ?? '').match(/\d/)) {
          currentRole = first; continue
        }
        const empShifts: { day: string; time: string }[] = []
        for (let i = 1; i <= 7 && i < row.length; i++) {
          const val = String(row[i] ?? '').trim()
          if (!val) continue
          empShifts.push({ day: dayNames[i - 1] ?? `Día ${i}`, time: val })
        }
        if (empShifts.length > 0) preview.push({ name: `${first}${currentRole ? ` (${currentRole.toLowerCase()})` : ''}`, shifts: empShifts })
      }
      setPreviewData(preview)
      setPreviewDialogOpen(true)
    } catch {
      await checkAndUpload(file, false)
    }
  }

  const checkAndUpload = async (file: File, replace: boolean) => {
    try {
      const checkForm = new FormData()
      checkForm.append('checkOnly', 'true')
      checkForm.append('weekStart', format(currentWeekStart, 'yyyy-MM-dd'))
      const checkRes = await fetch('/api/shifts/upload', { method: 'POST', body: checkForm })
      const checkData = await checkRes.json()
      if (checkData.exists && checkData.count > 0) {
        setExistingCount(checkData.count)
        setPendingReplace(replace)
        setReplaceDialogOpen(true)
        return
      }
    } catch { /* proceed */ }
    await doUpload(file, replace)
  }

  const doUpload = async (file: File, replace: boolean) => {
    setUploading(true)
    setReplaceDialogOpen(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('weekStart', format(currentWeekStart, 'yyyy-MM-dd'))
      if (replace) formData.append('replace', 'true')
      const res = await fetch('/api/shifts/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setUploadResult(data)
      setShowUploadResult(true)
      if (data.created > 0) {
        toast.success(`${data.created} turno${data.created > 1 ? 's' : ''} ${replace ? 'reemplazado' : 'creado'}${data.created > 1 ? 's' : ''}`)
        await fetchShifts()
      }
      if (data.skipped > 0 && !replace) toast.info(`${data.skipped} turno${data.skipped > 1 ? 's' : ''} ya existía${data.skipped > 1 ? 'n' : ''}`)
      if (data.errors > 0) toast.error(`${data.errors} fila${data.errors > 1 ? 's' : ''} con error`)
    } catch (err) {
      errorToast('No pudimos procesar el archivo Excel', err)
    } finally {
      setUploading(false)
      setPendingFile(null)
    }
  }

  const confirmPreviewUpload = async () => {
    setPreviewDialogOpen(false)
    if (!pendingFile) return
    await checkAndUpload(pendingFile, false)
  }

  if (profileLoading) return <LoadingState />

  if (!profile || !isEncargado) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#e8f5f1]">
            <ShieldAlert className="size-7 text-[#006d5a]" />
          </div>
          <h3 className="font-display text-base font-semibold text-[#3d2c24]">Sin permisos</h3>
          <p className="max-w-xs text-sm text-[#a39e97]">Solo los encargados pueden gestionar los turnos del equipo.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-28">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#3d2c24]">Turnos del Equipo</h1>
          <p className="section-label mt-2">Gestiona los horarios de todo tu equipo</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/equipo/turnos/cargar"
            className="flex items-center gap-1.5 rounded-xl bg-[#3d2c24] px-3 py-2 text-xs font-semibold text-white transition-transform active:scale-95"
          >
            <CalendarDays className="size-4" />
            <span className="hidden sm:inline">Cargar semana</span>
          </Link>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-xs font-semibold text-[#3d2c24] transition-colors hover:border-[#006d5a] hover:text-[#006d5a]">
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            <span className="hidden sm:inline">Excel</span>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} className="hidden" disabled={uploading} />
          </label>
          <button onClick={openCreateDialog} className="flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#005a4a]">
            <Plus className="size-4" />
            <span className="hidden sm:inline">Nuevo turno</span>
          </button>
        </div>
      </div>

      {showUploadResult && uploadResult && (
        <UploadResultBanner result={uploadResult} onClose={() => setShowUploadResult(false)} />
      )}

      {/* Week navigation */}
      <div className="card-elevated flex items-center justify-between rounded-xl px-3 py-3">
        <button onClick={() => setCurrentWeekStart(w => subWeeks(w, 1))} className="flex size-10 items-center justify-center rounded-xl text-[#a39e97] transition-colors hover:bg-[#f3efe9] hover:text-[#3d2c24]">
          <ChevronLeft className="size-5" />
        </button>
        <div className="flex items-center gap-3">
          <button onClick={() => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="rounded-xl border border-[#ebe6df] bg-transparent px-3 py-1.5 text-xs font-semibold text-[#a39e97] transition-colors hover:border-[#006d5a] hover:text-[#006d5a]">
            Hoy
          </button>
          <span className="text-sm font-semibold capitalize text-[#3d2c24]">{weekLabel}</span>
        </div>
        <button onClick={() => setCurrentWeekStart(w => addWeeks(w, 1))} className="flex size-10 items-center justify-center rounded-xl text-[#a39e97] transition-colors hover:bg-[#f3efe9] hover:text-[#3d2c24]">
          <ChevronRight className="size-5" />
        </button>
      </div>

      {loading ? (
        <LoadingState message="Cargando turnos..." />
      ) : (
        <WeekGrid
          weekDays={weekDays}
          employees={employees}
          shifts={shifts}
          onEditShift={openEditDialog}
          onDeleteShift={(shift) => { setDeletingShift(shift); setDeleteDialogOpen(true) }}
          onCreateForSlot={openCreateForSlot}
        />
      )}

      {/* FAB */}
      <button
        onClick={openCreateDialog}
        className="fixed bottom-24 right-5 z-40 flex size-14 items-center justify-center rounded-full bg-[#006d5a] text-white shadow-lg transition-transform hover:scale-105 active:scale-95 md:bottom-8 md:right-8"
        aria-label="Agregar turno"
      >
        <Plus className="size-6" />
      </button>

      <ShiftDialog
        open={dialogOpen}
        onClose={setDialogOpen}
        isEditing={!!editingShift}
        employees={employees}
        formUserId={formUserId} setFormUserId={setFormUserId}
        formDate={formDate} setFormDate={setFormDate}
        formStartTime={formStartTime} setFormStartTime={setFormStartTime}
        formEndTime={formEndTime} setFormEndTime={setFormEndTime}
        formRole={formRole} setFormRole={setFormRole}
        formNotes={formNotes} setFormNotes={setFormNotes}
        onSave={handleSave}
        saving={saving}
      />

      <DeleteShiftDialog
        open={deleteDialogOpen}
        onClose={setDeleteDialogOpen}
        shift={deletingShift}
        onConfirm={handleDelete}
        deleting={deleting}
      />

      <PreviewDialog
        open={previewDialogOpen}
        onClose={setPreviewDialogOpen}
        previewData={previewData}
        onConfirm={confirmPreviewUpload}
        onCancel={() => { setPreviewDialogOpen(false); setPendingFile(null); setPreviewData(null) }}
      />

      <ReplaceConfirmDialog
        open={replaceDialogOpen}
        onClose={setReplaceDialogOpen}
        existingCount={existingCount}
        onReplace={() => pendingFile && doUpload(pendingFile, true)}
        onAdd={() => pendingFile && doUpload(pendingFile, false)}
        onCancel={() => { setReplaceDialogOpen(false); setPendingFile(null) }}
      />
    </div>
  )
}
