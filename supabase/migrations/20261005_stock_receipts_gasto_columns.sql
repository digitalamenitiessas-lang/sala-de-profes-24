-- Datos del gasto en cada recibo de compra (stock_receipts)
-- Al confirmar una compra (llegó / llegó todo) se elige la categoría del gasto
-- y el comprobante. Categoría, tipo y número van también a Fudo; iva e iibb
-- (factura A) solo quedan en Sala de Profes: la API de Fudo no permite cargar
-- impuestos en un gasto.
--
-- Solo AGREGA columnas, todas opcionales: no toca datos existentes.
-- Se puede correr más de una vez.

ALTER TABLE public.stock_receipts
  ADD COLUMN IF NOT EXISTS expense_category_id   text,
  ADD COLUMN IF NOT EXISTS expense_category_name text,
  ADD COLUMN IF NOT EXISTS comprobante_tipo      text,
  ADD COLUMN IF NOT EXISTS comprobante_numero    text,
  ADD COLUMN IF NOT EXISTS iva                   numeric(14,2),
  ADD COLUMN IF NOT EXISTS iibb                  numeric(14,2);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_receipts_comprobante_tipo_check'
  ) THEN
    ALTER TABLE public.stock_receipts
      ADD CONSTRAINT stock_receipts_comprobante_tipo_check
      CHECK (comprobante_tipo IS NULL OR comprobante_tipo IN (
        'sin_comprobante', 'ticket', 'factura_a', 'factura_b', 'factura_c'
      ));
  END IF;
END $$;

COMMENT ON COLUMN public.stock_receipts.expense_category_id   IS 'Id de la categoría de gasto en Fudo (ExpenseCategory)';
COMMENT ON COLUMN public.stock_receipts.expense_category_name IS 'Nombre de la categoría de gasto (para mostrar sin llamar a Fudo)';
COMMENT ON COLUMN public.stock_receipts.comprobante_tipo      IS 'Tipo de comprobante: sin_comprobante | ticket | factura_a | factura_b | factura_c';
COMMENT ON COLUMN public.stock_receipts.comprobante_numero    IS 'Número del comprobante (ej: 0001-00012345)';
COMMENT ON COLUMN public.stock_receipts.iva                   IS 'IVA de la factura A. En compras de varios productos va solo en el primer recibo del lote.';
COMMENT ON COLUMN public.stock_receipts.iibb                  IS 'IIBB de la factura A. En compras de varios productos va solo en el primer recibo del lote.';

-- Para "última categoría usada con este proveedor"
CREATE INDEX IF NOT EXISTS stock_receipts_supplier_categoria
  ON public.stock_receipts (supplier_id, id DESC)
  WHERE expense_category_id IS NOT NULL;
