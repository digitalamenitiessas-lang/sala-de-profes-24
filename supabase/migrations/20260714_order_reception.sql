-- ============================================================
-- Recepción de mercadería: campos para corroborar y cargar al stock
-- ============================================================

-- kitchen_orders: campos de recepción + link a stock_items
ALTER TABLE public.kitchen_orders
  ADD COLUMN IF NOT EXISTS stock_item_id uuid REFERENCES public.stock_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_qty  text,
  ADD COLUMN IF NOT EXISTS unit_cost     numeric,
  ADD COLUMN IF NOT EXISTS expires_at    date,
  ADD COLUMN IF NOT EXISTS received_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_at   timestamptz;

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_stock_item
  ON public.kitchen_orders (stock_item_id)
  WHERE stock_item_id IS NOT NULL;

-- bar_orders: mismos campos + link a stock_items (la tabla unificada, no bar_stock_items)
ALTER TABLE public.bar_orders
  ADD COLUMN IF NOT EXISTS stock_item_id uuid REFERENCES public.stock_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_qty  text,
  ADD COLUMN IF NOT EXISTS unit_cost     numeric,
  ADD COLUMN IF NOT EXISTS expires_at    date,
  ADD COLUMN IF NOT EXISTS received_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_at   timestamptz;

CREATE INDEX IF NOT EXISTS idx_bar_orders_stock_item
  ON public.bar_orders (stock_item_id)
  WHERE stock_item_id IS NOT NULL;

-- stock_movements: agregar columna note para descripción del movimiento
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS note text;

-- stock_items: campo last_counted_at para conteo programado
ALTER TABLE public.stock_items
  ADD COLUMN IF NOT EXISTS last_counted_at timestamptz;
