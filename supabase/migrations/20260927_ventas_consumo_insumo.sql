-- ---------------------------------------------------------------------------
-- Plato u opción que descuenta directo un insumo, con cantidad.
-- Ej.: la opción "Leche Entera 190 ML" → 0,19 l de "Leche entera";
--      "Sprite litro" → 1 unidad de "Sprite 1,5 l"; packaging de PedidosYa.
-- consumo_modo = 'insumo' usa consumo_stock_item_id × consumo_qty (en la
-- unidad del insumo) por cada unidad vendida o elegida.
-- ---------------------------------------------------------------------------

alter table public.menu_items
  add column if not exists consumo_stock_item_id uuid references public.stock_items(id) on delete set null,
  add column if not exists consumo_qty numeric;

alter table public.menu_items drop constraint if exists menu_items_consumo_modo_check;
alter table public.menu_items add constraint menu_items_consumo_modo_check
  check (consumo_modo is null or consumo_modo in ('receta', 'combo', 'sin_consumo', 'insumo'));

do $$ begin
  alter table public.menu_items add constraint menu_items_consumo_insumo_check
    check (consumo_modo is distinct from 'insumo' or (consumo_stock_item_id is not null and consumo_qty > 0));
exception when duplicate_object then null; end $$;
