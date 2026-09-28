-- ---------------------------------------------------------------------------
-- Fichaje: que solo se pueda fichar por la app (con ubicación y turno)
-- ---------------------------------------------------------------------------
-- Verificado en la base antes de este cambio:
--   · attendance_logs dejaba a cada empleado INSERTAR y EDITAR sus propios
--     fichajes directo (sin pasar por la app): podía cargarse o cambiarse la
--     hora de entrada/salida salteando la geocerca.
--   · clock_in / clock_out (versiones viejas, que la app ya no usa) se podían
--     ejecutar incluso sin iniciar sesión.
-- La app ficha por /api/attendance/clock (valida ubicación y turno en el
-- servidor) y todas las correcciones van por rutas de encargado con la clave
-- interna, así que nada de lo que usa la app depende de estos permisos.
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.clock_in(text)',
    'public.clock_in(text, numeric, numeric, numeric, text, text, text)',
    'public.clock_out(text)',
    'public.clock_out(text, numeric, numeric, numeric, text, text, text)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    end if;
  end loop;
end $$;

-- Nadie inserta fichajes directo: solo el servidor
drop policy if exists attendance_insert on public.attendance_logs;

-- Editar fichajes: solo encargado/socio (el empleado ya no puede tocar los suyos)
drop policy if exists attendance_update on public.attendance_logs;
create policy attendance_update on public.attendance_logs
  for update to authenticated using (is_encargado()) with check (is_encargado());
