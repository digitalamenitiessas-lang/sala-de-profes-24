-- ---------------------------------------------------------------------------
-- Ventas → consumo de insumos
-- ---------------------------------------------------------------------------
-- 1. fudo_sale_subitems: lo que se eligió dentro de cada ítem vendido
--    (infusión del "Clásico", leche, extras, packaging de PedidosYa…). Fudo
--    lo manda como Subitem de cada Item; antes se descartaba (57% de los
--    ítems vendidos traen sub-ítems).
-- 2. fudo_consumo: una sola fuente "qué se consumió" = ítems vendidos +
--    sub-ítems. La usan los cálculos de consumo (sugerencias de compra y de
--    producción, demanda, inteligencia de stock). Los reportes de
--    facturación siguen leyendo fudo_sales.
-- 3. menu_items.consumo_modo: cómo descuenta insumos cada plato vendido:
--      'receta'      → por su receta (recipe_id)
--      'combo'       → por lo que se eligió adentro (sub-ítems)
--      'sin_consumo' → no descuenta (servicio, adicional sin insumo)
--      null          → todavía sin resolver (aparece en la lista a vincular)
--    menu_items.recipe_link_source: de dónde salió el vínculo a la receta.
-- ---------------------------------------------------------------------------

create table if not exists public.fudo_sale_subitems (
  fudo_subitem_id   text        primary key,
  fudo_sale_item_id text        not null,
  fudo_ticket_id    text        not null,
  fudo_product_id   text        not null,
  quantity          numeric     not null default 1,
  price             numeric,
  sold_at           timestamptz not null,
  created_at        timestamptz not null default now()
);

create index if not exists fudo_sale_subitems_sold_at on public.fudo_sale_subitems (sold_at);
create index if not exists fudo_sale_subitems_item on public.fudo_sale_subitems (fudo_sale_item_id);
create index if not exists fudo_sale_subitems_product on public.fudo_sale_subitems (fudo_product_id);

alter table public.fudo_sale_subitems enable row level security;
drop policy if exists fudo_sale_subitems_select on public.fudo_sale_subitems;
create policy fudo_sale_subitems_select on public.fudo_sale_subitems
  for select to authenticated using (true);
-- Sin policies de escritura: la escribe solo el importador (clave interna).

comment on table public.fudo_sale_subitems is
  'Sub-ítems (modificadores/opciones) de cada ítem vendido en Fudo. Los escribe sales-sync.';

create or replace view public.fudo_consumo with (security_invoker = on) as
  select 'v' || fs.id::text as id, fs.fudo_ticket_id, fs.fudo_product_id, fs.quantity, fs.sold_at, false as es_subitem
  from public.fudo_sales fs
  union all
  select 's' || ss.fudo_subitem_id, ss.fudo_ticket_id, ss.fudo_product_id, ss.quantity, ss.sold_at, true
  from public.fudo_sale_subitems ss;

comment on view public.fudo_consumo is
  'Qué se consumió: ítems vendidos + sub-ítems elegidos. Fuente de los cálculos de consumo.';

grant select on public.fudo_consumo to authenticated;
revoke all on public.fudo_consumo from anon;

alter table public.menu_items
  add column if not exists consumo_modo text,
  add column if not exists recipe_link_source text;

do $$ begin
  alter table public.menu_items add constraint menu_items_consumo_modo_check
    check (consumo_modo is null or consumo_modo in ('receta', 'combo', 'sin_consumo'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.menu_items add constraint menu_items_recipe_link_source_check
    check (recipe_link_source is null or recipe_link_source in ('importacion', 'auto_nombre', 'manual'));
exception when duplicate_object then null; end $$;

-- Lo que ya tenía receta queda resuelto como 'receta' (vínculo de importación)
update public.menu_items
   set consumo_modo = 'receta', recipe_link_source = coalesce(recipe_link_source, 'importacion')
 where recipe_id is not null and consumo_modo is null;
