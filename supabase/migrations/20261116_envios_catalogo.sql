-- ---------------------------------------------------------------------------
-- Sistema de producción LVE (16/11/2026): lo que la 24 cuenta al cierre
-- ---------------------------------------------------------------------------
-- Santa Fe tiene la lista de lo que produce, con un stock mínimo para Santa Fe
-- y otro para la 24 (los cambia el dueño o Joaquín, allá). Santa Fe le manda a
-- la 24 la parte que le toca: qué productos y cuál es el mínimo de la 24
-- (PUT /api/envios/catalogo, clave ENVIOS_CLAVE). La 24 los cuenta al cerrar
-- (Stock → Conteo de cierre) y Santa Fe lee ese stock para armar el envío
-- (GET /api/envios/stock). Reemplaza el conteo que se mandaba por WhatsApp.
-- Solo el servidor lee y escribe esta tabla (RLS sin políticas).
-- ---------------------------------------------------------------------------

create table if not exists public.envios_catalogo (
  origen text not null default 'santa_fe',
  -- el producto como está en Santa Fe
  item_origen_id text not null,
  nombre text not null,
  unidad text not null,
  -- stock mínimo de la 24, en la unidad de Santa Fe (null: sin mínimo)
  minimo_24 numeric check (minimo_24 is null or minimo_24 >= 0),
  -- false: Santa Fe lo sacó de la lista (no se cuenta más)
  activo boolean not null default true,
  orden integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (origen, item_origen_id)
);

alter table public.envios_catalogo enable row level security;
