-- ===========================================================================
-- SECURE ATTENDANCE SYSTEM — Anti-Fraud Fichaje
-- ===========================================================================
-- Adds geolocation, selfie, device fingerprint, anomaly detection
-- to the existing attendance_logs system.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions for server-side distance calculation
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- ---------------------------------------------------------------------------
-- 1. Add security columns to attendance_logs
-- ---------------------------------------------------------------------------
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_lat        numeric;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_lng        numeric;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_accuracy   numeric;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_lat       numeric;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_lng       numeric;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_accuracy  numeric;

ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_selfie_url  text;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_selfie_url text;

ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS device_fingerprint  text;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS network_ip          text;

ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS is_suspicious       boolean DEFAULT false;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS suspicious_reasons  text[]  DEFAULT '{}';

ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_type       text DEFAULT 'manual';
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_type      text DEFAULT 'manual';

ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS edited_by           uuid REFERENCES profiles(id);
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS edit_reason         text;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS original_clock_in   timestamptz;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS original_clock_out  timestamptz;

-- ---------------------------------------------------------------------------
-- 2. App Settings (key-value config)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES profiles(id)
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_read" ON app_settings
  FOR SELECT USING (true);

CREATE POLICY "app_settings_write" ON app_settings
  FOR ALL USING (auth_role() IN ('socio'))
  WITH CHECK (auth_role() IN ('socio'));

-- Seed attendance settings (Santa Fe 746, San Miguel de Tucumán)
INSERT INTO app_settings (key, value) VALUES
  ('attendance_location', '{"lat": -26.8241, "lng": -65.2226, "radius_meters": 150}'::jsonb),
  ('attendance_config', '{"require_selfie": true, "require_geo": true, "max_shift_hours": 14, "alert_new_device": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Device Registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_registry (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES profiles(id),
  fingerprint    text NOT NULL,
  device_label   text,           -- e.g. "iPhone Safari", auto-detected
  is_trusted     boolean DEFAULT false,
  first_seen_at  timestamptz DEFAULT now(),
  last_seen_at   timestamptz DEFAULT now(),
  UNIQUE(user_id, fingerprint)
);

ALTER TABLE device_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "device_registry_own" ON device_registry
  FOR ALL USING (user_id = auth.uid() OR auth_role() IN ('socio', 'encargado'))
  WITH CHECK (user_id = auth.uid() OR auth_role() IN ('socio', 'encargado'));

