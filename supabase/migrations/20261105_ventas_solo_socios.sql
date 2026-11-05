-- Ventas: con su usuario, solo los socios pueden leerlas (pedido del 5/11/2026).
-- Antes cualquier usuario logueado podía leer fudo_sales y fudo_sale_subitems
-- desde el navegador (SELECT USING true) y reconstruir la facturación.
-- La app lee las ventas desde el servidor con la clave de servicio, que no
-- pasa por RLS: esto no cambia nada de lo que muestra cada pantalla.

drop policy if exists fudo_sales_select on public.fudo_sales;
drop policy if exists fudo_sales_select_socios on public.fudo_sales;
create policy fudo_sales_select_socios on public.fudo_sales
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'socio' and p.is_active
  ));

drop policy if exists fudo_sale_subitems_select on public.fudo_sale_subitems;
drop policy if exists fudo_sale_subitems_select_socios on public.fudo_sale_subitems;
create policy fudo_sale_subitems_select_socios on public.fudo_sale_subitems
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'socio' and p.is_active
  ));
