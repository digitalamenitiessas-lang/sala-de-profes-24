-- Link suppliers to Fudo providers for bidirectional sync
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS fudo_provider_id text;
CREATE INDEX IF NOT EXISTS idx_suppliers_fudo_provider ON suppliers (fudo_provider_id) WHERE fudo_provider_id IS NOT NULL;
