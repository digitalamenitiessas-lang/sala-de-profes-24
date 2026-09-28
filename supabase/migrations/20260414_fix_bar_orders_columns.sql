-- Add bar_stock_item_id to bar_orders (referenced by barra page but missing from DB)
ALTER TABLE bar_orders ADD COLUMN IF NOT EXISTS bar_stock_item_id bigint REFERENCES bar_stock_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bar_orders_bar_stock_item_id ON bar_orders(bar_stock_item_id);
