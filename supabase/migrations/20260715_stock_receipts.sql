-- ---------------------------------------------------------------------------
-- Recepción de mercadería — paso 4/5 del ciclo de cocina.
-- Cada recepción registra la ENTRADA de stock con costo y proveedor:
--  · el stock sube (Fudo primero si está vinculado, vía syncToFudo)
--  · las mermas se calculan bien (entrada explicada ≠ movimiento fantasma)
--  · empezamos a conocer frecuencia real de compra y costos por proveedor
-- ---------------------------------------------------------------------------

create table if not exists public.stock_receipts (
  id bigserial primary key,
  stock_item_id uuid references public.stock_items(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  order_source text,                -- 'cocina' | 'barra' | null (recepción suelta)
  order_id bigint,                  -- id en kitchen_orders / bar_orders
  qty numeric not null,
  unit text,
  cost_total numeric,               -- lo que se pagó por esta entrada (opcional)
  cost_per_unit numeric,            -- derivado: cost_total / qty
  freeze_qty numeric,               -- cuánto fue al freezer (opcional)
  expires_at date,                  -- vencimiento del lote frizado (opcional)
  note text,
  received_by uuid references public.profiles(id) on delete set null,
  received_date date not null,      -- fecha argentina de la recepción
  received_at timestamptz not null default now()
);

alter table public.stock_receipts enable row level security;

drop policy if exists "stock_receipts_read" on public.stock_receipts;
create policy "stock_receipts_read" on public.stock_receipts
  for select to authenticated using (true);

create index if not exists idx_stock_receipts_item_date
  on public.stock_receipts (stock_item_id, received_date desc);
create index if not exists idx_stock_receipts_supplier
  on public.stock_receipts (supplier_id, received_date desc);
