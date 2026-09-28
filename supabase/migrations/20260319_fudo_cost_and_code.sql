-- Add cost_price and fudo_code columns to menu_items
-- cost_price: cost from Fudo (for margin calculation)
-- fudo_code: product code from Fudo POS
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS fudo_code text;
