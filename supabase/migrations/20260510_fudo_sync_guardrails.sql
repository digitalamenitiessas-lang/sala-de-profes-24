-- ============================================================
-- Fudo sync guardrails
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One row per relevant Fudo operation. This is the audit/event ledger used by
-- UI, chatbot and cron to decide if stock is safe to write.
CREATE TABLE IF NOT EXISTS public.fudo_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('fudo_to_lve', 'lve_to_fudo', 'read')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'skipped')),
  entity_type text,
  entity_id text,
  stock_item_id text,
  fudo_type text CHECK (fudo_type IS NULL OR fudo_type IN ('ingredient', 'product', 'sale', 'provider')),
  fudo_id text,
  idempotency_key text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb,
  error_message text,
  attempts integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fudo_sync_events_idempotency
  ON public.fudo_sync_events (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_fudo_sync_events_status
  ON public.fudo_sync_events (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fudo_sync_events_stock_item
  ON public.fudo_sync_events (stock_item_id, created_at DESC)
  WHERE stock_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fudo_sync_events_fudo
  ON public.fudo_sync_events (fudo_type, fudo_id)
  WHERE fudo_id IS NOT NULL;

-- Persistent incidents created from Fudo audit/sync results.
CREATE TABLE IF NOT EXISTS public.fudo_sync_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'audit',
  code text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  entity_type text,
  entity_id text,
  stock_item_id text,
  fudo_type text CHECK (fudo_type IS NULL OR fudo_type IN ('ingredient', 'product', 'sale', 'provider')),
  fudo_id text,
  incident_key text NOT NULL,
  title text NOT NULL,
  detail text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fudo_sync_incidents_key
  ON public.fudo_sync_incidents (incident_key);

CREATE INDEX IF NOT EXISTS idx_fudo_sync_incidents_status
  ON public.fudo_sync_incidents (status, severity, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_fudo_sync_incidents_stock_item
  ON public.fudo_sync_incidents (stock_item_id, status)
  WHERE stock_item_id IS NOT NULL;

-- Fudo sales must be deduped by sale item id, not only ticket+product. The old
-- unique constraint drops repeated products inside the same ticket.
ALTER TABLE public.fudo_sales
  ADD COLUMN IF NOT EXISTS fudo_sale_item_id text;

ALTER TABLE public.fudo_sales
  DROP CONSTRAINT IF EXISTS fudo_sales_fudo_ticket_id_fudo_product_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fudo_sales_sale_item
  ON public.fudo_sales (fudo_sale_item_id)
  WHERE fudo_sale_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fudo_sales_ticket
  ON public.fudo_sales (fudo_ticket_id);

-- Hard guardrails: one Fudo entity can map to one active LVE stock item only.
-- If this migration fails here, fix duplicates before continuing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_items_fudo_ingredient_active
  ON public.stock_items (fudo_ingredient_id)
  WHERE fudo_ingredient_id IS NOT NULL
    AND is_active = true
    AND COALESCE(fudo_skip, false) = false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_items_fudo_product_active
  ON public.stock_items (fudo_product_id)
  WHERE fudo_product_id IS NOT NULL
    AND is_active = true
    AND COALESCE(fudo_skip, false) = false;

ALTER TABLE public.fudo_sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fudo_sync_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_fudo_sync_events" ON public.fudo_sync_events;
CREATE POLICY "read_fudo_sync_events" ON public.fudo_sync_events
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service_manage_fudo_sync_events" ON public.fudo_sync_events;
CREATE POLICY "service_manage_fudo_sync_events" ON public.fudo_sync_events
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('socio', 'encargado', 'chef')
    )
  );

DROP POLICY IF EXISTS "read_fudo_sync_incidents" ON public.fudo_sync_incidents;
CREATE POLICY "read_fudo_sync_incidents" ON public.fudo_sync_incidents
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service_manage_fudo_sync_incidents" ON public.fudo_sync_incidents;
CREATE POLICY "service_manage_fudo_sync_incidents" ON public.fudo_sync_incidents
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('socio', 'encargado', 'chef')
    )
  );
