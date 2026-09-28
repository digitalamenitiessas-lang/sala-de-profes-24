-- ---------------------------------------------------------------------------
-- Calendario de proveedores — paso 3 del ciclo de cocina.
-- order_days: días de semana en que se le hace pedido a cada proveedor
-- (0=domingo … 6=sábado, misma convención que JS getDay y el resto del sistema).
-- lead_time_days: cuántos días tarda en entregar desde que se pide.
-- ---------------------------------------------------------------------------

alter table public.suppliers
  add column if not exists order_days integer[] not null default '{}',
  add column if not exists lead_time_days integer;

comment on column public.suppliers.order_days is 'Días de pedido: 0=domingo … 6=sábado';
comment on column public.suppliers.lead_time_days is 'Días entre pedido y entrega';
