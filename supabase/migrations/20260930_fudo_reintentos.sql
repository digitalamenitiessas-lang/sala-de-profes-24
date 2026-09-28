-- ---------------------------------------------------------------------------
-- Cola de reintentos hacia Fudo
-- ---------------------------------------------------------------------------
-- Todo movimiento que tenía que llegar a Fudo y falló (producción, recepción,
-- merma, anulación de recibo, pago de un gasto) queda acá y se reintenta solo
-- cada 10 minutos (con espera creciente) hasta que entre. Mientras está
-- pendiente, la lectura de stock desde Fudo le suma el pendiente para no
-- borrar el movimiento en LVE. Si a la hora sigue fallando, avisa.
-- Solo el servidor escribe (RLS sin políticas de escritura).
-- ---------------------------------------------------------------------------

create table if not exists public.fudo_reintentos (
  id                 uuid        primary key default gen_random_uuid(),
  tipo               text        not null check (tipo in ('stock_delta', 'pago_gasto')),
  stock_item_id      uuid        references public.stock_items(id) on delete cascade,
  delta              numeric,
  payload            jsonb       not null default '{}',
  origen             text        not null,          -- produccion, recepcion, merma, anulacion_recibo, pago_gasto
  nota               text,
  stock_movement_ids uuid[]      not null default '{}',
  estado             text        not null default 'pendiente' check (estado in ('pendiente', 'hecho', 'descartado')),
  intentos           int         not null default 0,
  ultimo_error       text,
  proximo_intento_at timestamptz not null default now(),
  alertado_at        timestamptz,
  created_by         uuid        references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  hecho_at           timestamptz
);

create index if not exists fudo_reintentos_pendientes on public.fudo_reintentos (proximo_intento_at) where estado = 'pendiente';
create index if not exists fudo_reintentos_item on public.fudo_reintentos (stock_item_id) where estado = 'pendiente';

alter table public.fudo_reintentos enable row level security;
drop policy if exists fudo_reintentos_select on public.fudo_reintentos;
create policy fudo_reintentos_select on public.fudo_reintentos for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('socio', 'encargado')));

-- Estado de la conexión (para avisar una sola vez cuando Fudo se cae y cuando vuelve)
create table if not exists public.fudo_salud (
  id                  int         primary key default 1 check (id = 1),
  ultimo_ok_at        timestamptz,
  ultimo_error_at     timestamptz,
  ultimo_error        text,
  fallas_seguidas     int         not null default 0,
  caida_avisada_at    timestamptz,
  ultima_lectura_stock_at timestamptz,
  ultimo_menu_at      timestamptz,
  updated_at          timestamptz not null default now()
);
insert into public.fudo_salud (id) values (1) on conflict (id) do nothing;
alter table public.fudo_salud enable row level security;
drop policy if exists fudo_salud_select on public.fudo_salud;
create policy fudo_salud_select on public.fudo_salud for select to authenticated using (true);
