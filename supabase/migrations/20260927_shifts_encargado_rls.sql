-- ---------------------------------------------------------------------------
-- Asegurar que los encargados puedan gestionar turnos (INSERT / UPDATE / DELETE).
-- La tabla shifts puede no tener estas políticas si fue creada fuera de migraciones.
-- Se usan DROP IF EXISTS para que sea idempotente.
-- ---------------------------------------------------------------------------

-- INSERT: encargados y socios pueden crear turnos
DROP POLICY IF EXISTS "shifts_insert" ON public.shifts;
CREATE POLICY "shifts_insert" ON public.shifts
  FOR INSERT TO authenticated
  WITH CHECK (auth_role() IN ('encargado', 'socio'));

-- UPDATE: encargados y socios pueden modificar turnos
DROP POLICY IF EXISTS "shifts_update" ON public.shifts;
CREATE POLICY "shifts_update" ON public.shifts
  FOR UPDATE TO authenticated
  USING (auth_role() IN ('encargado', 'socio'))
  WITH CHECK (auth_role() IN ('encargado', 'socio'));

-- DELETE: encargados y socios pueden borrar turnos
DROP POLICY IF EXISTS "shifts_delete" ON public.shifts;
CREATE POLICY "shifts_delete" ON public.shifts
  FOR DELETE TO authenticated
  USING (auth_role() IN ('encargado', 'socio'));
