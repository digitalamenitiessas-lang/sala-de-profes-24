-- ---------------------------------------------------------------------------
-- Recetas de producción editables desde la app
-- ---------------------------------------------------------------------------
-- Una receta de producción = recipes.output_stock_item_id (qué elaborado sale)
-- + recipe_ingredients (qué crudo lleva, POR UNIDAD producida, igual que las
-- recetas que ya existían: ej. vacío deshebrado 0,175 kg de carne por porción).
-- rinde_tanda: cuánto sale de una tanda típica (en la unidad del elaborado).
-- Puede ser decimal (4,5 kg): yield_portions es entero y se deja como estaba.
--
-- guardar_receta_produccion(): única vía para cargarla desde la app.
-- Encargado, socio o chef; todo o nada (antes el import borraba e insertaba
-- en pasos separados); con auditoría. No toca recetas de platos ni las que
-- vienen de Fudo: si la del elaborado es de esas, crea una propia.
-- ---------------------------------------------------------------------------

alter table public.recipes add column if not exists rinde_tanda numeric;

do $$ begin
  alter table public.recipes add constraint recipes_rinde_tanda_check check (rinde_tanda is null or rinde_tanda > 0);
exception when duplicate_object then null; end $$;

comment on column public.recipes.rinde_tanda is
  'Cuánto rinde una tanda típica, en la unidad del elaborado (recetas de producción).';

create or replace function public.guardar_receta_produccion(
  p_output uuid,
  p_rinde numeric,
  p_ingredientes jsonb,
  p_notas text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_out record;
  v_recipe uuid;
  v_ing jsonb;
  v_item uuid;
  v_qty numeric;
  v_n int := 0;
begin
  select role::text, nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    into v_role, v_name from profiles where id = v_uid;
  if v_role is null or v_role not in ('encargado', 'socio', 'chef') then
    raise exception 'Solo encargados, socios o chef pueden cargar recetas de producción' using errcode = '42501';
  end if;
  if p_rinde is null or p_rinde <= 0 then
    raise exception 'El rinde tiene que ser mayor a cero' using errcode = '22023';
  end if;
  if p_ingredientes is null or jsonb_typeof(p_ingredientes) <> 'array'
     or jsonb_array_length(p_ingredientes) = 0 or jsonb_array_length(p_ingredientes) > 40 then
    raise exception 'Cargá entre 1 y 40 ingredientes' using errcode = '22023';
  end if;

  select id, name, unit into v_out from stock_items where id = p_output and is_active;
  if v_out.id is null then
    raise exception 'El elaborado no existe o está inactivo' using errcode = '22023';
  end if;

  -- La receta de producción de este elaborado: una propia (no de un plato, no de Fudo)
  select r.id into v_recipe
    from recipes r
   where r.output_stock_item_id = p_output and r.is_active
     and r.fudo_synced_at is null
     and not exists (select 1 from menu_items m where m.recipe_id = r.id)
   order by (r.slug like 'prod-%') desc, r.updated_at desc nulls last
   limit 1;

  if v_recipe is null then
    insert into recipes (name, category, created_by, is_active, yield_portions, rinde_tanda, slug, output_stock_item_id, notes)
    values (v_out.name, 'produccion', v_uid, true, greatest(1, round(p_rinde))::int, p_rinde,
            'prod-' || p_output::text, p_output, p_notas)
    returning id into v_recipe;
  else
    update recipes
       set rinde_tanda = p_rinde, yield_portions = greatest(1, round(p_rinde))::int,
           notes = coalesce(p_notas, notes), updated_at = now()
     where id = v_recipe;
    delete from recipe_ingredients where recipe_id = v_recipe;
  end if;

  for v_ing in select * from jsonb_array_elements(p_ingredientes) loop
    v_item := (v_ing ->> 'stock_item_id')::uuid;
    v_qty := (v_ing ->> 'qty')::numeric;
    if v_item is null or v_qty is null or v_qty <= 0 then
      raise exception 'Cada ingrediente necesita insumo y cantidad mayor a cero' using errcode = '22023';
    end if;
    if v_item = p_output then
      raise exception 'Un elaborado no puede llevarse a sí mismo' using errcode = '22023';
    end if;
    if not exists (select 1 from stock_items where id = v_item and is_active) then
      raise exception 'Uno de los ingredientes no existe o está inactivo' using errcode = '22023';
    end if;
    -- La cantidad llega POR TANDA; se guarda POR UNIDAD producida
    insert into recipe_ingredients (recipe_id, stock_item_id, qty_per_portion, ingredient_unit, notes)
    values (v_recipe, v_item, v_qty / p_rinde, nullif(v_ing ->> 'unit', ''), nullif(v_ing ->> 'nota', ''));
    v_n := v_n + 1;
  end loop;

  insert into audit_trail (user_id, user_name, action, module, entity_type, entity_id, description, metadata)
  values (v_uid, v_name, 'guardar_receta_produccion', 'produccion', 'stock_item', p_output::text,
          format('%s cargó la receta de producción de %s (rinde %s, %s ingredientes)', coalesce(v_name, 'Alguien'), v_out.name, p_rinde, v_n),
          jsonb_build_object('recipe_id', v_recipe, 'rinde', p_rinde, 'ingredientes', p_ingredientes));

  return jsonb_build_object('recipe_id', v_recipe, 'ingredientes', v_n);
end $$;

revoke all on function public.guardar_receta_produccion(uuid, numeric, jsonb, text) from public, anon;
grant execute on function public.guardar_receta_produccion(uuid, numeric, jsonb, text) to authenticated;
