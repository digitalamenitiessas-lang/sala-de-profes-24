-- ---------------------------------------------------------------------------
-- Protocolos: días de la semana y "al terminar una producción"
-- ---------------------------------------------------------------------------
-- Esquema pedido por el local (20/10):
--   · Descartables: lunes y jueves 08:30 (antes todos los días 08:30 y 16:30)
--   · Elaborados: la tarea aparece al terminar cada producción (antes 15:30 y 21:45)
-- Solo agrega columnas: sin ellas la app funciona igual que antes.
-- Aplicada en Santa Fe el 20/10/2026.
-- ---------------------------------------------------------------------------

alter table public.protocolos
  add column if not exists dias smallint[],
  add column if not exists al_terminar_produccion boolean not null default false;

comment on column public.protocolos.dias is 'Días de la semana en que sale (0=domingo..6=sábado). null = todos';
comment on column public.protocolos.al_terminar_produccion is 'La tarea aparece al terminar una producción, no por horario';

-- Datos (se corren DESPUÉS de publicar el código que entiende estas columnas):
-- update protocolos set dias = '{1,4}', horarios = '{08:30}', updated_at = now()
--   where registro = 'conteo_descartables' and activo;
-- update protocolos set al_terminar_produccion = true, horarios = '{}', updated_at = now()
--   where registro = 'conteo_elaborados' and activo;
