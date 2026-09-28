-- ---------------------------------------------------------------------------
-- Los turnos son visibles para TODO el equipo (antes: solo los propios).
-- El horario semanal se comparte al grupo de WhatsApp completo — no es secreto,
-- y ver quién trabaja con vos es la mitad del valor de "Mis horarios".
-- Escritura sigue restringida a encargados.
-- ---------------------------------------------------------------------------

drop policy if exists "shifts_select" on public.shifts;
create policy "shifts_select" on public.shifts
  for select to authenticated using (true);
