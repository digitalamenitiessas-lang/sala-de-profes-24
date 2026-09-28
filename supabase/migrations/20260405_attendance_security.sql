-- ============================================================================
-- MIGRACIÓN: Sistema de fichaje seguro anti-trampa
-- Fecha: 2026-04-05
-- ============================================================================

-- ============================================================================
-- 1) Columnas de seguridad en attendance_logs
-- ============================================================================

ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS photo_url        text,
  ADD COLUMN IF NOT EXISTS geo_lat          numeric(10,7),
  ADD COLUMN IF NOT EXISTS geo_lng          numeric(10,7),
  ADD COLUMN IF NOT EXISTS geo_accuracy     numeric(8,2),
  ADD COLUMN IF NOT EXISTS geo_verified     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS geo_distance_m   numeric(8,1),
  ADD COLUMN IF NOT EXISTS wifi_ssid        text,
  ADD COLUMN IF NOT EXISTS wifi_verified    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS device_id        text,
  ADD COLUMN IF NOT EXISTS device_info      jsonb,
  ADD COLUMN IF NOT EXISTS ip_address       text,
  ADD COLUMN IF NOT EXISTS is_suspicious    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspicious_reasons text[],
  ADD COLUMN IF NOT EXISTS edited_reason    text,
  ADD COLUMN IF NOT EXISTS clock_out_type   text,
  ADD COLUMN IF NOT EXISTS edited_by        uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS original_clock_out timestamptz,
  ADD COLUMN IF NOT EXISTS clock_in_photo_url  text,
  ADD COLUMN IF NOT EXISTS clock_out_photo_url text;

-- ============================================================================
-- 2) Tabla de configuración del local (geo + WiFi autorizados)
-- ============================================================================

CREATE TABLE IF NOT EXISTS venue_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_lat       numeric(10,7) NOT NULL DEFAULT -26.8241000,
  venue_lng       numeric(10,7) NOT NULL DEFAULT -65.2226000,
  geo_radius_m    integer NOT NULL DEFAULT 150,
  allowed_ssids   text[] NOT NULL DEFAULT ARRAY[]::text[],
  allowed_ips     text[] NOT NULL DEFAULT ARRAY[]::text[],
  require_photo   boolean NOT NULL DEFAULT true,
  require_geo     boolean NOT NULL DEFAULT true,
  require_wifi    boolean NOT NULL DEFAULT false,
  max_shift_hours integer NOT NULL DEFAULT 14,
  updated_at      timestamptz DEFAULT now(),
  updated_by      uuid REFERENCES profiles(id)
);

-- Insertar config por defecto del local (Santa Fe 746, SMT)
INSERT INTO venue_config (
  venue_lat, venue_lng, geo_radius_m,
  allowed_ssids, require_photo, require_geo, require_wifi
) VALUES (
  -26.8241000, -65.2226000, 150,
  ARRAY[]::text[], true, true, false
) ON CONFLICT DO NOTHING;

-- RLS venue_config: solo socio/encargado pueden editar
ALTER TABLE venue_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_config_read_all" ON venue_config
  FOR SELECT USING (true);

CREATE POLICY "venue_config_write_manager" ON venue_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('socio','encargado')
    )
  );

-- ============================================================================
-- 3) Registro de dispositivos autorizados por empleado
-- ============================================================================

CREATE TABLE IF NOT EXISTS attendance_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  device_id     text NOT NULL,
  device_name   text,
  device_info   jsonb,
  is_trusted    boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, device_id)
);

ALTER TABLE attendance_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "devices_read_own" ON attendance_devices
  FOR SELECT USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('socio','encargado')
  ));

CREATE POLICY "devices_insert_own" ON attendance_devices
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "devices_update_manager" ON attendance_devices
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('socio','encargado'))
  );

-- ============================================================================
-- 4) Log de auditoría de ediciones de fichaje
-- ============================================================================

CREATE TABLE IF NOT EXISTS attendance_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id        uuid NOT NULL REFERENCES attendance_logs(id) ON DELETE CASCADE,
  editor_id     uuid NOT NULL REFERENCES profiles(id),
  action        text NOT NULL, -- 'edit_clock_out', 'edit_clock_in', 'delete', 'add'
  reason        text NOT NULL,
  old_value     jsonb,
  new_value     jsonb,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE attendance_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_read_manager" ON attendance_audit
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('socio','encargado'))
  );

CREATE POLICY "audit_insert_server" ON attendance_audit
  FOR INSERT WITH CHECK (editor_id = auth.uid());

