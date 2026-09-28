'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow, isPast, differenceInDays } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ArrowLeft, User, Calendar, Clock, Send, ArrowRightLeft,
  UserPlus, X, AlertTriangle, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { ExpedienteStatusBadge } from '@/components/expedientes/ExpedienteStatusBadge'
import { ExpedienteTypeBadge } from '@/components/expedientes/ExpedienteTypeBadge'
import { ExpedienteAreaTags } from '@/components/expedientes/ExpedienteAreaTags'
import { ExpedienteTimeline } from '@/components/expedientes/ExpedienteTimeline'
import { StatusTransitionDialog } from '@/components/expedientes/StatusTransitionDialog'
import { TasksSection } from '@/components/expedientes/TasksSection'
import { LoadingState } from '@/components/ui/LoadingState'
import { EXPEDIENTE_URGENCIES } from '@/lib/constants/expedientes'
import { ROLES } from '@/lib/constants'
import { FadeIn } from '@/components/ui/motion'
import type { AppRole } from '@/types/database'
import type { ExpedienteWithPeople, CommentWithAuthor } from '@/types/expedientes'

// ---------------------------------------------------------------------------
// Team member type
// ---------------------------------------------------------------------------
type TeamMember = { id: string; first_name: string; last_name: string; role: string }

