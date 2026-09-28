-- Índice para el agregador de ventas (src/lib/ventas/aggregate.ts):
-- los filtros por producto + rango de fechas pegan directo acá.
CREATE INDEX IF NOT EXISTS idx_fudo_sales_product_sold_at ON fudo_sales (fudo_product_id, sold_at);
