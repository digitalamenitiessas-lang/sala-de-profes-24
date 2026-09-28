'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Loader2, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import type { AppRole } from '@/types/database'
import { ROLES } from '@/lib/constants'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmployeeData = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  role: AppRole
  avatar_url: string | null
  is_active: boolean
  cuit: string | null
  address: string | null
  dni: string | null
  birth_date: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
}

const ALL_ROLES: AppRole[] = ['socio', 'encargado', 'chef', 'barista', 'runner', 'cocina', 'bacha']

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EmpleadoFichaPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { profile: myProfile, loading: profileLoading } = useProfileContext()

  const [employee, setEmployee] = useState<EmployeeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form state — mirrors EmployeeData fields that are editable
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<AppRole>('runner')
  const [isActive, setIsActive] = useState(true)
  const [cuit, setCuit] = useState('')
  const [dni, setDni] = useState('')
  const [address, setAddress] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')

  // Load employee
  useEffect(() => {
    if (!id) return
    async function load() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, first_name, last_name, phone, role, avatar_url, is_active, cuit, address, dni, birth_date, emergency_contact_name, emergency_contact_phone',
        )
        .eq('id', id)
        .single()

      if (error || !data) {
        toast.error('No se pudo cargar el empleado')
        setLoading(false)
        return
      }

      setEmployee(data as EmployeeData)
      setFirstName(data.first_name ?? '')
      setLastName(data.last_name ?? '')
      setPhone(data.phone ?? '')
      setRole(data.role as AppRole)
      setIsActive(data.is_active)
      setCuit(data.cuit ?? '')
      setDni(data.dni ?? '')
      setAddress(data.address ?? '')
      setBirthDate(data.birth_date ?? '')
      setEmergencyName(data.emergency_contact_name ?? '')
      setEmergencyPhone(data.emergency_contact_phone ?? '')
      setLoading(false)
    }
    load()
  }, [id])

  const handleSave = async () => {
    if (!employee) return
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim() || null,
        role,
        is_active: isActive,
        cuit: cuit.trim() || null,
        address: address.trim() || null,
        dni: dni.trim() || null,
        birth_date: birthDate || null,
        emergency_contact_name: emergencyName.trim() || null,
        emergency_contact_phone: emergencyPhone.trim() || null,
      })
      .eq('id', employee.id)

    setSaving(false)
    if (error) {
      toast.error('Error al guardar: ' + error.message)
    } else {
      toast.success('Ficha guardada')
    }
  }

  // Auth guard
  if (!profileLoading && !isManagerOrAbove(myProfile?.role)) {
    return (
      <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
        <ShieldAlert className="size-10 text-[#d4943a]" />
        <p className="text-sm font-medium text-[#3d2c24]">
          Solo encargados y socios pueden ver las fichas del personal.
        </p>
        <button
          onClick={() => router.back()}
          className="text-xs text-[#006d5a] underline underline-offset-2"
        >
          Volver
        </button>
      </div>
    )
  }

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-[#006d5a]" />
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-sm text-[#a39e97]">Empleado no encontrado.</p>
        <Link href="/equipo" className="mt-4 inline-block text-xs text-[#006d5a] underline underline-offset-2">
          Volver al equipo
        </Link>
      </div>
    )
  }

  const roleColor = ROLES[employee.role]?.color ?? '#a39e97'

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/equipo"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-[#ebe6df] transition hover:ring-[#006d5a]/30"
        >
          <ChevronLeft className="size-5 text-[#3d2c24]" />
        </Link>
        <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Ficha de empleado</h1>
      </div>

      {/* Identity card */}
      <div className="rounded-2xl bg-white px-5 py-5 shadow-sm ring-1 ring-[#ebe6df]">
        <div className="flex items-center gap-4">
          <div
            className="flex size-14 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: roleColor }}
          >
            {getInitials(firstName || employee.first_name, lastName || employee.last_name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-[#3d2c24]">
              {firstName || employee.first_name} {lastName || employee.last_name}
            </p>
            <p className="text-xs text-[#a39e97] capitalize">{role}</p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              isActive
                ? 'bg-[#f0f7f5] text-[#006d5a]'
                : 'bg-[#f3efe9] text-[#a39e97]'
            }`}
          >
            {isActive ? 'Activo' : 'Inactivo'}
          </span>
        </div>
      </div>

      {/* Basic info */}
      <div className="rounded-2xl bg-white px-5 py-5 shadow-sm ring-1 ring-[#ebe6df] space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[#a39e97]">Datos básicos</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#7d6c64]">Nombre</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#7d6c64]">Apellido</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-[#7d6c64]">Teléfono</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Ej: +54 9 11 1234-5678"
            className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#7d6c64]">Rol</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]"
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end space-y-1">
            <label className="text-xs font-medium text-[#7d6c64]">Estado</label>
            <button
              onClick={() => setIsActive((v) => !v)}
              className={`w-full rounded-xl border px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? 'border-[#006d5a]/30 bg-[#f0f7f5] text-[#006d5a]'
                  : 'border-[#ebe6df] bg-[#faf8f5] text-[#a39e97]'
              }`}
            >
              {isActive ? 'Activo' : 'Inactivo'}
            </button>
          </div>
        </div>
      </div>

      {/* Personal data */}
      <div className="rounded-2xl bg-white px-5 py-5 shadow-sm ring-1 ring-[#ebe6df] space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[#a39e97]">Datos personales</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#7d6c64]">DNI</label>
            <input
              type="text"
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              placeholder="Ej: 30.123.456"
              className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#7d6c64]">CUIT</label>
            <input
              type="text"
              value={cuit}
              onChange={(e) => setCuit(e.target.value)}
              placeholder="Ej: 20-30123456-3"
              className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-[#7d6c64]">Domicilio</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Calle, número, ciudad"
            className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-[#7d6c64]">Fecha de nacimiento</label>
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]"
          />
        </div>
      </div>

      {/* Emergency contact */}
      <div className="rounded-2xl bg-white px-5 py-5 shadow-sm ring-1 ring-[#ebe6df] space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[#a39e97]">Contacto de emergencia</h2>

        <div className="space-y-1">
          <label className="text-xs font-medium text-[#7d6c64]">Nombre</label>
          <input
            type="text"
            value={emergencyName}
            onChange={(e) => setEmergencyName(e.target.value)}
            placeholder="Nombre y apellido"
            className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-[#7d6c64]">Teléfono</label>
          <input
            type="tel"
            value={emergencyPhone}
            onChange={(e) => setEmergencyPhone(e.target.value)}
            placeholder="+54 9 11 1234-5678"
            className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]"
          />
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#006d5a] px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#005a4a] disabled:opacity-60"
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        {saving ? 'Guardando…' : 'Guardar ficha'}
      </button>
    </div>
  )
}
