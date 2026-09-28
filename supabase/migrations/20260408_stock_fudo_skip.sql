-- Add fudo_skip column to stock_items
-- Items marked fudo_skip=true are local-only and won't attempt Fudo sync
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS fudo_skip boolean NOT NULL DEFAULT false;
