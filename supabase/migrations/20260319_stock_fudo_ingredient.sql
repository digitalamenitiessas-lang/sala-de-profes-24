-- Link stock_items to Fudo ingredients for bidirectional sync
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS fudo_ingredient_id text;
CREATE INDEX IF NOT EXISTS idx_stock_items_fudo_ingredient ON stock_items (fudo_ingredient_id) WHERE fudo_ingredient_id IS NOT NULL;
