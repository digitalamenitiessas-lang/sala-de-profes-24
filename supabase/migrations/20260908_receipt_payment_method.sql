-- Medio de pago del recibo de compra:
--   efectivo | transferencia | tarjeta | cuenta_corriente
-- Si es cuenta_corriente → payment_status queda 'a_pagar' (aparece en /pedidos/cuentas).
-- Si es otro → payment_status queda 'pagado'.
ALTER TABLE stock_receipts
  ADD COLUMN IF NOT EXISTS payment_method TEXT
    CHECK (payment_method IN ('efectivo', 'transferencia', 'tarjeta', 'cuenta_corriente'));