-- ============================================================================
-- 5) RPC: clock_in_secure — fichaje de entrada con validaciones
-- ============================================================================

CREATE OR REPLACE FUNCTION clock_in_secure(
  p_photo_url         text DEFAULT NULL,
  p_geo_lat           numeric DEFAULT NULL,
  p_geo_lng           numeric DEFAULT NULL,
  p_geo_accuracy      numeric DEFAULT NULL,
  p_wifi_ssid         text DEFAULT NULL,
  p_device_id         text DEFAULT NULL,
  p_device_info       jsonb DEFAULT NULL,
  p_ip_address        text DEFAULT NULL,
  p_notes             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_today       date;
  v_now         timestamptz;
  v_config      venue_config%ROWTYPE;
  v_existing    attendance_logs%ROWTYPE;
  v_log_id      uuid;
  v_geo_dist    numeric;
  v_geo_ok      boolean := false;
  v_wifi_ok     boolean := false;
  v_suspicious  boolean := false;
  v_reasons     text[] := ARRAY[]::text[];
  v_device_trusted boolean := true;
  v_tz          text := 'America/Argentina/Tucuman';
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  v_now   := now() AT TIME ZONE v_tz;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- Obtener config del local
  SELECT * INTO v_config FROM venue_config LIMIT 1;

  -- Verificar que no haya un ingreso abierto hoy
  SELECT * INTO v_existing
  FROM attendance_logs
  WHERE user_id = v_user_id
    AND operative_date = v_today
    AND clock_out_at IS NULL
    AND status = 'open'
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Ya tenés un ingreso abierto para hoy. Marcá el egreso primero.');
  END IF;

  -- ---- Verificación geolocalización ----
  IF p_geo_lat IS NOT NULL AND p_geo_lng IS NOT NULL AND v_config.venue_lat IS NOT NULL THEN
    -- Fórmula Haversine simplificada (precisión suficiente para <1km)
    v_geo_dist := round(
      6371000 * acos(
        LEAST(1.0, cos(radians(v_config.venue_lat)) * cos(radians(p_geo_lat))
        * cos(radians(p_geo_lng) - radians(v_config.venue_lng))
        + sin(radians(v_config.venue_lat)) * sin(radians(p_geo_lat)))
      )::numeric, 1
    );
    v_geo_ok := v_geo_dist <= v_config.geo_radius_m;
    IF NOT v_geo_ok THEN
      v_suspicious := true;
      v_reasons := array_append(v_reasons, format('Geolocalización fuera del rango: %sm del local', v_geo_dist));
    END IF;
  ELSE
    IF v_config.require_geo THEN
      v_suspicious := true;
      v_reasons := array_append(v_reasons, 'Geolocalización no proporcionada');
    END IF;
  END IF;

  -- ---- Verificación WiFi/SSID ----
  IF p_wifi_ssid IS NOT NULL AND array_length(v_config.allowed_ssids, 1) > 0 THEN
    v_wifi_ok := p_wifi_ssid = ANY(v_config.allowed_ssids);
    IF NOT v_wifi_ok THEN
      v_suspicious := true;
      v_reasons := array_append(v_reasons, format('Red WiFi no autorizada: %s', p_wifi_ssid));
    END IF;
  END IF;

  -- ---- Verificación foto ----
  IF v_config.require_photo AND (p_photo_url IS NULL OR p_photo_url = '') THEN
    v_suspicious := true;
    v_reasons := array_append(v_reasons, 'Selfie no proporcionada');
  END IF;

  -- ---- Verificación dispositivo ----
  IF p_device_id IS NOT NULL THEN
    -- Registrar/actualizar dispositivo
    INSERT INTO attendance_devices (user_id, device_id, device_info, device_name, last_seen_at)
    VALUES (v_user_id, p_device_id, p_device_info, p_device_info->>'userAgent', now())
    ON CONFLICT (user_id, device_id) DO UPDATE
      SET last_seen_at = now(),
          device_info  = EXCLUDED.device_info;

    -- Verificar si el dispositivo es conocido (primer uso = sospechoso levemente)
    SELECT is_trusted INTO v_device_trusted
    FROM attendance_devices
    WHERE user_id = v_user_id AND device_id = p_device_id;

    IF NOT COALESCE(v_device_trusted, true) THEN
      v_suspicious := true;
      v_reasons := array_append(v_reasons, 'Dispositivo marcado como no confiable');
    END IF;
  END IF;

  -- ---- Detectar jornadas previas sin cierre ----
  IF EXISTS (
    SELECT 1 FROM attendance_logs
    WHERE user_id = v_user_id
      AND operative_date < v_today
      AND status = 'open'
      AND clock_out_at IS NULL
  ) THEN
    v_suspicious := true;
    v_reasons := array_append(v_reasons, 'Tiene jornadas anteriores sin egreso registrado');
  END IF;

  -- ---- Insertar registro ----
  INSERT INTO attendance_logs (
    user_id, operative_date, clock_in_at, status,
    photo_url, clock_in_photo_url,
    geo_lat, geo_lng, geo_accuracy, geo_verified, geo_distance_m,
    wifi_ssid, wifi_verified,
    device_id, device_info, ip_address,
    is_suspicious, suspicious_reasons,
    notes
  ) VALUES (
    v_user_id, v_today, now(), 'open',
    p_photo_url, p_photo_url,
    p_geo_lat, p_geo_lng, p_geo_accuracy, v_geo_ok, v_geo_dist,
    p_wifi_ssid, v_wifi_ok,
    p_device_id, p_device_info, p_ip_address,
    v_suspicious, v_reasons,
    p_notes
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success',      true,
    'log_id',       v_log_id,
    'is_suspicious',v_suspicious,
    'geo_verified', v_geo_ok,
    'geo_distance', v_geo_dist,
    'wifi_verified',v_wifi_ok,
    'warnings',     v_reasons
  );
END;
$$;

-- ============================================================================
-- 6) RPC: clock_out_secure — fichaje de salida con validaciones
-- ============================================================================

