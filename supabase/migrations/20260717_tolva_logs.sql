-- ---------------------------------------------------------------------------
-- Tolva de café — el cuaderno de los baristas hecho sistema.
-- Por turno (TM = mañana, TT = tarde): gramos al inicio, agregados y al final.
-- Consumo del turno = inicio + agregado − final. El final de un turno es el
-- inicio del siguiente (como hacen en el papel).
-- ---------------------------------------------------------------------------

create table if not exists public.tolva_logs (
  id bigserial primary key,
  log_date date not null,
  shift text not null check (shift in ('TM', 'TT')),
  start_gr numeric,
  added_gr numeric not null default 0,
  end_gr numeric,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (log_date, shift)
);

alter table public.tolva_logs enable row level security;

drop policy if exists "tolva_read" on public.tolva_logs;
create policy "tolva_read" on public.tolva_logs
  for select to authenticated using (true);

drop policy if exists "tolva_write" on public.tolva_logs;
create policy "tolva_write" on public.tolva_logs
  for insert to authenticated with check (true);

drop policy if exists "tolva_update" on public.tolva_logs;
create policy "tolva_update" on public.tolva_logs
  for update to authenticated using (true);

create index if not exists idx_tolva_logs_date on public.tolva_logs (log_date desc, shift);