-- ---------------------------------------------------------------------------
-- 4. Anomaly Detection Function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_attendance_anomalies(
  p_log_id  uuid,
  p_event   text  -- 'clock_in' or 'clock_out'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log          attendance_logs%ROWTYPE;
  v_reasons      text[] := '{}';
  v_is_suspicious boolean := false;
  v_config       jsonb;
  v_location     jsonb;
  v_lat          numeric;
  v_lng          numeric;
  v_distance_m   numeric;
  v_radius       numeric;
  v_hours        numeric;
  v_device_count int;
BEGIN
  SELECT * INTO v_log FROM attendance_logs WHERE id = p_log_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_suspicious', false, 'reasons', '[]'::jsonb);
  END IF;

  -- Load settings
  SELECT value INTO v_location FROM app_settings WHERE key = 'attendance_location';
  SELECT value INTO v_config   FROM app_settings WHERE key = 'attendance_config';

  v_radius := COALESCE((v_location->>'radius_meters')::numeric, 150);

  -- CHECK 1: Geolocation distance
  IF p_event = 'clock_in' AND v_log.clock_in_lat IS NOT NULL AND v_location IS NOT NULL THEN
    v_lat := (v_location->>'lat')::numeric;
    v_lng := (v_location->>'lng')::numeric;
    v_distance_m := earth_distance(
      ll_to_earth(v_lat, v_lng),
      ll_to_earth(v_log.clock_in_lat, v_log.clock_in_lng)
    );
    IF v_distance_m > v_radius THEN
      v_reasons := array_append(v_reasons, format('geo_fuera_rango:%sm', round(v_distance_m)));
      v_is_suspicious := true;
    END IF;
  ELSIF p_event = 'clock_in' AND v_log.clock_in_lat IS NULL AND COALESCE((v_config->>'require_geo')::boolean, false) THEN
    v_reasons := array_append(v_reasons, 'sin_geolocalizacion_ingreso');
    v_is_suspicious := true;
  END IF;

  IF p_event = 'clock_out' AND v_log.clock_out_lat IS NOT NULL AND v_location IS NOT NULL THEN
    v_lat := (v_location->>'lat')::numeric;
    v_lng := (v_location->>'lng')::numeric;
    v_distance_m := earth_distance(
      ll_to_earth(v_lat, v_lng),
      ll_to_earth(v_log.clock_out_lat, v_log.clock_out_lng)
    );
    IF v_distance_m > v_radius THEN
      v_reasons := array_append(v_reasons, format('geo_fuera_rango_egreso:%sm', round(v_distance_m)));
      v_is_suspicious := true;
    END IF;
  END IF;

  -- CHECK 2: Shift duration (on clock_out only)
  IF p_event = 'clock_out' AND v_log.clock_out_at IS NOT NULL THEN
    v_hours := EXTRACT(EPOCH FROM (v_log.clock_out_at - v_log.clock_in_at)) / 3600.0;
    IF v_hours > COALESCE((v_config->>'max_shift_hours')::numeric, 14) THEN
      v_reasons := array_append(v_reasons, format('jornada_excedida:%sh', round(v_hours, 1)));
      v_is_suspicious := true;
    END IF;
  END IF;

  -- CHECK 3: New/unknown device
  IF v_log.device_fingerprint IS NOT NULL AND COALESCE((v_config->>'alert_new_device')::boolean, true) THEN
    SELECT COUNT(*) INTO v_device_count
    FROM device_registry
    WHERE user_id = v_log.user_id AND fingerprint = v_log.device_fingerprint;

    IF v_device_count = 0 THEN
      -- Auto-register the device
      INSERT INTO device_registry (user_id, fingerprint, is_trusted)
      VALUES (v_log.user_id, v_log.device_fingerprint, false)
      ON CONFLICT (user_id, fingerprint) DO UPDATE SET last_seen_at = now();
      v_reasons := array_append(v_reasons, 'dispositivo_nuevo');
      v_is_suspicious := true;
    ELSE
      UPDATE device_registry SET last_seen_at = now()
      WHERE user_id = v_log.user_id AND fingerprint = v_log.device_fingerprint;
    END IF;
  END IF;

  -- CHECK 4: Missing selfie
  IF p_event = 'clock_in' AND v_log.clock_in_selfie_url IS NULL AND COALESCE((v_config->>'require_selfie')::boolean, false) THEN
    v_reasons := array_append(v_reasons, 'sin_selfie_ingreso');
    v_is_suspicious := true;
  END IF;
  IF p_event = 'clock_out' AND v_log.clock_out_selfie_url IS NULL AND COALESCE((v_config->>'require_selfie')::boolean, false) THEN
    v_reasons := array_append(v_reasons, 'sin_selfie_egreso');
    v_is_suspicious := true;
  END IF;

  -- Update the log
  IF v_is_suspicious THEN
    UPDATE attendance_logs
    SET is_suspicious     = true,
        suspicious_reasons = COALESCE(suspicious_reasons, '{}') || v_reasons
    WHERE id = p_log_id;
  END IF;

  RETURN jsonb_build_object(
    'is_suspicious', v_is_suspicious,
    'reasons', to_jsonb(v_reasons)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Replace clock_in RPC — with security params
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION clock_in(
  p_notes             text     DEFAULT NULL,
  p_lat               numeric  DEFAULT NULL,
  p_lng               numeric  DEFAULT NULL,
  p_accuracy          numeric  DEFAULT NULL,
  p_selfie_url        text     DEFAULT NULL,
  p_device_fingerprint text    DEFAULT NULL,
  p_network_ip        text     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_today      date := CURRENT_DATE;
  v_existing   uuid;
  v_new_id     uuid;
  v_anomaly    jsonb;
  v_orphan     record;
BEGIN
  -- Check if already clocked in today
  SELECT id INTO v_existing
  FROM attendance_logs
  WHERE user_id = v_uid AND operative_date = v_today AND status = 'open';

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ya tenés un ingreso abierto hoy');
  END IF;

  -- Force-close orphan logs from previous days
  FOR v_orphan IN
    SELECT id FROM attendance_logs
    WHERE user_id = v_uid AND status = 'open' AND operative_date < v_today
  LOOP
    UPDATE attendance_logs
    SET status        = 'missing_checkout',
        clock_out_at  = clock_in_at + interval '8 hours',  -- default 8h
        clock_out_type = 'auto_orphan',
        notes         = COALESCE(notes, '') || ' [Auto-cerrado por nuevo ingreso]'
    WHERE id = v_orphan.id;
  END LOOP;

  -- Insert new attendance log
  INSERT INTO attendance_logs (
    user_id, operative_date, clock_in_at, status, notes,
    clock_in_lat, clock_in_lng, clock_in_accuracy,
    clock_in_selfie_url, device_fingerprint, network_ip,
    clock_in_type
  ) VALUES (
    v_uid, v_today, now(), 'open', p_notes,
    p_lat, p_lng, p_accuracy,
    p_selfie_url, p_device_fingerprint, p_network_ip,
    'manual'
  )
  RETURNING id INTO v_new_id;

  -- Run anomaly detection
  v_anomaly := check_attendance_anomalies(v_new_id, 'clock_in');

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_new_id,
    'clock_in_at', now(),
    'anomaly', v_anomaly
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Replace clock_out RPC — with security params
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION clock_out(
  p_notes             text     DEFAULT NULL,
  p_lat               numeric  DEFAULT NULL,
  p_lng               numeric  DEFAULT NULL,
  p_accuracy          numeric  DEFAULT NULL,
  p_selfie_url        text     DEFAULT NULL,
  p_device_fingerprint text    DEFAULT NULL,
  p_network_ip        text     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_today    date := CURRENT_DATE;
  v_log_id   uuid;
  v_clock_in timestamptz;
  v_hours    numeric;
  v_anomaly  jsonb;
BEGIN
  -- Find today's open log
  SELECT id, clock_in_at INTO v_log_id, v_clock_in
  FROM attendance_logs
  WHERE user_id = v_uid AND operative_date = v_today AND status = 'open';

  IF v_log_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No tenés un ingreso abierto hoy');
  END IF;

  -- Calculate hours
  v_hours := EXTRACT(EPOCH FROM (now() - v_clock_in)) / 3600.0;

  -- Update the log
  UPDATE attendance_logs SET
    clock_out_at       = now(),
    status             = 'closed',
    notes              = COALESCE(p_notes, notes),
    clock_out_lat      = p_lat,
    clock_out_lng      = p_lng,
    clock_out_accuracy = p_accuracy,
    clock_out_selfie_url = p_selfie_url,
    clock_out_type     = 'manual'
  WHERE id = v_log_id;

  -- Run anomaly detection
  v_anomaly := check_attendance_anomalies(v_log_id, 'clock_out');

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'clock_out_at', now(),
    'hours_worked', round(v_hours, 2),
    'anomaly', v_anomaly
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Index for suspicious queries
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_attendance_suspicious
  ON attendance_logs (is_suspicious)
  WHERE is_suspicious = true;

CREATE INDEX IF NOT EXISTS idx_attendance_operative_date
  ON attendance_logs (operative_date DESC);
