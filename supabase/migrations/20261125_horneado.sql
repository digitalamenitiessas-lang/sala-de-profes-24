-- ---------------------------------------------------------------------------
-- Control de horneado: medialunas, bollitos y tortillas
-- ---------------------------------------------------------------------------
-- Traído de Santa Fe (Marco, 20261123d_horneado.sql, 24/11/2026): misma tabla.
-- Vienen congelados y se hornean en tandas. Se anota cada tanda, lo que sobró
-- al cierre, lo que fue al budín de pan y lo que se tiró. La app lo cruza con
-- lo vendido en Fudo (sueltas, dentro del Clásico y PedidosYa) y muestra lo
-- que no tiene explicación (Horneado → Control, encargados y socios).
--   tanda    → se hornearon (una fila por tanda)
--   sobrante → quedaron al cierre (una sola por día y pieza: se reemplaza)
--   budin    → fueron al budín de pan
--   tirado   → se tiraron
-- RLS sin políticas: se usa solo desde /api/horneado.
-- ---------------------------------------------------------------------------

create table if not exists public.horneado_registros (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  pieza text not null check (pieza in ('medialuna', 'bollito', 'tortilla')),
  tipo text not null check (tipo in ('tanda', 'sobrante', 'budin', 'tirado')),
  cantidad integer not null check (cantidad >= 0 and cantidad <= 500),
  nota text check (nota is null or char_length(nota) <= 200),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists horneado_registros_fecha_idx on public.horneado_registros (fecha, pieza);
-- Lo que sobró se cuenta una vez por día y pieza
create unique index if not exists horneado_registros_sobrante_uq
  on public.horneado_registros (fecha, pieza) where tipo = 'sobrante';

alter table public.horneado_registros enable row level security;
comment on table public.horneado_registros is
  'Control de horneado: tandas, sobrantes al cierre, al budín de pan y tirados, por día operativo y pieza';
