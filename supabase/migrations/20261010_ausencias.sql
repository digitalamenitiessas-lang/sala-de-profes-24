-- ---------------------------------------------------------------------------
-- Motivo de ausencia: por qué alguien con turno no fichó ese día
-- ---------------------------------------------------------------------------
-- El encargado lo anota en Equipo (un toque) y sale en la liquidación. Así
-- "sin fichar" deja de ser un misterio: licencia, enfermedad, franco, cambio
-- de turno, faltó u otro. Una por persona y día.
-- Sin políticas: se lee y escribe solo desde el servidor (/api/admin/ausencias).
-- ---------------------------------------------------------------------------

create table if not exists public.ausencias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  fecha date not null,
  motivo text not null check (motivo in ('licencia', 'enfermedad', 'franco', 'cambio_turno', 'falto', 'otro')),
  nota text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fecha)
);

create index if not exists ausencias_fecha_idx on public.ausencias (fecha);

alter table public.ausencias enable row level security;

comment on table public.ausencias is 'Motivo por el que alguien con turno no fichó (licencia, enfermedad, franco, cambio de turno, faltó, otro)';
