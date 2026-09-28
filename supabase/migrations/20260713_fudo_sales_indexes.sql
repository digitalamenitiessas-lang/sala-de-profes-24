-- Índices para el historial de ventas (backfill 2026-07-13: ~13k filas desde mayo).
-- Los reportes de mermas y tendencias consultan por rango de fecha y producto.
create index if not exists idx_fudo_sales_sold_at on public.fudo_sales (sold_at);
create index if not exists idx_fudo_sales_product on public.fudo_sales (fudo_product_id);