CREATE OR REPLACE FUNCTION clock_out_secure(
  p_photo_url     text DEFAULT NULL,
  p_geo_lat       numeric DEFAULT NULL,
  p_geo_lng       numeric DEFAULT NULL,
  p_geo_accuracy  numeric DEFAULT NULL,
  p_wifi_ssid     text DEFAULT NULL,
  p_device_id     text DEFAULT NULL,
  p_device_info   jsonb DEFAULT NULL,
  p_ip_address    text DEFAULT NULL,
  p_notes         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_today       date;
  v_config      venue_config%ROWTYPE;
  v_log         attendance_logs%ROWTYPE;
  v_geo_dist    numeric;
  v_geo_ok      boolean := false;
  v_wifi_ok     boolean := false;
  v_suspicious  boolean := false;
  v_reasons     text[] := ARRAY[]::text[];
  v_hours       numeric;
  v_tz          text := 'America/Argentina/Tucuman';
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT * INTO v_config FROM venue_config LIMIT 1;

  -- Buscar ingreso abierto
  SELECT * INTO v_log
  FROM attendance_logs
  WHERE user_id = v_user_id
    AND operative_date = v_today
    AND clock_out_at IS NULL
    AND status = 'open'
  ORDER BY clock_in_at DESC
  LIMIT 1;

  IF v_log.id IS NULL THEN
    RETURN jsonb_build_object('error', 'No encontré un ingreso abierto para hoy. Primero marcá tu ingreso.');
  END IF;

  -- Cálculo de horas trabajadas
  v_hours := EXTRACT(EPOCH FROM (now() - v_log.clock_in_at)) / 3600.0;

  -- Detectar jornada inusualmente larga
  IF v_hours > v_config.max_shift_hours THEN
    v_suspicious := true;
    v_reasons := array_append(v_reasons, format('Jornada de %.1f horas (supera el máximo de %s horas)', v_hours, v_config.max_shift_hours));
  END IF;

  -- Verificación geo
  IF p_geo_lat IS NOT NULL AND p_geo_lng IS NOT NULL AND v_config.venue_lat IS NOT NULL THEN
    v_geo_dist := round(
      6371000 * acos(
        LEAST(1.0, cos(radians(v_config.venue_lat)) * cos(radians(p_geo_lat))
        * cos(radians(p_geo_lng) - radians(v_config.venue_lng))
        + sin(radians(v_config.venue_lat)) * sin(radians(p_geo_lat)))
      )::numeric, 1
    );
    v_geo_ok := v_geo_dist <= v_config.geo_radius_m;
    IF NOT v_geo_ok THEN
      v_suspicious := true;
      v_reasons := array_append(v_reasons, format('Egreso desde %sm del local', v_geo_dist));
    END IF;
  ELSE
    IF v_config.require_geo THEN
      v_suspicious := true;
      v_reasons := array_append(v_reasons, 'Geolocalización de egreso no proporcionada');
    END IF;
  END IF;

  -- Verificación WiFi
  IF p_wifi_ssid IS NOT NULL AND array_length(v_config.allowed_ssids, 1) > 0 THEN
    v_wifi_ok := p_wifi_ssid = ANY(v_config.allowed_ssids);
    IF NOT v_wifi_ok THEN
      v_suspicious := true;
      v_reasons := array_append(v_reasons, format('Egreso desde red WiFi no autorizada: %s', p_wifi_ssid));
    END IF;
  END IF;

  -- Verificación foto
  IF v_config.require_photo AND (p_photo_url IS NULL OR p_photo_url = '') THEN
    v_suspicious := true;
    v_reasons := array_append(v_reasons, 'Selfie de egreso no proporcionada');
  END IF;

  -- Combinar razones con las del ingreso
  v_suspicious := v_suspicious OR v_log.is_suspicious;
  v_reasons    := array_cat(COALESCE(v_log.suspicious_reasons, ARRAY[]::text[]), v_reasons);

  -- Actualizar registro
  UPDATE attendance_logs SET
    clock_out_at       = now(),
    clock_out_photo_url= p_photo_url,
    status             = 'closed',
    clock_out_type     = 'manual',
    geo_lat            = COALESCE(p_geo_lat, geo_lat),
    geo_lng            = COALESCE(p_geo_lng, geo_lng),
    geo_accuracy       = COALESCE(p_geo_accuracy, geo_accuracy),
    geo_verified       = v_geo_ok,
    geo_distance_m     = COALESCE(v_geo_dist, geo_distance_m),
    wifi_ssid          = COALESCE(p_wifi_ssid, wifi_ssid),
    wifi_verified      = v_wifi_ok,
    device_id          = COALESCE(p_device_id, device_id),
    device_info        = COALESCE(p_device_info, device_info),
    ip_address         = COALESCE(p_ip_address, ip_address),
    is_suspicious      = v_suspicious,
    suspicious_reasons = v_reasons,
    notes              = COALESCE(p_notes, notes)
  WHERE id = v_log.id;

  RETURN jsonb_build_object(
    'success',      true,
    'log_id',       v_log.id,
    'hours_worked', round(v_hours::numeric, 2),
    'is_suspicious',v_suspicious,
    'geo_verified', v_geo_ok,
    'wifi_verified',v_wifi_ok,
    'warnings',     v_reasons
  );
END;
$$;

-- ============================================================================
-- 7) Índices para consultas de alertas
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_attendance_suspicious
  ON attendance_logs(is_suspicious, operative_date DESC)
  WHERE is_suspicious = true;

