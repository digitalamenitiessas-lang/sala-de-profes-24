-- ---------------------------------------------------------------------------
-- unir_insumos(duplicado, bueno): une un insumo duplicado en el correcto
-- ---------------------------------------------------------------------------
-- Caso real: "Leche Entera Cocina" quedó vinculado a un ingrediente que Fudo
-- borró, mientras "Leche entera" está bien vinculado. Pasa todo lo que usa el
-- duplicado (recetas, platos, plantillas de producción, proveedores, alias de
-- conteo) al correcto y desactiva el duplicado. Todo o nada.
-- Solo con la MISMA unidad (si no, las cantidades de las recetas mentirían).
-- La historia (movimientos, recepciones, conteos) queda en el duplicado.
-- Solo la llama el servidor (service_role).
-- ---------------------------------------------------------------------------

create or replace function public.unir_insumos(p_duplicado uuid, p_bueno uuid, p_user uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  b record;
  n_recetas int := 0;
  n_platos int := 0;
  n_prod int := 0;
  n_prov int := 0;
  n int;
begin
  if p_duplicado = p_bueno then raise exception 'Es el mismo insumo'; end if;
  select id, name, unit, is_active into d from stock_items where id = p_duplicado for update;
  select id, name, unit, is_active into b from stock_items where id = p_bueno for update;
  if d.id is null or b.id is null then raise exception 'Insumo no encontrado'; end if;
  if not b.is_active then raise exception 'El insumo correcto (%) está inactivo', b.name; end if;
  if d.unit is distinct from b.unit then
    raise exception 'Unidades distintas (% en %, % en %): no se pueden unir', d.unit, d.name, b.unit, b.name;
  end if;

  update recipe_ingredients set stock_item_id = p_bueno where stock_item_id = p_duplicado;
  get diagnostics n_recetas = row_count;
  update menu_items set consumo_stock_item_id = p_bueno where consumo_stock_item_id = p_duplicado;
  get diagnostics n_platos = row_count;
  update recipes set output_stock_item_id = p_bueno where output_stock_item_id = p_duplicado;
  get diagnostics n = row_count; n_prod := n_prod + n;
  update production_template_inputs set stock_item_id = p_bueno where stock_item_id = p_duplicado;
  get diagnostics n = row_count; n_prod := n_prod + n;
  update production_template_outputs set stock_item_id = p_bueno where stock_item_id = p_duplicado;
  get diagnostics n = row_count; n_prod := n_prod + n;
  update production_templates set default_input_stock_item_id = p_bueno where default_input_stock_item_id = p_duplicado;
  get diagnostics n = row_count; n_prod := n_prod + n;

  insert into stock_item_suppliers (stock_item_id, supplier_id, is_primary, source, fudo_purchases, last_purchase_at, confirmed_by, confirmed_at)
  select p_bueno, s.supplier_id, false, s.source, s.fudo_purchases, s.last_purchase_at, s.confirmed_by, s.confirmed_at
  from stock_item_suppliers s
  where s.stock_item_id = p_duplicado and s.dismissed_at is null
    and not exists (select 1 from stock_item_suppliers x where x.stock_item_id = p_bueno and x.supplier_id = s.supplier_id);
  get diagnostics n_prov = row_count;
  delete from stock_item_suppliers where stock_item_id = p_duplicado;

  if to_regclass('public.stock_count_aliases') is not null then
    execute 'update stock_count_aliases set stock_item_id = $1 where stock_item_id = $2' using p_bueno, p_duplicado;
  end if;

  update stock_items
     set is_active = false, fudo_ingredient_id = null, fudo_product_id = null, fudo_skip = true, updated_at = now()
   where id = p_duplicado;

  update fudo_sync_incidents set status = 'resolved', resolved_at = now(), resolved_by = p_user, updated_at = now()
   where stock_item_id = p_duplicado::text and status = 'open';

  return jsonb_build_object('duplicado', d.name, 'bueno', b.name, 'recetas', n_recetas, 'platos', n_platos, 'produccion', n_prod, 'proveedores', n_prov);
end;
$$;

revoke all on function public.unir_insumos(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.unir_insumos(uuid, uuid, uuid) to service_role;
