-- ---------------------------------------------------------------------------
-- Protocolos con horario, responsable y foto (empieza con la limpieza del baño)
-- ---------------------------------------------------------------------------
-- Cada protocolo tiene horarios fijos por día. A cada horario le corresponde
-- una tarea: el encargado de turno la asigna a alguien presente (o a sí
-- mismo) y esa persona la completa marcando cada paso y subiendo una foto.
-- La app avisa a la hora, vuelve a avisar si no se asigna o no se hace, y
-- deja el registro del día con las fotos.
-- Escrituras: solo desde el servidor (rutas /api/protocolos, que validan rol).
-- ---------------------------------------------------------------------------

create table if not exists public.protocolos (
  id            uuid        primary key default gen_random_uuid(),
  nombre        text        not null,
  descripcion   text,
  horarios      text[]      not null default '{}',   -- 'HH:MM' hora Argentina
  pasos         text[]      not null default '{}',   -- todos obligatorios
  requiere_foto boolean     not null default true,
  activo        boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.protocolo_tareas (
  id              uuid        primary key default gen_random_uuid(),
  protocolo_id    uuid        not null references public.protocolos(id) on delete cascade,
  fecha           date        not null,               -- día operativo (corte 06:00)
  hora            text        not null,               -- 'HH:MM'
  estado          text        not null default 'pendiente' check (estado in ('pendiente', 'asignada', 'hecha')),
  asignado_a      uuid        references public.profiles(id) on delete set null,
  asignado_por    uuid        references public.profiles(id) on delete set null,
  asignado_at     timestamptz,
  hecho_por       uuid        references public.profiles(id) on delete set null,
  hecho_at        timestamptz,
  foto_path       text,
  pasos_ok        text[],
  nota            text,
  -- avisos ya enviados (para no repetirlos)
  avisado_at      timestamptz,   -- "toca: asigná a alguien"
  reaviso_at      timestamptz,   -- "sigue sin asignar"
  recordatorio_at timestamptz,   -- a la persona asignada: "todavía no está hecha"
  atraso_at       timestamptz,   -- a encargados y socios: "no se hizo"
  created_at      timestamptz not null default now(),
  unique (protocolo_id, fecha, hora)
);

create index if not exists protocolo_tareas_fecha on public.protocolo_tareas (fecha);
create index if not exists protocolo_tareas_asignado on public.protocolo_tareas (asignado_a) where estado = 'asignada';

alter table public.protocolos enable row level security;
alter table public.protocolo_tareas enable row level security;
drop policy if exists protocolos_select on public.protocolos;
create policy protocolos_select on public.protocolos for select to authenticated using (true);
drop policy if exists protocolo_tareas_select on public.protocolo_tareas;
create policy protocolo_tareas_select on public.protocolo_tareas for select to authenticated using (true);

-- Fotos: bucket privado (se ven con links firmados desde el servidor)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('protocolos', 'protocolos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Primer protocolo: limpieza del baño, 4 veces por día
insert into public.protocolos (nombre, descripcion, horarios, pasos)
select 'Limpieza del baño',
       'Protocolo obligatorio. Se completa con foto del baño terminado.',
       array['11:00', '14:30', '18:00', '21:30'],
       array[
         'Inodoro y mingitorio limpios y desinfectados',
         'Lavamanos, grifería y espejo limpios',
         'Piso barrido y trapeado',
         'Papel higiénico, jabón y toallas repuestos',
         'Cesto vaciado con bolsa nueva',
         'Sin olor: ventilación / aromatizante'
       ]
where not exists (select 1 from public.protocolos where nombre = 'Limpieza del baño');
