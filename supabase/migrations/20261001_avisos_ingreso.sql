-- Avisos de "marcá tu entrada": se guarda en el turno cuándo se avisó, para
-- avisar una sola vez a la persona y una sola vez al encargado.
alter table public.shifts add column if not exists aviso_ingreso_at timestamptz;
alter table public.shifts add column if not exists aviso_encargado_at timestamptz;
comment on column public.shifts.aviso_ingreso_at is 'Cuándo se le avisó a la persona que marque la entrada (null = no hizo falta)';
comment on column public.shifts.aviso_encargado_at is 'Cuándo se le avisó al encargado que la persona no fichó';
