// Motivos por los que alguien con turno no fichó (tabla public.ausencias).
export const MOTIVOS_AUSENCIA = ['licencia', 'enfermedad', 'franco', 'cambio_turno', 'falto', 'otro'] as const
export type MotivoAusencia = (typeof MOTIVOS_AUSENCIA)[number]

export const ETIQUETA_AUSENCIA: Record<MotivoAusencia, string> = {
  licencia: 'Licencia',
  enfermedad: 'Enfermedad',
  franco: 'Franco',
  cambio_turno: 'Cambio de turno',
  falto: 'Faltó',
  otro: 'Otro',
}

export type Ausencia = { id: string; user_id: string; fecha: string; motivo: MotivoAusencia; nota: string | null }
