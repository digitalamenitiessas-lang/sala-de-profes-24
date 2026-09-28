-- ===========================================================================
-- WEB PUSH SUBSCRIPTIONS
-- ===========================================================================
-- Persiste una suscripción por endpoint para evitar fugas entre usuarios
-- en dispositivos compartidos y permite reasignar la suscripción al loguearse.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   text PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  keys       jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DELETE FROM push_subscriptions
WHERE endpoint IS NULL
   OR user_id IS NULL
   OR keys IS NULL;

WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY endpoint
      ORDER BY updated_at DESC, created_at DESC
    ) AS row_num
  FROM push_subscriptions
)
DELETE FROM push_subscriptions p
USING ranked r
WHERE p.ctid = r.ctid
  AND r.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_idx
  ON push_subscriptions(endpoint);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON push_subscriptions(user_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions_select_own" ON push_subscriptions;
CREATE POLICY "push_subscriptions_select_own" ON push_subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subscriptions_insert_own" ON push_subscriptions;
CREATE POLICY "push_subscriptions_insert_own" ON push_subscriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subscriptions_update_own" ON push_subscriptions;
CREATE POLICY "push_subscriptions_update_own" ON push_subscriptions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subscriptions_delete_own" ON push_subscriptions;
CREATE POLICY "push_subscriptions_delete_own" ON push_subscriptions
  FOR DELETE
  USING (auth.uid() = user_id);
