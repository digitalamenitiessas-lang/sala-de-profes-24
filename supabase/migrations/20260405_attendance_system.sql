-- =============================================================================
-- ATTENDANCE ANTI-FRAUD SYSTEM
-- =============================================================================
-- Sistema completo de fichaje con validación GPS, WiFi, selfie y device fingerprint.
-- Tablas: clock_events, device_registrations, attendance_anomalies,
--         attendance_corrections, wifi_access_points, attendance_config
-- RPCs, triggers, RLS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. attendance_config — configuración global del sistema
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  UUID REFERENCES auth.users(id)
);

-- Default configuration
INSERT INTO attendance_config (key, value) VALUES
  ('location', '{"lat": -26.8241, "lng": -65.2226, "radius_meters": 300, "name": "La Vieja Escuela - Santa Fe 746, Tucumán"}'),
  ('working_hours', '{"day_start": "06:00", "day_end": "22:00", "unusual_before": "05:00", "unusual_after": "23:30"}'),
  ('extra_hours', '{"daily_limit_hours": 8, "weekly_limit_hours": 48}'),
  ('rounding', '{"enabled": true, "minutes": 5}'),
  ('tolerance', '{"late_arrival_minutes": 10}'),
  ('anomaly_checks', '{"wifi": true, "gps": true, "device": true, "rapid_succession_seconds": 60, "unusual_hour": true}')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. wifi_access_points — APs válidos del local
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wifi_access_points (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                 TEXT NOT NULL,
  bssid                TEXT,
  ssid                 TEXT,
  location_description TEXT,
  is_active            BOOLEAN DEFAULT true,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  created_by           UUID REFERENCES auth.users(id)
);

