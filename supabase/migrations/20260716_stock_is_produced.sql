-- ---------------------------------------------------------------------------
-- ¿Se produce acá o se compra hecho?
-- Los budines/dulces los trae un tercero: NO van al plan de producción sino
-- al copiloto de compras. El plan de producción solo sugiere is_produced=true.
-- Seed: elaborados (empanadas, tortillas...) = producción propia; el resto
-- arranca como comprado y se corrige con un toque desde la pantalla Hoy.
-- ---------------------------------------------------------------------------

alter table public.stock_items
  add column if not exists is_produced boolean not null default false;

update public.stock_items set is_produced = true where category = 'elaborados';

comment on column public.stock_items.is_produced is 'true = lo produce la casa; false = se compra hecho a un proveedor';
