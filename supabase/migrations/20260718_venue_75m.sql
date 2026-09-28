-- ---------------------------------------------------------------------------
-- Geocerca de fichaje: crea attendance_config (la ruta ya la consulta pero la
-- tabla no existía → venía usando la constante VENUE de fallback) y fija el
-- punto exacto del local + radio 75m.
-- Antes (constante): radio 200m, muy holgado.
-- Ahora: Google Maps -26.8194438,-65.2058429 radio 75m — cubre el drift del GPS
-- en interiores sin llegar a la esquina. 10m no es viable (GPS de celular
-- adentro de un edificio: 20-60m de error).
-- ---------------------------------------------------------------------------

create table if not exists public.attendance_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.attendance_config enable row level security;

drop policy if exists "attendance_config_read" on public.attendance_config;
create policy "attendance_config_read" on public.attendance_config
  for select to authenticated using (true);

insert into public.attendance_config (key, value)
values (
  'location',
  jsonb_build_object(
    'lat',            -26.8194438,
    'lng',            -65.2058429,
    'radius_meters',  75,
    'name',           'La Vieja Escuela'
  )
)
on conflict (key) do update set
  value      = excluded.value,
  updated_at = now();