-- ---------------------------------------------------------------------------
-- 3. clock_events — tabla principal de fichajes anti-trampa
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clock_events (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type         TEXT NOT NULL CHECK (event_type IN ('clock_in', 'clock_out')),
  timestamp          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- WiFi
  wifi_bssid         TEXT,
  wifi_ssid          TEXT,
  -- GPS
  gps_lat            DOUBLE PRECISION,
  gps_lng            DOUBLE PRECISION,
  gps_accuracy       REAL,
  -- Security
  selfie_url         TEXT,
  device_fingerprint TEXT,
  user_agent         TEXT,
  ip_address         TEXT,
  -- Validation
  verified           BOOLEAN DEFAULT false,
  anomaly_flags      JSONB DEFAULT '[]'::jsonb,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clock_events_employee_id ON clock_events(employee_id);
CREATE INDEX IF NOT EXISTS idx_clock_events_timestamp   ON clock_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_clock_events_type        ON clock_events(event_type);

-- ---------------------------------------------------------------------------
-- 4. device_registrations — dispositivos aprobados por empleado
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_registrations (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  user_agent         TEXT,
  device_name        TEXT,
  registered_at      TIMESTAMPTZ DEFAULT NOW(),
  is_active          BOOLEAN DEFAULT true,
  approved_by        UUID REFERENCES auth.users(id),
  approved_at        TIMESTAMPTZ,
  UNIQUE(employee_id, device_fingerprint)
);

-- ---------------------------------------------------------------------------
-- 5. attendance_anomalies — anomalías detectadas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_anomalies (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clock_event_id   UUID NOT NULL REFERENCES clock_events(id) ON DELETE CASCADE,
  employee_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  anomaly_type     TEXT NOT NULL CHECK (anomaly_type IN (
    'wifi_mismatch', 'gps_out_of_range', 'unknown_device',
    'selfie_missing', 'rapid_succession', 'unusual_hour'
  )),
  severity         TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  details          JSONB DEFAULT '{}'::jsonb,
  resolved         BOOLEAN DEFAULT false,
  resolved_by      UUID REFERENCES auth.users(id),
  resolved_at      TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomalies_employee    ON attendance_anomalies(employee_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_unresolved  ON attendance_anomalies(resolved) WHERE resolved = false;

-- ---------------------------------------------------------------------------
-- 6. attendance_corrections — solicitudes de corrección
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_corrections (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_event_id UUID REFERENCES clock_events(id),
  correction_type   TEXT NOT NULL CHECK (correction_type IN ('add_missing', 'change_time', 'remove_event')),
  old_value         JSONB,
  new_value         JSONB NOT NULL,
  reason            TEXT NOT NULL,
  requested_by      UUID NOT NULL REFERENCES auth.users(id),
  approved_by       UUID REFERENCES auth.users(id),
  approved_at       TIMESTAMPTZ,
  status            TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 7. RPC: get_current_attendance_status(p_employee_id)
--    Returns the current state: 'clocked_in' | 'clocked_out' | 'no_record'
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_current_attendance_status(p_employee_id UUID)
RETURNS TABLE (
  status          TEXT,
  last_event_id   UUID,
  last_event_type TEXT,
  last_event_time TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN ce.event_type = 'clock_in'  THEN 'clocked_in'
      WHEN ce.event_type = 'clock_out' THEN 'clocked_out'
      ELSE 'no_record'
    END AS status,
    ce.id AS last_event_id,
    ce.event_type AS last_event_type,
    ce.timestamp AS last_event_time
  FROM clock_events ce
  WHERE ce.employee_id = p_employee_id
  ORDER BY ce.timestamp DESC
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 8. RPC: calculate_employee_hours(p_employee_id, p_from, p_to)
--    Calcula horas normales, nocturnas y extras para un período.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_employee_hours(
  p_employee_id UUID,
  p_from        DATE,
  p_to          DATE
)
RETURNS TABLE (
  total_hours    NUMERIC,
  normal_hours   NUMERIC,
  nocturnal_hours NUMERIC,
  extra_hours    NUMERIC,
  days_worked    INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
WITH pairs AS (
  -- Match each clock_in with its next clock_out
  SELECT
    ci.id          AS ci_id,
    ci.timestamp   AS t_in,
    (ci.timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS work_date,
    (
      SELECT MIN(co.timestamp)
      FROM clock_events co
      WHERE co.employee_id = p_employee_id
        AND co.event_type  = 'clock_out'
        AND co.timestamp   > ci.timestamp
    ) AS t_out
  FROM clock_events ci
  WHERE ci.employee_id = p_employee_id
    AND ci.event_type  = 'clock_in'
    AND (ci.timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_from AND p_to
),
closed AS (
  SELECT * FROM pairs WHERE t_out IS NOT NULL
),
with_hours AS (
  SELECT
    work_date,
    ROUND(EXTRACT(EPOCH FROM (t_out - t_in)) / 3600.0, 4) AS total_h,
    -- Normal hours: intersection with day's 06:00-22:00 (local time)
    GREATEST(0.0,
      EXTRACT(EPOCH FROM (
        LEAST(t_out,
          (work_date::TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires') + INTERVAL '22 hours'
        ) -
        GREATEST(t_in,
          (work_date::TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires') + INTERVAL '6 hours'
        )
      )) / 3600.0
    )
    -- Add next-day normal hours if shift crosses midnight
    + CASE
        WHEN t_out > ((work_date + 1)::TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')
        THEN GREATEST(0.0,
          EXTRACT(EPOCH FROM (
            LEAST(t_out,
              ((work_date + 1)::TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires') + INTERVAL '22 hours'
            ) -
            GREATEST(
              ((work_date + 1)::TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires') + INTERVAL '6 hours',
              ((work_date + 1)::TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')
            )
          )) / 3600.0
        )
        ELSE 0.0
      END AS normal_h
  FROM closed
),
per_day AS (
  SELECT work_date, SUM(total_h) AS day_total
  FROM with_hours
  GROUP BY work_date
)
SELECT
  ROUND(COALESCE(SUM(wh.total_h), 0)::NUMERIC, 2)                                       AS total_hours,
  ROUND(COALESCE(SUM(LEAST(wh.normal_h, wh.total_h)), 0)::NUMERIC, 2)                   AS normal_hours,
  ROUND(COALESCE(SUM(wh.total_h) - SUM(LEAST(wh.normal_h, wh.total_h)), 0)::NUMERIC, 2) AS nocturnal_hours,
  ROUND(COALESCE(SUM(GREATEST(0.0, pd.day_total - 8.0)), 0)::NUMERIC, 2)                AS extra_hours,
  COUNT(DISTINCT wh.work_date)::INTEGER                                                   AS days_worked
FROM with_hours wh
JOIN per_day pd ON pd.work_date = wh.work_date;
$$;

-- ---------------------------------------------------------------------------
-- 9. RPC: attendance_dashboard(p_from, p_to)
--    Resumen general para el admin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION attendance_dashboard(p_from DATE, p_to DATE)
RETURNS TABLE (
  employee_id      UUID,
  first_name       TEXT,
  last_name        TEXT,
  role             TEXT,
  is_currently_in  BOOLEAN,
  last_event_time  TIMESTAMPTZ,
  days_worked      BIGINT,
  total_hours      NUMERIC,
  open_anomalies   BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
SELECT
  p.id                AS employee_id,
  p.first_name,
  p.last_name,
  p.role::TEXT,
  -- Is currently clocked in?
  COALESCE((
    SELECT ce.event_type = 'clock_in'
    FROM clock_events ce
    WHERE ce.employee_id = p.id
    ORDER BY ce.timestamp DESC
    LIMIT 1
  ), false)           AS is_currently_in,
  -- Last event time
  (
    SELECT ce.timestamp
    FROM clock_events ce
    WHERE ce.employee_id = p.id
    ORDER BY ce.timestamp DESC
    LIMIT 1
  )                   AS last_event_time,
  -- Days worked in range
  (
    SELECT COUNT(DISTINCT (ce.timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)
    FROM clock_events ce
    WHERE ce.employee_id = p.id
      AND ce.event_type = 'clock_in'
      AND (ce.timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_from AND p_to
  )                   AS days_worked,
  -- Approximate total hours (will use calculate_employee_hours for detail)
  COALESCE((
    SELECT SUM(EXTRACT(EPOCH FROM (
      COALESCE(
        (SELECT MIN(co.timestamp) FROM clock_events co
         WHERE co.employee_id = p.id AND co.event_type = 'clock_out' AND co.timestamp > ci.timestamp),
        NOW()
      ) - ci.timestamp
    )) / 3600.0)
    FROM clock_events ci
    WHERE ci.employee_id = p.id
      AND ci.event_type = 'clock_in'
      AND (ci.timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_from AND p_to
  ), 0.0)::NUMERIC    AS total_hours,
  -- Open anomalies
  (
    SELECT COUNT(*) FROM attendance_anomalies an
    WHERE an.employee_id = p.id AND an.resolved = false
  )                   AS open_anomalies
FROM profiles p
WHERE p.is_active = true
ORDER BY p.first_name, p.last_name;
$$;

-- ---------------------------------------------------------------------------
-- 10. RLS Policies
-- ---------------------------------------------------------------------------

-- clock_events
ALTER TABLE clock_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Empleados ven sus propios eventos"
  ON clock_events FOR SELECT
  USING (employee_id = auth.uid());

CREATE POLICY "Admins ven todos los eventos"
  ON clock_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('socio', 'encargado')
    )
  );

CREATE POLICY "Empleados insertan sus propios eventos"
  ON clock_events FOR INSERT
  WITH CHECK (employee_id = auth.uid());

-- attendance_anomalies
ALTER TABLE attendance_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Empleados ven sus anomalias"
  ON attendance_anomalies FOR SELECT
  USING (employee_id = auth.uid());

CREATE POLICY "Admins ven todas las anomalias"
  ON attendance_anomalies FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('socio', 'encargado'))
  );

CREATE POLICY "API inserta anomalias"
  ON attendance_anomalies FOR INSERT
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "Admins resuelven anomalias"
  ON attendance_anomalies FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('socio', 'encargado'))
  );

-- attendance_corrections
ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Empleados ven sus correcciones"
  ON attendance_corrections FOR SELECT
  USING (employee_id = auth.uid() OR requested_by = auth.uid());

CREATE POLICY "Admins ven todas las correcciones"
  ON attendance_corrections FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('socio', 'encargado'))
  );

CREATE POLICY "Cualquiera puede pedir correccion"
  ON attendance_corrections FOR INSERT
  WITH CHECK (requested_by = auth.uid());

CREATE POLICY "Admins aprueban correcciones"
  ON attendance_corrections FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('socio', 'encargado'))
  );

-- device_registrations
ALTER TABLE device_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Empleados ven sus dispositivos"
  ON device_registrations FOR SELECT
  USING (employee_id = auth.uid());

CREATE POLICY "Admins ven todos los dispositivos"
  ON device_registrations FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('socio', 'encargado'))
  );

CREATE POLICY "Empleados registran sus dispositivos"
  ON device_registrations FOR INSERT
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "Admins gestionan dispositivos"
  ON device_registrations FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('socio', 'encargado'))
  );

CREATE POLICY "Admins eliminan dispositivos"
  ON device_registrations FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('socio', 'encargado'))
  );

-- wifi_access_points
ALTER TABLE wifi_access_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos pueden ver APs"
  ON wifi_access_points FOR SELECT
  USING (true);

CREATE POLICY "Admins gestionan APs"
  ON wifi_access_points FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('socio', 'encargado'))
  );

-- attendance_config
ALTER TABLE attendance_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos pueden leer config"
  ON attendance_config FOR SELECT
  USING (true);

CREATE POLICY "Admins actualizan config"
  ON attendance_config FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('socio', 'encargado'))
  );

-- ---------------------------------------------------------------------------
-- 11. Storage bucket for selfies (run separately or via Supabase dashboard)
-- ---------------------------------------------------------------------------
-- INSERT INTO storage.buckets (id, name, public) VALUES ('attendance-selfies', 'attendance-selfies', false)
-- ON CONFLICT DO NOTHING;
