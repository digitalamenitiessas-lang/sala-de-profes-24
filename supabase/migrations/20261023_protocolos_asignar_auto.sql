-- ---------------------------------------------------------------------------
-- Protocolos: asignar solo la tarea a un puesto (ej. tolva → barista)
-- ---------------------------------------------------------------------------
-- Pedido del local (23/10): que el control de tolva le quede al barista de
-- turno sin que lo tenga que asignar el encargado o quien está en caja.
-- A la hora de la tarea, si hay alguien FICHADO con ese puesto, se le asigna
-- y le llega el aviso. Si no hay nadie, avisa al encargado como siempre.
-- Solo agrega una columna: sin ella la app funciona igual que antes.
-- Aplicada en Santa Fe el 23/10/2026.
-- ---------------------------------------------------------------------------

alter table public.protocolos
  add column if not exists asignar_auto_rol text;

comment on column public.protocolos.asignar_auto_rol is 'Puesto al que se asigna sola la tarea a su hora (ej. barista). null = la asigna el encargado';

-- Dato (se corre DESPUÉS de publicar el código; también se cambia desde Protocolos → Horarios):
-- update protocolos set asignar_auto_rol = 'barista', updated_at = now()
--   where registro = 'tolva' and activo;
