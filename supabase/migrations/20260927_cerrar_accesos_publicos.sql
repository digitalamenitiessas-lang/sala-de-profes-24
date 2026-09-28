-- ---------------------------------------------------------------------------
-- Cerrar accesos sin iniciar sesión
-- ---------------------------------------------------------------------------
-- La clave pública (anon) viaja dentro de la página web, así que cualquier
-- regla "para todos" (public/anon) era accesible sin usuario. Esta migración:
--   1. Saca a usuarios y visitantes la ejecución de funciones con permisos
--      elevados que no validan quién llama (completar producción, cambiar
--      stock, tableros de admin…). Las usa solo el servidor con la clave
--      interna, que no depende de estos permisos.
--   2. Cierra escrituras abiertas a cualquiera: esas tablas se escriben solo
--      desde el servidor (clave interna) salvo los casos que se listan.
--   3. Pasa las lecturas "para todos" a "solo usuarios con sesión".
--   4. kitchen_orders/bar_orders: actualizar pedidos queda para encargado y
--      socio (antes el socio no podía y el cambio se perdía sin error).
-- bar_stock_items queda afuera: lo corrige otra tarea.
-- ---------------------------------------------------------------------------

-- 1) Funciones con permisos elevados sin control de quién llama
do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_announcements_summary(date, date)',
    'public.admin_attendance_summary(date, date)',
    'public.admin_dashboard_kpis()',
    'public.admin_shifts_summary(date, date)',
    'public.admin_stock_snapshot()',
    'public.check_attendance_anomalies(uuid, text)',
    'public.complete_production_order(bigint, uuid)',
    'public.deduct_stock_on_sale(bigint)',
    'public.get_weekly_schedule(date)',
    'public.menu_item_reconciliation(timestamptz, timestamptz)',
    'public.produce_recipe(bigint, numeric, text)',
    'public.production_dashboard(integer)',
    'public.recalculate_semaphores()',
    'public.recipes_at_risk(numeric)',
    'public.stock_reconciliation(timestamptz, timestamptz)',
    'public.stock_yield()',
    'public.update_stock_qty(text, numeric)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    end if;
  end loop;
end $$;

-- update_stock_qty(uuid, numeric) sí valida el rol adentro: solo se le saca a visitantes
do $$ begin
  if to_regprocedure('public.update_stock_qty(uuid, numeric)') is not null then
    revoke execute on function public.update_stock_qty(uuid, numeric) from public, anon;
  end if;
end $$;

-- 2) Escrituras abiertas a cualquiera
drop policy if exists fudo_sales_insert on public.fudo_sales;
drop policy if exists menu_categories_insert on public.menu_categories;
drop policy if exists menu_categories_update on public.menu_categories;
drop policy if exists recipe_ingredients_insert on public.recipe_ingredients;
drop policy if exists recipe_ingredients_update on public.recipe_ingredients;
drop policy if exists stock_movements_insert on public.stock_movements;
drop policy if exists bar_orders_insert on public.bar_orders;

-- Auditoría: un usuario solo puede registrar acciones a su nombre
drop policy if exists audit_trail_insert on public.audit_trail;
create policy audit_trail_insert on public.audit_trail
  for insert to authenticated with check (user_id = auth.uid());

-- 4) Pedidos: encargado y socio pueden actualizar (Pedidos lo hace desde el navegador)
drop policy if exists bar_orders_update on public.bar_orders;
create policy bar_orders_update on public.bar_orders
  for update to authenticated using (is_encargado()) with check (is_encargado());

drop policy if exists kitchen_orders_update on public.kitchen_orders;
create policy kitchen_orders_update on public.kitchen_orders
  for update to authenticated using (is_encargado()) with check (is_encargado());

drop policy if exists kitchen_orders_insert on public.kitchen_orders;
create policy kitchen_orders_insert on public.kitchen_orders
  for insert to authenticated with check (
    exists (select 1 from profiles where id = auth.uid() and role in ('chef', 'cocina', 'encargado', 'socio'))
  );

-- 3) Lecturas "para todos" → solo con sesión
do $$
declare p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and cmd in ('SELECT', 'ALL')
      and (roles::text like '%public%' or roles::text like '%anon%')
      and coalesce(qual, 'true') = 'true'
      and tablename <> 'bar_stock_items'
  loop
    execute format('alter policy %I on public.%I to authenticated', p.policyname, p.tablename);
  end loop;
end $$;
