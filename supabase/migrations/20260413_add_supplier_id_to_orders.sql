-- Add supplier_id to kitchen_orders
ALTER TABLE kitchen_orders ADD COLUMN IF NOT EXISTS supplier_id bigint REFERENCES suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_supplier_id ON kitchen_orders(supplier_id);

-- Add supplier_id to bar_orders
ALTER TABLE bar_orders ADD COLUMN IF NOT EXISTS supplier_id bigint REFERENCES suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bar_orders_supplier_id ON bar_orders(supplier_id);