CREATE INDEX IF NOT EXISTS idx_attendance_open
  ON attendance_logs(status, operative_date DESC)
  WHERE status = 'open';

-- ============================================================================
-- 8) Función: get_suspicious_attendance — para encargado/socio
-- ============================================================================

CREATE OR REPLACE FUNCTION get_suspicious_attendance(
  p_from_date date DEFAULT CURRENT_DATE - 7,
  p_to_date   date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  log_id              uuid,
  user_id             uuid,
  first_name          text,
  last_name           text,
  role                text,
  operative_date      date,
  clock_in_at         timestamptz,
  clock_out_at        timestamptz,
  hours_worked        numeric,
  suspicious_reasons  text[],
  geo_verified        boolean,
  geo_distance_m      numeric,
  wifi_verified       boolean,
  wifi_ssid           text,
  clock_in_photo_url  text,
  clock_out_photo_url text,
  device_id           text,
  status              text
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Solo encargados/socios pueden ver esto
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('socio','encargado')
  ) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    al.user_id,
    p.first_name,
    p.last_name,
    p.role::text,
    al.operative_date,
    al.clock_in_at,
    al.clock_out_at,
    CASE
      WHEN al.clock_out_at IS NOT NULL
      THEN round(EXTRACT(EPOCH FROM (al.clock_out_at - al.clock_in_at)) / 3600.0, 2)
      ELSE NULL
    END as hours_worked,
    al.suspicious_reasons,
    al.geo_verified,
    al.geo_distance_m,
    al.wifi_verified,
    al.wifi_ssid,
    al.clock_in_photo_url,
    al.clock_out_photo_url,
    al.device_id,
    al.status::text
  FROM attendance_logs al
  JOIN profiles p ON p.id = al.user_id
  WHERE
    al.operative_date BETWEEN p_from_date AND p_to_date
    AND (al.is_suspicious = true OR al.status = 'missing_checkout')
  ORDER BY al.operative_date DESC, al.clock_in_at DESC;
END;
$$;
