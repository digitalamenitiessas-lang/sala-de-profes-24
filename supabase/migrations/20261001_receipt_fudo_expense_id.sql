-- ---------------------------------------------------------------------------
-- fudo_expense_id directo en stock_receipts
-- ---------------------------------------------------------------------------
-- Antes el PATCH /api/stock/receipts/[id] buscaba el fudo_expense_id pasando
-- por kitchen_orders. Eso no funcionaba para recibos sin order_id (resto de
-- factura) ni para los creados en modo sin_stock (que antes no tenían gasto).
-- Con esta columna el recibo guarda su propio ID de gasto de Fudo y el PATCH
-- puede usarlo directamente, sin join.
-- ---------------------------------------------------------------------------

ALTER TABLE public.stock_receipts ADD COLUMN IF NOT EXISTS fudo_expense_id TEXT;

-- Nuevo tipo en la cola de reintentos: 'crear_gasto' para cuando Fudo falla
-- al crear el gasto (antes solo se reintentaba el pago, no la creación).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.fudo_reintentos'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%tipo%'
  LOOP
    EXECUTE 'ALTER TABLE public.fudo_reintentos DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE public.fudo_reintentos
  ADD CONSTRAINT fudo_reintentos_tipo_check
  CHECK (tipo IN ('stock_delta', 'pago_gasto', 'crear_gasto'));
