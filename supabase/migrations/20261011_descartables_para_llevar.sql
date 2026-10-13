-- ---------------------------------------------------------------------------
-- Descartables que se descuentan solos en las ventas PARA LLEVAR
-- ---------------------------------------------------------------------------
-- descartables_producto: qué descartables usa cada producto de Fudo cuando se
--   vende para llevar (ej. Latte Simple → 1 vaso 12oz + 1 tapa). Lo configura
--   el encargado en Stock → Descartables para llevar.
-- descartables_consumidos: cada ítem de venta (fudo_sale_item_id) se descuenta
--   una sola vez. Solo ventas desde que se configuró (no hay retroactivo).
-- stock_items.aviso_minimo_at: último aviso "quedan pocos" (uno cada 12 h).
-- Sin políticas: solo desde el servidor.
-- ---------------------------------------------------------------------------
create table if not exists public.descartables_producto (
  fudo_product_id text not null,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  cantidad numeric not null default 1 check (cantidad > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (fudo_product_id, stock_item_id)
);
alter table public.descartables_producto enable row level security;

create table if not exists public.descartables_consumidos (
  fudo_sale_item_id text primary key,
  fudo_product_id text not null,
  vendido_at timestamptz not null,
  detalle jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.descartables_consumidos enable row level security;
create index if not exists descartables_consumidos_vendido_idx on public.descartables_consumidos (vendido_at);

alter table public.stock_items add column if not exists aviso_minimo_at timestamptz;
