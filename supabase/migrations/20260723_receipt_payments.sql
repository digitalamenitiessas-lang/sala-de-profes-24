-- ---------------------------------------------------------------------------
-- Gastos de compras — estado de pago por recepción.
-- Cada stock_receipt registra si se pagó al recibir ('pagado') o quedó
-- pendiente ('a_pagar'). Los pendientes se saldan después desde
-- /pedidos/cuentas (cuentas por proveedor).
-- Aplicada en producción el 2026-07-23 vía Management API.
-- ---------------------------------------------------------------------------

alter table public.stock_receipts
  add column if not exists payment_status text not null default 'a_pagar'
    check (payment_status in ('pagado', 'a_pagar'));

alter table public.stock_receipts
  add column if not exists paid_at timestamptz;

alter table public.stock_receipts
  add column if not exists paid_by uuid references public.profiles(id);
