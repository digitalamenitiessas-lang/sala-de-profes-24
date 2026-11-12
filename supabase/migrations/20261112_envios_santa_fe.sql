-- ---------------------------------------------------------------------------
-- Envíos de producción de Santa Fe a la 24 (aprobado el 12/11/2026)
-- ---------------------------------------------------------------------------
-- La 24 no produce: lo que elabora la cocina de Santa Fe llega en envíos.
-- Santa Fe registra el envío en su app (baja su stock) y se lo manda a la 24
-- por POST /api/envios/entrantes (clave compartida ENVIOS_CLAVE). Acá queda
-- "En camino desde Santa Fe" hasta que la 24 toca «Llegó»: ahí sube el stock
-- en la app y en el Fudo de la 24, sin gasto ni deuda (no es una compra).
-- Solo el servidor lee y escribe estas tablas (RLS sin políticas).
-- ---------------------------------------------------------------------------

create table if not exists public.envios_entrantes (
  id uuid primary key default gen_random_uuid(),
  origen text not null default 'santa_fe',
  -- id del envío en la app de Santa Fe: el mismo envío nunca entra dos veces
  envio_id_origen text not null,
  estado text not null default 'en_camino' check (estado in ('en_camino', 'recibido', 'anulado')),
  enviado_at timestamptz not null default now(),
  enviado_por text,
  nota text,
  recibido_at timestamptz,
  recibido_por uuid references public.profiles(id) on delete set null,
  nota_recepcion text,
  anulado_at timestamptz,
  created_at timestamptz not null default now(),
  unique (origen, envio_id_origen)
);

create index if not exists envios_entrantes_estado_idx on public.envios_entrantes (estado, enviado_at desc);

create table if not exists public.envios_entrantes_items (
  id uuid primary key default gen_random_uuid(),
  envio_id uuid not null references public.envios_entrantes(id) on delete cascade,
  -- el producto como está en Santa Fe
  item_origen_id text not null,
  nombre text not null,
  unidad text not null,
  cantidad numeric not null check (cantidad > 0),
  -- costo unitario en Santa Fe (solo si allá es un costo real), por su unidad
  costo_unitario numeric check (costo_unitario is null or costo_unitario > 0),
  -- el insumo de la 24 al que entra (sugerido al llegar, confirmado al recibir)
  stock_item_id uuid references public.stock_items(id) on delete set null,
  -- lo que llegó, en la unidad del insumo de la 24
  cantidad_recibida numeric check (cantidad_recibida is null or cantidad_recibida >= 0),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists envios_entrantes_items_envio_idx on public.envios_entrantes_items (envio_id);

-- Qué producto de Santa Fe es qué insumo de la 24: se guarda al recibir, así
-- el próximo envío del mismo producto ya viene vinculado
create table if not exists public.envios_vinculos (
  origen text not null default 'santa_fe',
  item_origen_id text not null,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  nombre_origen text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (origen, item_origen_id)
);

alter table public.envios_entrantes enable row level security;
alter table public.envios_entrantes_items enable row level security;
alter table public.envios_vinculos enable row level security;
