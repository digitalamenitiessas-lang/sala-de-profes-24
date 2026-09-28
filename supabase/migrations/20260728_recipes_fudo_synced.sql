-- ---------------------------------------------------------------------------
-- recipes.fudo_synced_at — marca de "espejo de Fudo"
-- ---------------------------------------------------------------------------
-- null       → receta local / de producción (editable en la app)
-- con valor  → receta importada del export XLS de Fudo (se edita EN FUDO y se
--              reimporta; la app no debe permitir editar sus ingredientes)
-- ---------------------------------------------------------------------------

alter table public.recipes
  add column if not exists fudo_synced_at timestamptz;

comment on column public.recipes.fudo_synced_at is
  'Última sincronización desde el export de Fudo. NULL = receta local/de producción; con valor = espejo de Fudo (no editable en la app).';

-- Backfill: las recetas cuyo menu_item vinculado tiene fudo_product_id vinieron
-- del importador (menu_items.recipe_id → recipes.id).
update public.recipes r
set fudo_synced_at = now()
where r.fudo_synced_at is null
  and exists (
    select 1
    from public.menu_items mi
    where mi.recipe_id = r.id
      and mi.fudo_product_id is not null
  );
