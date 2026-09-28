// ---------------------------------------------------------------------------
// Expedientes — Sistema de gestión interna
// ---------------------------------------------------------------------------

export type ExpedienteType =
  | 'idea' | 'tarea' | 'proyecto' | 'incidencia' | 'mejora' | 'compra'
  | 'mantenimiento' | 'contenido' | 'desarrollo_gastronomico'
  | 'experiencia_cliente' | 'estetica' | 'gestion_terceros'

export type ExpedienteArea =
  | 'gastronomia' | 'barra' | 'salon' | 'branding' | 'marketing'
  | 'experiencia' | 'administracion' | 'mantenimiento' | 'eventos'
  | 'compras' | 'desarrollo'

export type ExpedienteStatus =
  | 'borrador' | 'presentado' | 'en_revision' | 'admitido' | 'asignado'
  | 'en_ejecucion' | 'pausado' | 'pendiente_tercero' | 'pendiente_decision'
  | 'revision_final' | 'cumplido' | 'cerrado_sin_implementacion' | 'archivado'

export type ExpedienteUrgency = 'baja' | 'media' | 'alta' | 'critica'

export type ExpedienteCommentType =
  | 'comment' | 'status_change' | 'assignment_change' | 'priority_change' | 'edit'

// ---------------------------------------------------------------------------
// Row types (match DB)
// ---------------------------------------------------------------------------

export type Expediente = {
  id: string
  code: string
  title: string
  description: string
  reason: string
  type: ExpedienteType
  areas: ExpedienteArea[]
  urgency: ExpedienteUrgency
  priority: number | null
  impact_categories: string[]
  status: ExpedienteStatus
  close_reason: string | null
  author_id: string
  responsible_id: string | null
  approver_id: string | null
  target_date: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

export type ExpedienteComment = {
  id: string
  expediente_id: string
  author_id: string
  type: ExpedienteCommentType
  body: string
  metadata: Record<string, unknown>
  created_at: string
}

// ---------------------------------------------------------------------------
// Joined types for UI
// ---------------------------------------------------------------------------

export type ProfileSnippet = {
  first_name: string
  last_name: string
  role: string
}

export type ExpedienteWithPeople = Expediente & {
  author: ProfileSnippet | null
  responsible: ProfileSnippet | null
  approver: ProfileSnippet | null
}

export type CommentWithAuthor = ExpedienteComment & {
  author: ProfileSnippet | null
}

// ---------------------------------------------------------------------------
// Tasks (subtareas dentro de expedientes)
// ---------------------------------------------------------------------------

export type ExpedienteTaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled'

export type ExpedienteTask = {
  id: string
  expediente_id: string
  title: string
  description: string | null
  assigned_to: string | null
  status: ExpedienteTaskStatus
  due_date: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export type TaskWithAssignee = ExpedienteTask & {
  assignee: ProfileSnippet | null
  creator: ProfileSnippet | null
}
