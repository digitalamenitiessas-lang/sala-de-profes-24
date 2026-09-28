-- ---------------------------------------------------------------------------
-- 20260727_recipe_output_link.sql
--
-- Vínculo explícito receta → stock_item que produce (intermedios nivel 2).
-- Hasta ahora "Milanesa cruda" (receta) y "Milanesa cruda" (stock_item) se
-- vinculaban por coincidencia exacta de nombre: si alguien renombra uno de
-- los dos, el costeo nivel-2 se rompe en silencio. Esta columna hace el
-- vínculo robusto; el match por nombre queda solo como fallback en el código.
-- ---------------------------------------------------------------------------

alter table public.recipes
  add column if not exists output_stock_item_id uuid references public.stock_items(id) on delete set null;

comment on column public.recipes.output_stock_item_id is
  'Item de stock que esta receta produce (elaborado intermedio). Si es null, el código cae al match por nombre.';

create index if not exists idx_recipes_output_stock_item_id
  on public.recipes (output_stock_item_id)
  where output_stock_item_id is not null;

-- ---------------------------------------------------------------------------
-- Backfill: vincular por nombre exacto (case/trim-insensitive), SOLO cuando
-- el nombre identifica a un único stock_item. Si dos stock_items comparten
-- nombre, se saltea (queda null y lo resuelve una persona).
-- ---------------------------------------------------------------------------

update public.recipes r
set output_stock_item_id = m.item_id
from (
  select lower(trim(s.name)) as name_key, (array_agg(s.id))[1] as item_id
  from public.stock_items s
  group by lower(trim(s.name))
  having count(*) = 1
) m
where r.output_stock_item_id is null
  and lower(trim(r.name)) = m.name_key;