// ---------------------------------------------------------------------------
// Assign dialog component
// ---------------------------------------------------------------------------
function AssignDialog({
  open,
  onClose,
  onAssign,
  teamMembers,
  loadingTeam,
  currentResponsibleId,
}: {
  open: boolean
  onClose: () => void
  onAssign: (userId: string) => void
  teamMembers: TeamMember[]
  loadingTeam: boolean
  currentResponsibleId: string | null
}) {
  const [assigning, setAssigning] = useState<string | null>(null)

  if (!open) return null

  const handleAssign = async (userId: string) => {
    setAssigning(userId)
    await onAssign(userId)
    setAssigning(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 mx-3 mb-[calc(0.5rem+env(safe-area-inset-bottom))] w-full max-w-md max-h-[85vh] rounded-2xl bg-card shadow-xl flex flex-col sm:mx-auto sm:mb-0">
        <div className="flex items-center justify-between p-5 pb-3">
          <h3 className="text-base font-semibold">Asignar Responsable</h3>
          <button onClick={onClose} className="icon-btn flex items-center justify-center rounded-full hover:bg-muted" aria-label="Cerrar">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {loadingTeam ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Cargando equipo...</p>
          ) : teamMembers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No hay miembros disponibles</p>
          ) : (
            <div className="space-y-1.5">
              {teamMembers.map((member) => {
                const isCurrent = member.id === currentResponsibleId
                const isAssigning = assigning === member.id
                const roleConfig = ROLES[member.role as AppRole]
                return (
                  <button
                    key={member.id}
                    disabled={isCurrent || isAssigning}
                    onClick={() => handleAssign(member.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${
                      isCurrent
                        ? 'border-[#006d5a] bg-[#e8f5f1] opacity-60'
                        : 'border-border hover:bg-muted'
                    } disabled:cursor-not-allowed`}
                  >
                    <div
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: roleConfig?.color ?? '#a39e97' }}
                    >
                      {(member.first_name?.[0] ?? '?')}{(member.last_name?.[0] ?? '')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">
                        {member.first_name} {member.last_name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {roleConfig?.emoji} {roleConfig?.label ?? member.role}
                      </p>
                    </div>
                    {isCurrent && (
                      <span className="text-[10px] font-semibold text-[#006d5a]">Actual</span>
                    )}
                    {isAssigning && (
                      <span className="text-[10px] text-muted-foreground">Asignando...</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function ExpedienteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { profile } = useProfileContext()

  const [expediente, setExpediente] = useState<ExpedienteWithPeople | null>(null)
  const [comments, setComments] = useState<CommentWithAuthor[]>([])
  const [loading, setLoading] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [sendingComment, setSendingComment] = useState(false)
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loadingTeam, setLoadingTeam] = useState(false)

  // ---- Fetch data ----
  const fetchData = useCallback(async () => {
    try {
      const [expRes, commentsRes] = await Promise.all([
        fetch(`/api/expedientes/${id}`),
        fetch(`/api/expedientes/${id}/comments`),
      ])
      const expJson = await expRes.json()
      const commentsJson = await commentsRes.json()
      setExpediente(expJson.data ?? null)
      setComments(commentsJson.data ?? [])
    } catch {
      toast.error('Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  // ---- Fetch team (lazy, only when dialog opens) ----
  const openAssignDialog = useCallback(async () => {
    setAssignDialogOpen(true)
    if (teamMembers.length > 0) return // already loaded
    setLoadingTeam(true)
    try {
      const res = await fetch('/api/expedientes/team')
      const json = await res.json()
      setTeamMembers(json.data ?? [])
    } catch {
      toast.error('Error al cargar equipo')
    } finally {
      setLoadingTeam(false)
    }
  }, [teamMembers.length])

  // ---- Optimistic comment ----
  const handleSendComment = useCallback(async () => {
    if (!commentText.trim() || sendingComment) return
    const text = commentText.trim()
    setSendingComment(true)
    setCommentText('')

    // Optimistic: add comment immediately
    const optimisticComment: CommentWithAuthor = {
      id: `temp-${Date.now()}`,
      expediente_id: id,
      author_id: profile?.id ?? '',
      type: 'comment',
      body: text,
      metadata: {},
      created_at: new Date().toISOString(),
      author: profile ? { first_name: profile.first_name, last_name: profile.last_name, role: profile.role } : null,
    }
    setComments((prev) => [...prev, optimisticComment])

    try {
      const res = await fetch(`/api/expedientes/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      if (!res.ok) throw new Error('Error')
      // Refresh to get real IDs
      const commentsRes = await fetch(`/api/expedientes/${id}/comments`)
      const json = await commentsRes.json()
      setComments(json.data ?? [])
    } catch {
      // Remove optimistic comment on error
      setComments((prev) => prev.filter((c) => c.id !== optimisticComment.id))
      setCommentText(text)
      toast.error('Error al enviar comentario')
    } finally {
      setSendingComment(false)
    }
  }, [commentText, sendingComment, id, profile])

  // ---- Assign ----
  const handleAssign = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`/api/expedientes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responsible_id: userId }),
      })
      if (!res.ok) throw new Error('Error')
      toast.success('Responsable asignado')
      setAssignDialogOpen(false)
      fetchData()
    } catch {
      toast.error('Error al asignar')
    }
  }, [id, fetchData])

  // ---- Delete draft ----
  const handleDelete = useCallback(async () => {
    if (!confirm('¿Estás seguro de eliminar este borrador? No se puede deshacer.')) return
    try {
      const res = await fetch(`/api/expedientes/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Error')
      }
      toast.success('Borrador eliminado')
      router.push('/expedientes')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    }
  }, [id, router])

  // ---- Derived state ----
  const isSocioOrEncargado = profile?.role === 'socio' || profile?.role === 'encargado'
  const isAuthor = profile?.id === expediente?.author_id
  const isClosed = expediente ? ['cumplido', 'cerrado_sin_implementacion', 'archivado'].includes(expediente.status) : false

  // Overdue detection — ignore paused/pending statuses
  const pausedStatuses = ['pausado', 'pendiente_tercero', 'pendiente_decision']
  const isPaused = expediente ? pausedStatuses.includes(expediente.status) : false

  const isOverdue = useMemo(() => {
    if (!expediente?.target_date || isClosed || isPaused) return false
    return isPast(new Date(expediente.target_date))
  }, [expediente?.target_date, isClosed, isPaused])

  const daysOverdue = useMemo(() => {
    if (!isOverdue || !expediente?.target_date) return 0
    return differenceInDays(new Date(), new Date(expediente.target_date))
  }, [isOverdue, expediente?.target_date])

  if (loading) return <LoadingState />
  if (!expediente) {
    return (
      <div className="flex flex-col items-center justify-center px-5 pt-20">
        <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-secondary">
          <AlertTriangle className="size-7 text-muted-foreground" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-semibold text-foreground">Expediente no encontrado</p>
        <p className="mt-1 text-xs text-muted-foreground">Puede haber sido eliminado o no tenés acceso</p>
        <Link href="/expedientes" className="mt-4 text-sm font-semibold text-[#006d5a] underline">
          ← Volver a Expedientes
        </Link>
      </div>
    )
  }

  const urgencyConfig = EXPEDIENTE_URGENCIES[expediente.urgency]
  const authorName = expediente.author
    ? `${expediente.author.first_name} ${expediente.author.last_name}`
    : 'Desconocido'
  const responsibleName = expediente.responsible
    ? `${expediente.responsible.first_name} ${expediente.responsible.last_name}`
    : null
  const timeAgo = formatDistanceToNow(new Date(expediente.created_at), { addSuffix: true, locale: es })

  return (
    <FadeIn className={isClosed ? 'pb-8' : 'pb-28'}>
      {/* Header sticky — compact with status + urgency */}
      <div className="sticky top-0 z-20 border-b bg-card px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <Link
            href="/expedientes"
            className="icon-btn flex items-center justify-center rounded-xl bg-secondary text-secondary-foreground"
            aria-label="Volver a expedientes"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] font-bold text-muted-foreground">
                {expediente.code}
              </span>
              <ExpedienteStatusBadge status={expediente.status} />
            </div>
            <h1 className="text-[15px] font-semibold text-foreground line-clamp-1 mt-0.5">
              {expediente.title}
            </h1>
          </div>
          {/* Urgency pill */}
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold"
            style={{ color: urgencyConfig?.color, backgroundColor: urgencyConfig?.bg }}
          >
            {urgencyConfig?.label}
          </span>
        </div>
      </div>

      <div className="px-5 pt-4 space-y-5">
        {/* Overdue warning */}
        {isOverdue && (
          <div className="flex items-center gap-2 rounded-xl border border-[#ea504c]/30 bg-[#fef2f2] px-3 py-2">
            <AlertTriangle className="size-4 text-[#ea504c]" />
            <p className="text-xs font-semibold text-[#ea504c]">
              Vencido hace {daysOverdue} día{daysOverdue !== 1 ? 's' : ''}
            </p>
          </div>
        )}

        {/* Quick facts — compact row */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ExpedienteTypeBadge type={expediente.type} />
          {expediente.areas.length > 0 && <ExpedienteAreaTags areas={expediente.areas} />}
          <span className="flex items-center gap-1"><User className="size-3" />{authorName}</span>
          {responsibleName && <span className="flex items-center gap-1"><UserPlus className="size-3" /><strong className="text-foreground">{responsibleName}</strong></span>}
          <span className="flex items-center gap-1"><Clock className="size-3" />{timeAgo}</span>
          {expediente.target_date && (
            <span className={`flex items-center gap-1 ${isOverdue ? 'text-[#ea504c] font-semibold' : ''}`}>
              <Calendar className="size-3" />
              {new Date(expediente.target_date).toLocaleDateString('es-AR')}
            </span>
          )}
        </div>

        {/* Actions — immediately visible for decision makers */}
        {!isClosed && (isSocioOrEncargado || isAuthor) && (
          <div className="flex gap-2">
            <button
              onClick={() => setStatusDialogOpen(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#006d5a] h-10 text-xs font-semibold text-[#006d5a] transition-colors hover:bg-[#e8f5f1]"
            >
              <ArrowRightLeft className="size-3.5" />
              Estado
            </button>
            {isSocioOrEncargado && (
              <button
                onClick={openAssignDialog}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] h-10 text-xs font-semibold text-white transition-colors hover:bg-[#005a4a]"
              >
                <UserPlus className="size-3.5" />
                Asignar
              </button>
            )}
            {expediente.status === 'borrador' && (isAuthor || isSocioOrEncargado) && (
              <button
                onClick={handleDelete}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-[#ea504c]/30 h-10 px-3 text-xs font-medium text-[#ea504c] transition-colors hover:bg-[#fef2f2]"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Description + Reason — collapsible detail */}
        {(expediente.description || expediente.reason || expediente.close_reason) && (
          <div className="rounded-xl border bg-card p-4 space-y-3">
            {expediente.description && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Descripción</p>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{expediente.description}</p>
              </div>
            )}
            {expediente.reason && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Fundamento</p>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{expediente.reason}</p>
              </div>
            )}
            {expediente.close_reason && (
              <div className="rounded-lg bg-muted p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Motivo de cierre</p>
                <p className="text-sm text-foreground">{expediente.close_reason}</p>
              </div>
            )}
          </div>
        )}

        {/* Tasks */}
        <TasksSection
          expedienteId={expediente.id}
          currentUserId={profile?.id ?? ''}
          isSocio={profile?.role === 'socio'}
          canManage={isSocioOrEncargado}
          isClosed={isClosed}
        />

        {/* Timeline */}
        <div>
          <h2 className="section-label mb-2">
            Historial ({comments.length})
          </h2>
          <ExpedienteTimeline comments={comments} />
        </div>
      </div>

      {/* Comment input — sticky bottom */}
      {!isClosed && (
        <div className="fixed bottom-[4.5rem] left-0 right-0 z-20 border-t bg-card px-4 py-3">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="exp-comment">Comentario</label>
            <input
              id="exp-comment"
              type="text"
              placeholder="Escribir comentario..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendComment()}
              className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
            />
            <button
              disabled={!commentText.trim() || sendingComment}
              onClick={handleSendComment}
              aria-label="Enviar comentario"
              className="flex size-10 items-center justify-center rounded-xl bg-[#006d5a] text-white transition-colors hover:bg-[#005a4a] disabled:opacity-50"
            >
              <Send className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <StatusTransitionDialog
        expedienteId={expediente.id}
        currentStatus={expediente.status}
        userRole={(profile?.role ?? 'runner') as AppRole}
        isAuthor={isAuthor}
        isResponsible={profile?.id === expediente.responsible_id}
        open={statusDialogOpen}
        onClose={() => setStatusDialogOpen(false)}
        onSuccess={fetchData}
      />

      <AssignDialog
        open={assignDialogOpen}
        onClose={() => setAssignDialogOpen(false)}
        onAssign={handleAssign}
        teamMembers={teamMembers}
        loadingTeam={loadingTeam}
        currentResponsibleId={expediente.responsible_id}
      />
    </FadeIn>
  )
}
