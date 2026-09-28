-- ---------------------------------------------------------------------------
-- FASE 1 del reemplazo de Fudo: motor de descuento de stock PROPIO en paralelo
-- (sombra). NO toca stock_items.current_qty (que sigue espejando a Fudo):
-- lleva su propia contabilidad teórica y mide la divergencia diaria.
--
--  · sales_engine_state  — stock teórico acumulado del motor (1 fila por item,
--    seed inicial = current_qty del día que arranca: "arranque justo").
--  · sales_engine_daily  — snapshot por día AR e item: movimientos del día
--    (consumo por ventas × recetas, producción validada, recepciones),
--    lve_qty (teórico del motor), fudo_qty (current_qty espejado) y diff.
--
-- Escribe SOLO el cron /api/cron/sales-engine (service_role). Lectura para
-- usuarios autenticados (comparativa en el panel).
-- ---------------------------------------------------------------------------

create table if not exists public.sales_engine_daily (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  qty_consumed numeric not null default 0,   -- ventas del día × recetas (unidad del item)
  qty_produced numeric not null default 0,   -- outputs de producción validada (no waste)
  qty_received numeric not null default 0,   -- recepciones de mercadería
  lve_qty numeric,                           -- stock teórico del motor tras el día
  fudo_qty numeric,                          -- current_qty (espejo Fudo) al momento del run
  diff numeric,                              -- lve_qty − fudo_qty
  created_at timestamptz not null default now(),
  unique (day, stock_item_id)
);

create index if not exists idx_sales_engine_daily_day
  on public.sales_engine_daily (day desc);
create index if not exists idx_sales_engine_daily_item_day
  on public.sales_engine_daily (stock_item_id, day desc);

create table if not exists public.sales_engine_state (
  stock_item_id uuid primary key references public.stock_items(id) on delete cascade,
  lve_qty numeric not null default 0,
  seeded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sales_engine_daily enable row level security;
alter table public.sales_engine_state enable row level security;

drop policy if exists "sales_engine_daily_read" on public.sales_engine_daily;
create policy "sales_engine_daily_read" on public.sales_engine_daily
  for select to authenticated using (true);

drop policy if exists "sales_engine_state_read" on public.sales_engine_state;
create policy "sales_engine_state_read" on public.sales_engine_state
  for select to authenticated using (true);

comment on table public.sales_engine_daily is
  'Motor paralelo (fase 1 reemplazo Fudo): snapshot diario por insumo — movimientos teóricos, lve_qty vs fudo_qty y diff.';
comment on table public.sales_engine_state is
  'Motor paralelo: stock teórico acumulado por insumo (seed = current_qty al arrancar).';
