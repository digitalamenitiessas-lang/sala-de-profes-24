--
-- PostgreSQL database dump
--

\restrict d9DcbyRbge0dhXeulAn0gnBFnVqu6EspmrBXLRDpQxBlrdCtiHBLTjEorcydlXL

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."app_role" AS ENUM (
    'encargado',
    'chef',
    'barista',
    'runner',
    'cocina',
    'socio',
    'bacha'
);


--
-- Name: admin_announcements_summary("date", "date"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."admin_announcements_summary"("p_from" "date", "p_to" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN (
    WITH in_range AS (
      SELECT * FROM announcements
      WHERE created_at::date BETWEEN p_from AND p_to
    ),
    by_type AS (
      SELECT type::text, COUNT(*) AS count FROM in_range GROUP BY type
    ),
    by_priority AS (
      SELECT priority::text, COUNT(*) AS count FROM in_range GROUP BY priority
    )
    SELECT jsonb_build_object(
      'total', (SELECT COUNT(*) FROM in_range),
      'active', (SELECT COUNT(*) FROM in_range WHERE is_active = true),
      'expired', (SELECT COUNT(*) FROM in_range WHERE expires_at IS NOT NULL AND expires_at < NOW()),
      'by_type', (SELECT COALESCE(jsonb_object_agg(type, count), '{}'::jsonb) FROM by_type),
      'by_priority', (SELECT COALESCE(jsonb_object_agg(priority, count), '{}'::jsonb) FROM by_priority)
    )
  );
END;
$$;


--
-- Name: admin_attendance_summary("date", "date"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."admin_attendance_summary"("p_from" "date", "p_to" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN (
    WITH logs AS (
      SELECT
        al.operative_date,
        al.user_id,
        al.clock_in_at,
        al.clock_out_at,
        al.status,
        CASE WHEN al.clock_out_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (al.clock_out_at::timestamptz - al.clock_in_at::timestamptz)) / 3600.0
          ELSE NULL
        END AS hours_worked
      FROM attendance_logs al
      WHERE al.operative_date BETWEEN p_from AND p_to
    ),
    daily AS (
      SELECT
        operative_date AS date,
        COUNT(*) AS count,
        ROUND(AVG(hours_worked)::numeric, 1) AS avg_hours
      FROM logs WHERE hours_worked IS NOT NULL
      GROUP BY operative_date ORDER BY operative_date
    ),
    by_employee AS (
      SELECT
        p.id AS user_id,
        p.first_name,
        p.last_name,
        p.role::text,
        COUNT(DISTINCT l.operative_date) AS days_present,
        ROUND(COALESCE(SUM(l.hours_worked), 0)::numeric, 1) AS total_hours,
        ROUND(AVG(l.hours_worked)::numeric, 1) AS avg_hours,
        COUNT(*) FILTER (WHERE l.status = 'open' AND l.clock_out_at IS NULL) AS missing_checkouts
      FROM profiles p
      LEFT JOIN logs l ON l.user_id = p.id
      WHERE p.is_active = true
      GROUP BY p.id, p.first_name, p.last_name, p.role
      ORDER BY total_hours DESC NULLS LAST
    )
    SELECT jsonb_build_object(
      'total_logs', (SELECT COUNT(*) FROM logs),
      'unique_employees', (SELECT COUNT(DISTINCT user_id) FROM logs),
      'avg_hours_per_day', (SELECT ROUND(AVG(hours_worked)::numeric, 1) FROM logs WHERE hours_worked IS NOT NULL),
      'missing_checkouts', (SELECT COUNT(*) FROM logs WHERE status = 'open' AND clock_out_at IS NULL),
      'daily', (SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb) FROM daily d),
      'by_employee', (SELECT COALESCE(jsonb_agg(row_to_json(e)), '[]'::jsonb) FROM by_employee e)
    )
  );
END;
$$;


--
-- Name: admin_dashboard_kpis(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."admin_dashboard_kpis"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_tomorrow date := CURRENT_DATE + 1;
BEGIN
  RETURN jsonb_build_object(
    'team_present_today',
      (SELECT COUNT(DISTINCT user_id) FROM attendance_logs
        WHERE operative_date = v_today),
    'team_clocked_in',
      (SELECT COUNT(DISTINCT user_id) FROM attendance_logs
        WHERE operative_date = v_today AND clock_out_at IS NULL AND status = 'open'),
    'team_total_active',
      (SELECT COUNT(*) FROM profiles WHERE is_active = true),
    'missing_checkouts',
      (SELECT COUNT(*) FROM attendance_logs
        WHERE operative_date = v_today AND status = 'open' AND clock_out_at IS NULL),
    'shifts_today',
      (SELECT COUNT(*) FROM shifts WHERE shift_date = v_today),
    'shifts_tomorrow',
      (SELECT COUNT(*) FROM shifts WHERE shift_date = v_tomorrow),
    'stock_red',
      (SELECT COUNT(*) FROM stock_items
        WHERE is_active = true AND current_qty <= min_qty),
    'stock_yellow',
      (SELECT COUNT(*) FROM stock_items
        WHERE is_active = true AND current_qty > min_qty AND current_qty <= min_qty * 1.5),
    'stock_green',
      (SELECT COUNT(*) FROM stock_items
        WHERE is_active = true AND current_qty > min_qty * 1.5),
    'stock_total',
      (SELECT COUNT(*) FROM stock_items WHERE is_active = true),
    'announcements_active',
      (SELECT COUNT(*) FROM announcements
        WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW())),
    'announcements_urgent',
      (SELECT COUNT(*) FROM announcements
        WHERE is_active = true AND priority = 'critica'
        AND (expires_at IS NULL OR expires_at > NOW())),
    'suppliers_total',
      (SELECT COUNT(*) FROM suppliers)
  );
END;
$$;


--
-- Name: FUNCTION "admin_dashboard_kpis"(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION "public"."admin_dashboard_kpis"() IS 'KPIs del día para el Centro de Control admin';


--
-- Name: admin_shifts_summary("date", "date"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."admin_shifts_summary"("p_from" "date", "p_to" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN (
    WITH shifts_range AS (
      SELECT * FROM shifts WHERE shift_date BETWEEN p_from AND p_to
    ),
    by_role AS (
      SELECT shift_role::text AS role, COUNT(*) AS count
      FROM shifts_range GROUP BY shift_role
    ),
    daily AS (
      SELECT shift_date AS date, COUNT(*) AS count
      FROM shifts_range GROUP BY shift_date ORDER BY shift_date
    )
    SELECT jsonb_build_object(
      'total_shifts', (SELECT COUNT(*) FROM shifts_range),
      'unique_employees', (SELECT COUNT(DISTINCT user_id) FROM shifts_range),
      'by_role', (SELECT COALESCE(jsonb_object_agg(role, count), '{}'::jsonb) FROM by_role),
      'daily', (SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb) FROM daily d)
    )
  );
END;
$$;


--
-- Name: admin_stock_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."admin_stock_snapshot"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN (
    WITH items AS (
      SELECT
        si.*,
        s.name AS supplier_name,
        CASE
          WHEN si.current_qty <= 0 OR si.current_qty <= si.min_qty THEN 'red'
          WHEN si.current_qty <= si.min_qty * 1.5 THEN 'yellow'
          ELSE 'green'
        END AS semaphore
      FROM stock_items si
      LEFT JOIN suppliers s ON s.id = si.supplier_id
      WHERE si.is_active = true
    ),
    by_cat AS (
      SELECT
        category::text,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE semaphore = 'red') AS red,
        COUNT(*) FILTER (WHERE semaphore = 'yellow') AS yellow,
        COUNT(*) FILTER (WHERE semaphore = 'green') AS green
      FROM items GROUP BY category ORDER BY category
    )
    SELECT jsonb_build_object(
      'total', (SELECT COUNT(*) FROM items),
      'red', (SELECT COUNT(*) FILTER (WHERE semaphore = 'red') FROM items),
      'yellow', (SELECT COUNT(*) FILTER (WHERE semaphore = 'yellow') FROM items),
      'green', (SELECT COUNT(*) FILTER (WHERE semaphore = 'green') FROM items),
      'by_category', (SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb) FROM by_cat c),
      'critical_items', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'name', name, 'current_qty', current_qty, 'min_qty', min_qty,
          'unit', unit, 'supplier_name', supplier_name, 'category', category::text
        )), '[]'::jsonb) FROM items WHERE semaphore = 'red'
      )
    )
  );
END;
$$;


--
-- Name: auth_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."auth_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT role::text FROM profiles WHERE id = auth.uid()
$$;


--
-- Name: check_attendance_anomalies("uuid", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."check_attendance_anomalies"("p_log_id" "uuid", "p_event" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


--
-- Name: clock_in("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."clock_in"("p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := CURRENT_DATE;
  v_existing record;
  v_new_log record;
BEGIN
  -- Check if already clocked in today without clock_out
  SELECT * INTO v_existing FROM attendance_logs
  WHERE user_id = v_user_id
    AND operative_date = v_today
    AND clock_out_at IS NULL
    AND status = 'open'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Ya tenés un ingreso abierto hoy', 'log_id', v_existing.id);
  END IF;

  INSERT INTO attendance_logs (user_id, operative_date, clock_in_at, status, notes)
  VALUES (v_user_id, v_today, NOW(), 'open', p_notes)
  RETURNING * INTO v_new_log;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_new_log.id,
    'clock_in_at', v_new_log.clock_in_at
  );
END;
$$;


--
-- Name: clock_in("text", numeric, numeric, numeric, "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."clock_in"("p_notes" "text" DEFAULT NULL::"text", "p_lat" numeric DEFAULT NULL::numeric, "p_lng" numeric DEFAULT NULL::numeric, "p_accuracy" numeric DEFAULT NULL::numeric, "p_selfie_url" "text" DEFAULT NULL::"text", "p_device_fingerprint" "text" DEFAULT NULL::"text", "p_network_ip" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


--
-- Name: clock_out("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."clock_out"("p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := CURRENT_DATE;
  v_log record;
BEGIN
  -- Find open log for today
  SELECT * INTO v_log FROM attendance_logs
  WHERE user_id = v_user_id
    AND operative_date = v_today
    AND clock_out_at IS NULL
    AND status = 'open'
  ORDER BY clock_in_at DESC
  LIMIT 1;

  IF v_log IS NULL THEN
    RETURN jsonb_build_object('error', 'No tenés un ingreso abierto hoy');
  END IF;

  UPDATE attendance_logs
  SET clock_out_at = NOW(),
      status = 'closed',
      notes = COALESCE(p_notes, notes)
  WHERE id = v_log.id;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log.id,
    'clock_in_at', v_log.clock_in_at,
    'clock_out_at', NOW()
  );
END;
$$;


--
-- Name: clock_out("text", numeric, numeric, numeric, "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."clock_out"("p_notes" "text" DEFAULT NULL::"text", "p_lat" numeric DEFAULT NULL::numeric, "p_lng" numeric DEFAULT NULL::numeric, "p_accuracy" numeric DEFAULT NULL::numeric, "p_selfie_url" "text" DEFAULT NULL::"text", "p_device_fingerprint" "text" DEFAULT NULL::"text", "p_network_ip" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


--
-- Name: complete_production_order(bigint, "uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."complete_production_order"("p_order_id" bigint, "p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_order            production_orders%ROWTYPE;
  v_input            RECORD;
  v_output           RECORD;
  v_prev_qty         numeric;
  v_new_qty          numeric;
  v_mov_id           uuid;
  v_lot_id           bigint;
  v_lot_code         text;
  v_produced_at      timestamptz;
  v_expires_at       timestamptz;
  v_shelf_life_days  int;
  v_unit_cost        numeric;
  v_total_cost       numeric := 0;
  v_mass_input       numeric := 0;   -- kg/l equivalentes de insumos convertibles
  v_mass_waste       numeric := 0;   -- kg/l equivalentes de merma convertible
  v_total_input      numeric := 0;
  v_total_output_net numeric := 0;
  v_total_waste      numeric := 0;
  v_efficiency       numeric := NULL;
  v_main_item        uuid := NULL;
  v_main_qty         numeric := 0;
  v_main_prev_qty    numeric := 0;
  v_cost_per_unit    numeric := NULL;
  v_prev_cost        numeric;
  v_movements        jsonb := '[]'::jsonb;
  v_input_count      int;
  v_output_count     int;
  v_inputs_confiables boolean := false;  -- v7: ¿todos los insumos con costo real?
BEGIN
  SELECT * INTO v_order FROM production_orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Orden no encontrada');
  END IF;
  IF v_order.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden ya fue completada');
  END IF;
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden fue cancelada');
  END IF;

  SELECT COUNT(*) INTO v_input_count FROM production_inputs WHERE production_order_id = p_order_id;
  IF v_input_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden no tiene insumos registrados');
  END IF;

  SELECT COUNT(*) INTO v_output_count FROM production_outputs WHERE production_order_id = p_order_id;
  IF v_output_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden no tiene productos registrados');
  END IF;

  -- Stock suficiente antes de tocar nada
  FOR v_input IN
    SELECT pi.*, si.current_qty, si.name AS item_name
    FROM production_inputs pi
    JOIN stock_items si ON si.id = pi.stock_item_id
    WHERE pi.production_order_id = p_order_id
  LOOP
    IF v_input.current_qty < v_input.qty_used THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Stock insuficiente de "' || v_input.item_name
          || '": disponible ' || round(v_input.current_qty::numeric, 3)
          || ', requerido '   || round(v_input.qty_used::numeric, 3)
      );
    END IF;
  END LOOP;

  -- v7: la fuente del costo del elaborado depende de la de sus insumos.
  -- 'produccion' solo si TODOS tienen cost_source confiable y costo > 0.
  SELECT COALESCE(
    bool_and(
      COALESCE(si.cost_source, '') IN ('compra', 'manual', 'produccion')
      AND COALESCE(si.cost_per_unit, 0) > 0
    ),
    false
  )
  INTO v_inputs_confiables
  FROM production_inputs pi
  JOIN stock_items si ON si.id = pi.stock_item_id
  WHERE pi.production_order_id = p_order_id;

  -- ── Insumos: descontar, congelar costo, kardex ──
  FOR v_input IN
    SELECT pi.*, si.cost_per_unit AS item_cost, si.unit AS item_unit
    FROM production_inputs pi
    JOIN stock_items si ON si.id = pi.stock_item_id
    WHERE pi.production_order_id = p_order_id
    ORDER BY pi.id
  LOOP
    -- Se relee dentro del loop: si el mismo insumo aparece en dos renglones,
    -- el segundo tiene que partir de lo que dejó el primero (con el valor
    -- fotografiado por el cursor, el segundo pisaba al primero).
    SELECT current_qty INTO v_prev_qty
    FROM stock_items WHERE id = v_input.stock_item_id FOR UPDATE;
    v_new_qty := v_prev_qty - v_input.qty_used;
    v_unit_cost := COALESCE(v_input.cost_per_unit, v_input.item_cost, 0);

    UPDATE stock_items
    SET current_qty = v_new_qty, updated_at = now()
    WHERE id = v_input.stock_item_id;

    INSERT INTO stock_movements
      (stock_item_id, qty, movement_type, reason, previous_qty, new_qty, created_by,
       production_order_id, cost_per_unit, note)
    VALUES
      (v_input.stock_item_id, v_input.qty_used, 'uso', 'produccion_input', v_prev_qty, v_new_qty, p_user_id,
       p_order_id, NULLIF(v_unit_cost, 0), 'Producción #' || p_order_id || ': ' || v_order.name)
    RETURNING id INTO v_mov_id;

    UPDATE production_inputs
    SET movement_uuid = v_mov_id,
        cost_per_unit = COALESCE(cost_per_unit, NULLIF(v_unit_cost, 0))
    WHERE id = v_input.id;

    v_total_cost  := v_total_cost + (v_input.qty_used * v_unit_cost);
    v_total_input := v_total_input + v_input.qty_used;

    -- Eficiencia solo con unidades convertibles a masa/volumen
    IF lower(COALESCE(v_input.unit, v_input.item_unit, '')) IN ('kg', 'l', 'lt', 'litro') THEN
      v_mass_input := v_mass_input + v_input.qty_used;
    ELSIF lower(COALESCE(v_input.unit, v_input.item_unit, '')) IN ('g', 'ml') THEN
      v_mass_input := v_mass_input + (v_input.qty_used / 1000);
    END IF;

    v_movements := v_movements || jsonb_build_object(
      'type', 'input',
      'stock_item_id', v_input.stock_item_id,
      'change', -v_input.qty_used,
      'movement_id', v_mov_id
    );
  END LOOP;

  -- ── Salida principal (para el costo por unidad) ──
  SELECT po.stock_item_id, po.qty_produced
  INTO v_main_item, v_main_qty
  FROM production_outputs po
  WHERE po.production_order_id = p_order_id
    AND NOT po.is_waste
    AND po.stock_item_id IS NOT NULL
  ORDER BY po.qty_produced DESC
  LIMIT 1;

  IF v_main_item IS NOT NULL AND v_main_qty > 0 AND v_total_cost > 0 THEN
    v_cost_per_unit := round(v_total_cost / v_main_qty, 2);
  END IF;

  -- ── Salidas: sumar, lotes, kardex, costo del elaborado ──
  FOR v_output IN
    SELECT po.*, si.shelf_life_days AS item_shelf_life,
           si.cost_per_unit AS item_cost, si.unit AS item_unit
    FROM production_outputs po
    LEFT JOIN stock_items si ON si.id = po.stock_item_id
    WHERE po.production_order_id = p_order_id
    ORDER BY po.id
  LOOP
    IF v_output.is_waste THEN
      v_total_waste := v_total_waste + v_output.qty_produced;
      IF lower(COALESCE(v_output.unit, v_output.item_unit, '')) IN ('kg', 'l', 'lt', 'litro') THEN
        v_mass_waste := v_mass_waste + v_output.qty_produced;
      ELSIF lower(COALESCE(v_output.unit, v_output.item_unit, '')) IN ('g', 'ml') THEN
        v_mass_waste := v_mass_waste + (v_output.qty_produced / 1000);
      END IF;
      CONTINUE;
    END IF;

    IF v_output.stock_item_id IS NULL THEN
      v_total_output_net := v_total_output_net + v_output.qty_produced;
      CONTINUE;
    END IF;

    -- Igual que con los insumos: releer para soportar el mismo elaborado en
    -- más de un renglón de salida.
    SELECT COALESCE(current_qty, 0) INTO v_prev_qty
    FROM stock_items WHERE id = v_output.stock_item_id FOR UPDATE;
    v_new_qty := v_prev_qty + v_output.qty_produced;

    -- Costo del elaborado: promedio ponderado entre lo que había y lo producido.
    -- Solo para la salida principal (las secundarias no tienen costo imputable).
    v_prev_cost := v_output.item_cost;
    IF v_output.stock_item_id = v_main_item AND v_cost_per_unit IS NOT NULL THEN
      IF v_prev_qty > 0 AND COALESCE(v_prev_cost, 0) > 0 THEN
        v_prev_cost := round((v_prev_qty * v_prev_cost + v_output.qty_produced * v_cost_per_unit) / v_new_qty, 2);
      ELSE
        v_prev_cost := v_cost_per_unit;
      END IF;
      -- v7: sellar fuente y fecha del costo del elaborado.
      UPDATE stock_items
      SET current_qty = v_new_qty,
          cost_per_unit = v_prev_cost,
          cost_source = CASE WHEN v_inputs_confiables THEN 'produccion' ELSE 'estimado' END,
          cost_updated_at = now(),
          updated_at = now()
      WHERE id = v_output.stock_item_id;
    ELSE
      UPDATE stock_items
      SET current_qty = v_new_qty, updated_at = now()
      WHERE id = v_output.stock_item_id;
    END IF;

    INSERT INTO stock_movements
      (stock_item_id, qty, movement_type, reason, previous_qty, new_qty, created_by,
       production_order_id, cost_per_unit, note)
    VALUES
      (v_output.stock_item_id, v_output.qty_produced, 'entrada', 'produccion_output', v_prev_qty, v_new_qty, p_user_id,
       p_order_id,
       CASE WHEN v_output.stock_item_id = v_main_item THEN v_cost_per_unit ELSE NULL END,
       'Producción #' || p_order_id || ': ' || v_order.name)
    RETURNING id INTO v_mov_id;

    -- Lote: vencimiento explícito o por vida útil del item
    v_produced_at := COALESCE(v_output.produced_at, now());
    v_expires_at  := v_output.expires_at;
    v_shelf_life_days := v_output.item_shelf_life;
    IF v_expires_at IS NULL AND v_shelf_life_days IS NOT NULL THEN
      v_expires_at := v_produced_at + make_interval(days => v_shelf_life_days);
    END IF;
    v_lot_code := COALESCE(
      NULLIF(v_output.lot_code, ''),
      format('LOT-%s-%s-%s', to_char(v_produced_at AT TIME ZONE 'America/Argentina/Tucuman', 'YYMMDD'), p_order_id, v_output.id)
    );

    UPDATE production_outputs
    SET movement_uuid = v_mov_id,
        produced_at   = COALESCE(production_outputs.produced_at, v_produced_at),
        expires_at    = COALESCE(production_outputs.expires_at, v_expires_at),
        lot_code      = COALESCE(NULLIF(production_outputs.lot_code, ''), v_lot_code)
    WHERE id = v_output.id;

    v_lot_id := NULL;
    IF v_output.qty_produced > 0 THEN
      INSERT INTO stock_lots (
        stock_item_id, production_order_id, production_output_id, lot_code,
        qty_original, qty_remaining, unit, produced_at, expires_at, status, notes, created_by
      ) VALUES (
        v_output.stock_item_id, p_order_id, v_output.id, v_lot_code,
        v_output.qty_produced, v_output.qty_produced, COALESCE(v_output.unit, v_output.item_unit, 'unidad'),
        v_produced_at, v_expires_at,
        CASE WHEN v_expires_at IS NOT NULL AND v_expires_at < now() THEN 'expired' ELSE 'active' END,
        v_output.notes, p_user_id
      )
      ON CONFLICT (production_output_id) WHERE production_output_id IS NOT NULL DO NOTHING
      RETURNING id INTO v_lot_id;
    END IF;

    v_total_output_net := v_total_output_net + v_output.qty_produced;
    v_movements := v_movements || jsonb_build_object(
      'type', 'output',
      'stock_item_id', v_output.stock_item_id,
      'change', v_output.qty_produced,
      'movement_id', v_mov_id,
      'lot_id', v_lot_id,
      'lot_code', v_lot_code,
      'expires_at', v_expires_at
    );
  END LOOP;

  IF v_mass_input > 0 THEN
    v_efficiency := round(((v_mass_input - v_mass_waste) / v_mass_input) * 100, 1);
  END IF;

  UPDATE production_orders SET
    status                    = 'completed',
    completed_at              = now(),
    started_at                = COALESCE(started_at, now()),
    updated_at                = now(),
    efficiency_pct            = v_efficiency,
    total_cost                = round(v_total_cost, 2),
    cost_per_output_unit      = v_cost_per_unit,
    main_output_stock_item_id = v_main_item
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success',              true,
    'order_id',             p_order_id,
    'total_input_qty',      v_total_input,
    'total_output_qty',     v_total_output_net,
    'waste_qty',            v_total_waste,
    'efficiency_pct',       v_efficiency,
    'total_cost',           round(v_total_cost, 2),
    'cost_per_output_unit', v_cost_per_unit,
    'main_output_stock_item_id', v_main_item,
    'movements',            v_movements
  );
END;
$$;


--
-- Name: deduct_stock_on_sale(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."deduct_stock_on_sale"("p_sale_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_sale          record;
  v_menu_item     record;
  v_ingredient    record;
  v_total_qty     numeric;
  v_movement      jsonb;
  v_movements     jsonb := '[]'::jsonb;
  v_count         int := 0;
BEGIN
  -- 1) Buscar la venta
  SELECT id, fudo_product_id, quantity
  INTO v_sale
  FROM fudo_sales
  WHERE id = p_sale_id;

  IF v_sale IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Venta %s no encontrada en fudo_sales', p_sale_id)
    );
  END IF;

  -- 2) Buscar el menu_item con ese fudo_product_id
  SELECT id, name, recipe_id
  INTO v_menu_item
  FROM menu_items
  WHERE fudo_product_id = v_sale.fudo_product_id
  LIMIT 1;

  -- Si no hay menu_item mapeado, no hacer nada (producto no sincronizado aún)
  IF v_menu_item IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'sale_id', p_sale_id,
      'message', 'Producto Fudo no mapeado a ningún menu_item',
      'ingredients_affected', 0
    );
  END IF;

  -- 3) Si no tiene receta vinculada, no hacer nada
  --    (ej: bebidas embotelladas, productos sin receta)
  IF v_menu_item.recipe_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'sale_id', p_sale_id,
      'menu_item', v_menu_item.name,
      'message', 'Menu item sin receta vinculada, no se descuenta stock',
      'ingredients_affected', 0
    );
  END IF;

  -- 4) Recorrer ingredientes de la receta
  FOR v_ingredient IN
    SELECT
      ri.stock_item_id,
      ri.qty_per_portion,
      si.name AS stock_item_name,
      si.current_qty
    FROM recipe_ingredients ri
    JOIN stock_items si ON si.id = ri.stock_item_id
    WHERE ri.recipe_id = v_menu_item.recipe_id
  LOOP
    -- Calcular cantidad: qty por porción * cantidad vendida
    v_total_qty := v_ingredient.qty_per_portion * v_sale.quantity;

    -- Registrar movimiento de stock
    v_movement := register_stock_movement(
      p_stock_item_id  := v_ingredient.stock_item_id,
      p_change         := -v_total_qty,
      p_reason         := 'sale',
      p_reference_type := 'fudo_sale',
      p_reference_id   := p_sale_id::text
    );

    v_movements := v_movements || jsonb_build_object(
      'stock_item_id', v_ingredient.stock_item_id,
      'stock_item_name', v_ingredient.stock_item_name,
      'qty_deducted', v_total_qty,
      'previous_qty', v_ingredient.current_qty,
      'new_qty', (v_movement->>'new_qty')::numeric
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', p_sale_id,
    'menu_item', v_menu_item.name,
    'recipe_id', v_menu_item.recipe_id,
    'quantity_sold', v_sale.quantity,
    'ingredients_affected', v_count,
    'movements', v_movements
  );
END;
$$;


--
-- Name: FUNCTION "deduct_stock_on_sale"("p_sale_id" bigint); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION "public"."deduct_stock_on_sale"("p_sale_id" bigint) IS 'Descuenta stock automáticamente al registrar una venta de Fudo. Si el producto no tiene receta vinculada, no hace nada.';


--
-- Name: fn_audit_announcements(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."fn_audit_announcements"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ DECLARE uname text; BEGIN SELECT first_name || ' ' || last_name INTO uname FROM profiles WHERE id = auth.uid(); IF TG_OP = 'INSERT' THEN INSERT INTO audit_trail(user_id, user_name, action, module, entity_type, entity_id, description, metadata) VALUES (auth.uid(), uname, 'announcement_created', 'avisos', 'announcement', NEW.id::text, 'Aviso: ' || NEW.title, jsonb_build_object('type', NEW.type, 'priority', NEW.priority, 'scope', NEW.scope)); END IF; RETURN NEW; END; $$;


--
-- Name: fn_audit_attendance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."fn_audit_attendance"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ DECLARE uname text; BEGIN SELECT first_name || ' ' || last_name INTO uname FROM profiles WHERE id = COALESCE(NEW.user_id, OLD.user_id); IF TG_OP = 'INSERT' THEN INSERT INTO audit_trail(user_id, user_name, action, module, entity_type, entity_id, description, metadata) VALUES (NEW.user_id, uname, 'clock_in', 'asistencia', 'attendance_log', NEW.id::text, uname || ' fichó ingreso', jsonb_build_object('clock_in', NEW.clock_in_at, 'date', NEW.operative_date)); ELSIF TG_OP = 'UPDATE' AND OLD.clock_out_at IS NULL AND NEW.clock_out_at IS NOT NULL THEN INSERT INTO audit_trail(user_id, user_name, action, module, entity_type, entity_id, description, metadata) VALUES (NEW.user_id, uname, 'clock_out', 'asistencia', 'attendance_log', NEW.id::text, uname || ' fichó egreso', jsonb_build_object('clock_in', NEW.clock_in_at, 'clock_out', NEW.clock_out_at, 'type', NEW.clock_out_type)); END IF; RETURN NEW; END; $$;


--
-- Name: fn_audit_bar_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."fn_audit_bar_stock"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ DECLARE uname text; BEGIN SELECT first_name || ' ' || last_name INTO uname FROM profiles WHERE id = auth.uid(); IF TG_OP = 'UPDATE' AND OLD.current_qty IS DISTINCT FROM NEW.current_qty THEN INSERT INTO audit_trail(user_id, user_name, action, module, entity_type, entity_id, description, metadata) VALUES (auth.uid(), uname, 'bar_stock_update', 'barra', 'bar_stock_item', NEW.id::text, 'Barra ' || NEW.name || ': ' || OLD.current_qty || ' → ' || NEW.current_qty, jsonb_build_object('item', NEW.name, 'old_qty', OLD.current_qty, 'new_qty', NEW.current_qty)); END IF; RETURN NEW; END; $$;


--
-- Name: fn_audit_orders(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."fn_audit_orders"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ DECLARE uname text; BEGIN SELECT first_name || ' ' || last_name INTO uname FROM profiles WHERE id = auth.uid(); IF TG_OP = 'INSERT' THEN INSERT INTO audit_trail(user_id, user_name, action, module, entity_type, entity_id, description, metadata) VALUES (auth.uid(), uname, 'order_created', 'pedidos', TG_TABLE_NAME, NEW.id::text, 'Pedido: ' || NEW.product_name || ' × ' || NEW.quantity, jsonb_build_object('product', NEW.product_name, 'qty', NEW.quantity, 'status', NEW.status)); ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN INSERT INTO audit_trail(user_id, user_name, action, module, entity_type, entity_id, description, metadata) VALUES (auth.uid(), uname, 'order_status', 'pedidos', TG_TABLE_NAME, NEW.id::text, 'Pedido ' || NEW.product_name || ': ' || OLD.status || ' → ' || NEW.status, jsonb_build_object('product', NEW.product_name, 'old_status', OLD.status, 'new_status', NEW.status)); END IF; RETURN NEW; END; $$;


--
-- Name: fn_audit_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."fn_audit_stock"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  uname text;
BEGIN
  -- Sin usuario = escritura del backend (espejo de Fudo, RPC de producción,
  -- sync tras recepción). Esos caminos ya auditan por su cuenta, con el
  -- usuario real y el motivo. Registrarlos acá sólo genera ruido anónimo.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.current_qty IS DISTINCT FROM NEW.current_qty THEN
    SELECT first_name || ' ' || last_name INTO uname FROM profiles WHERE id = auth.uid();
    INSERT INTO audit_trail(user_id, user_name, action, module, entity_type, entity_id, description, metadata)
    VALUES (
      auth.uid(), uname, 'stock_update', 'stock', 'stock_item', NEW.id::text,
      'Stock ' || NEW.name || ': ' || OLD.current_qty || ' → ' || NEW.current_qty,
      jsonb_build_object('item', NEW.name, 'old_qty', OLD.current_qty, 'new_qty', NEW.current_qty, 'category', NEW.category)
    );
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_audit_vajilla(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."fn_audit_vajilla"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ DECLARE uname text; BEGIN SELECT first_name || ' ' || last_name INTO uname FROM profiles WHERE id = auth.uid(); IF TG_OP = 'UPDATE' AND OLD.quantity IS DISTINCT FROM NEW.quantity THEN INSERT INTO audit_trail(user_id, user_name, action, module, entity_type, entity_id, description, metadata) VALUES (auth.uid(), uname, 'vajilla_update', 'vajilla', 'vajilla_stock', NEW.id::text, 'Vajilla ' || NEW.item_name || ': ' || OLD.quantity || ' → ' || NEW.quantity, jsonb_build_object('item', NEW.item_name, 'old_qty', OLD.quantity, 'new_qty', NEW.quantity)); ELSIF TG_OP = 'INSERT' THEN INSERT INTO audit_trail(user_id, user_name, action, module, entity_type, entity_id, description, metadata) VALUES (auth.uid(), uname, 'vajilla_created', 'vajilla', 'vajilla_stock', NEW.id::text, 'Vajilla nuevo: ' || NEW.item_name || ' (' || NEW.quantity || ')', jsonb_build_object('item', NEW.item_name, 'qty', NEW.quantity)); END IF; RETURN NEW; END; $$;


--
-- Name: fn_bar_stock_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."fn_bar_stock_log"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ BEGIN IF OLD.current_qty IS DISTINCT FROM NEW.current_qty THEN INSERT INTO bar_stock_logs(bar_stock_item_id, user_id, action, old_qty, new_qty) VALUES (NEW.id, auth.uid(), 'update', OLD.current_qty, NEW.current_qty); END IF; RETURN NEW; END; $$;


--
-- Name: fn_stock_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."fn_stock_log"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF OLD.current_qty IS DISTINCT FROM NEW.current_qty THEN
    INSERT INTO stock_logs(stock_item_id, user_id, action, old_qty, new_qty)
    VALUES (
      NEW.id,
      auth.uid(),
      CASE WHEN auth.uid() IS NULL THEN 'fudo_mirror' ELSE 'update' END,
      OLD.current_qty,
      NEW.current_qty
    );
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: generate_expediente_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."generate_expediente_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$ DECLARE current_year text; next_num int; BEGIN current_year := to_char(now(), 'YYYY'); SELECT COALESCE(MAX(CAST(split_part(code, '-', 3) AS int)), 0) + 1 INTO next_num FROM expedientes WHERE code LIKE 'LVE-' || current_year || '-%'; NEW.code := 'LVE-' || current_year || '-' || lpad(next_num::text, 4, '0'); RETURN NEW; END; $$;


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'general'::"text" NOT NULL,
    "priority" "text" DEFAULT 'media'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "scope" "text" DEFAULT 'all'::"text" NOT NULL,
    "target_role" "public"."app_role",
    "target_user_id" "uuid",
    "publish_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "announcements_priority_check" CHECK (("priority" = ANY (ARRAY['baja'::"text", 'media'::"text", 'alta'::"text", 'critica'::"text"]))),
    CONSTRAINT "announcements_scope_check" CHECK (("scope" = ANY (ARRAY['all'::"text", 'role'::"text", 'user'::"text"]))),
    CONSTRAINT "announcements_type_check" CHECK (("type" = ANY (ARRAY['general'::"text", 'urgente'::"text", 'recordatorio'::"text", 'operativo'::"text"])))
);


--
-- Name: get_my_announcements(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."get_my_announcements"() RETURNS SETOF "public"."announcements"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
BEGIN
  -- Get current user's role
  SELECT role::text INTO v_role FROM profiles WHERE id = v_user_id;

  RETURN QUERY
  SELECT a.*
  FROM announcements a
  WHERE a.is_active = true
    AND (a.expires_at IS NULL OR a.expires_at > NOW())
    AND (
      a.scope = 'all'
      OR (a.scope = 'role' AND a.target_role::text = v_role)
      OR (a.scope = 'user' AND a.target_user_id = v_user_id)
    )
  ORDER BY a.created_at DESC;
END;
$$;


--
-- Name: FUNCTION "get_my_announcements"(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION "public"."get_my_announcements"() IS 'Devuelve las notificaciones visibles para el usuario autenticado según su rol y scope';


--
-- Name: get_my_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."get_my_role"() RETURNS "public"."app_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;


--
-- Name: get_weekly_schedule("date"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."get_weekly_schedule"("p_start_date" "date") RETURNS TABLE("shift_id" "uuid", "user_id" "uuid", "first_name" "text", "last_name" "text", "shift_date" "date", "start_time" time without time zone, "end_time" time without time zone, "shift_role" "text", "color" "text", "emoji" "text", "notes" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.user_id, p.first_name, p.last_name,
    s.shift_date, s.start_time::time, s.end_time::time,
    s.shift_role::text, s.color, s.emoji, s.notes
  FROM shifts s JOIN profiles p ON p.id = s.user_id
  WHERE s.shift_date >= p_start_date AND s.shift_date < p_start_date + 7
  ORDER BY s.shift_date, s.start_time;
END; $$;


--
-- Name: guardar_receta_produccion("uuid", numeric, "jsonb", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."guardar_receta_produccion"("p_output" "uuid", "p_rinde" numeric, "p_ingredientes" "jsonb", "p_notas" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_out record;
  v_recipe uuid;
  v_ing jsonb;
  v_item uuid;
  v_qty numeric;
  v_n int := 0;
begin
  select role::text, nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    into v_role, v_name from profiles where id = v_uid;
  if v_role is null or v_role not in ('encargado', 'socio', 'chef') then
    raise exception 'Solo encargados, socios o chef pueden cargar recetas de producción' using errcode = '42501';
  end if;
  if p_rinde is null or p_rinde <= 0 then
    raise exception 'El rinde tiene que ser mayor a cero' using errcode = '22023';
  end if;
  if p_ingredientes is null or jsonb_typeof(p_ingredientes) <> 'array'
     or jsonb_array_length(p_ingredientes) = 0 or jsonb_array_length(p_ingredientes) > 40 then
    raise exception 'Cargá entre 1 y 40 ingredientes' using errcode = '22023';
  end if;

  select id, name, unit into v_out from stock_items where id = p_output and is_active;
  if v_out.id is null then
    raise exception 'El elaborado no existe o está inactivo' using errcode = '22023';
  end if;

  -- La receta de producción de este elaborado: una propia (no de un plato, no de Fudo)
  select r.id into v_recipe
    from recipes r
   where r.output_stock_item_id = p_output and r.is_active
     and r.fudo_synced_at is null
     and not exists (select 1 from menu_items m where m.recipe_id = r.id)
   order by (r.slug like 'prod-%') desc, r.updated_at desc nulls last
   limit 1;

  if v_recipe is null then
    insert into recipes (name, category, created_by, is_active, yield_portions, rinde_tanda, slug, output_stock_item_id, notes)
    values (v_out.name, 'produccion', v_uid, true, greatest(1, round(p_rinde))::int, p_rinde,
            'prod-' || p_output::text, p_output, p_notas)
    returning id into v_recipe;
  else
    update recipes
       set rinde_tanda = p_rinde, yield_portions = greatest(1, round(p_rinde))::int,
           notes = coalesce(p_notas, notes), updated_at = now()
     where id = v_recipe;
    delete from recipe_ingredients where recipe_id = v_recipe;
  end if;

  for v_ing in select * from jsonb_array_elements(p_ingredientes) loop
    v_item := (v_ing ->> 'stock_item_id')::uuid;
    v_qty := (v_ing ->> 'qty')::numeric;
    if v_item is null or v_qty is null or v_qty <= 0 then
      raise exception 'Cada ingrediente necesita insumo y cantidad mayor a cero' using errcode = '22023';
    end if;
    if v_item = p_output then
      raise exception 'Un elaborado no puede llevarse a sí mismo' using errcode = '22023';
    end if;
    if not exists (select 1 from stock_items where id = v_item and is_active) then
      raise exception 'Uno de los ingredientes no existe o está inactivo' using errcode = '22023';
    end if;
    -- La cantidad llega POR TANDA; se guarda POR UNIDAD producida
    insert into recipe_ingredients (recipe_id, stock_item_id, qty_per_portion, ingredient_unit, notes)
    values (v_recipe, v_item, v_qty / p_rinde, nullif(v_ing ->> 'unit', ''), nullif(v_ing ->> 'nota', ''));
    v_n := v_n + 1;
  end loop;

  insert into audit_trail (user_id, user_name, action, module, entity_type, entity_id, description, metadata)
  values (v_uid, v_name, 'guardar_receta_produccion', 'produccion', 'stock_item', p_output::text,
          format('%s cargó la receta de producción de %s (rinde %s, %s ingredientes)', coalesce(v_name, 'Alguien'), v_out.name, p_rinde, v_n),
          jsonb_build_object('recipe_id', v_recipe, 'rinde', p_rinde, 'ingredientes', p_ingredientes));

  return jsonb_build_object('recipe_id', v_recipe, 'ingredientes', v_n);
end $$;


--
-- Name: handle_kitchen_logs_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."handle_kitchen_logs_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: handle_menu_items_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."handle_menu_items_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', 'Sin'),
    COALESCE(NEW.raw_user_meta_data->>'last_name', 'Nombre'),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'barista')
  );
  RETURN NEW;
END;
$$;


--
-- Name: is_encargado(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."is_encargado"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('encargado', 'socio')); $$;


--
-- Name: is_encargado_or_chef(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."is_encargado_or_chef"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('encargado', 'chef', 'socio')); $$;


--
-- Name: menu_item_reconciliation(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."menu_item_reconciliation"("p_from" timestamp with time zone DEFAULT (CURRENT_DATE)::timestamp with time zone, "p_to" timestamp with time zone DEFAULT "now"()) RETURNS TABLE("menu_item_id" "uuid", "menu_item_name" "text", "recipe_id" "uuid", "recipe_name" "text", "qty_produced" numeric, "qty_sold" numeric, "expected_remaining" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  WITH
  -- Producción desde mise_en_place_records (turnos de cocina)
  mise_prod AS (
    SELECT
      mi.id AS menu_item_id,
      COALESCE(SUM(mpr.quantity_produced), 0) AS qty
    FROM menu_items mi
    JOIN mise_en_place_items mpi ON mpi.recipe_id = mi.recipe_id
      AND mpi.is_active = true
    JOIN mise_en_place_records mpr ON mpr.mise_en_place_item_id = mpi.id
      AND mpr.status = 'done'
    JOIN kitchen_shifts ks ON ks.id = mpr.kitchen_shift_id
      AND ks.date >= p_from::date
      AND ks.date <= p_to::date
    WHERE mi.recipe_id IS NOT NULL
      AND mi.is_active = true
    GROUP BY mi.id
  ),
  -- Ventas desde fudo_sales
  fudo_sold AS (
    SELECT
      mi.id AS menu_item_id,
      COALESCE(SUM(fs.quantity), 0) AS qty
    FROM menu_items mi
    JOIN fudo_sales fs ON fs.fudo_product_id = mi.fudo_product_id
      AND fs.sold_at >= p_from
      AND fs.sold_at <= p_to
    WHERE mi.fudo_product_id IS NOT NULL
      AND mi.is_active = true
    GROUP BY mi.id
  )
  SELECT
    mi.id                                            AS menu_item_id,
    mi.name                                          AS menu_item_name,
    mi.recipe_id,
    r.name                                           AS recipe_name,
    COALESCE(mp.qty, 0)                              AS qty_produced,
    COALESCE(fs.qty, 0)                              AS qty_sold,
    COALESCE(mp.qty, 0) - COALESCE(fs.qty, 0)       AS expected_remaining
  FROM menu_items mi
  LEFT JOIN recipes r ON r.id = mi.recipe_id
  LEFT JOIN mise_prod mp ON mp.menu_item_id = mi.id
  LEFT JOIN fudo_sold fs ON fs.menu_item_id = mi.id
  WHERE mi.is_active = true
    -- Include items with either production or sales
    AND (COALESCE(mp.qty, 0) + COALESCE(fs.qty, 0)) > 0
  ORDER BY
    COALESCE(mp.qty, 0) - COALESCE(fs.qty, 0) ASC;
$$;


--
-- Name: FUNCTION "menu_item_reconciliation"("p_from" timestamp with time zone, "p_to" timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION "public"."menu_item_reconciliation"("p_from" timestamp with time zone, "p_to" timestamp with time zone) IS 'Reconciliación por item de carta: producido (mise en place) vs vendido (Fudo) = restante esperado.';


--
-- Name: produce_recipe(bigint, numeric, "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."produce_recipe"("p_recipe_id" bigint, "p_portions" numeric, "p_reference_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_recipe_name  text;
  v_ingredient   record;
  v_total_qty    numeric;
  v_movement     jsonb;
  v_movements    jsonb := '[]'::jsonb;
  v_count        int := 0;
BEGIN
  -- Validar que la receta existe
  SELECT name INTO v_recipe_name
  FROM recipes
  WHERE id = p_recipe_id AND is_active = true;

  IF v_recipe_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Receta %s no encontrada o inactiva', p_recipe_id)
    );
  END IF;

  -- Validar porciones positivas
  IF p_portions <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'La cantidad de porciones debe ser mayor a 0'
    );
  END IF;

  -- Recorrer ingredientes de la receta
  FOR v_ingredient IN
    SELECT
      ri.stock_item_id,
      ri.qty_per_portion,
      si.name AS stock_item_name,
      si.current_qty
    FROM recipe_ingredients ri
    JOIN stock_items si ON si.id = ri.stock_item_id
    WHERE ri.recipe_id = p_recipe_id
  LOOP
    -- Calcular cantidad total a descontar
    v_total_qty := v_ingredient.qty_per_portion * p_portions;

    -- Llamar a register_stock_movement (ya existente)
    v_movement := register_stock_movement(
      p_stock_item_id  := v_ingredient.stock_item_id,
      p_change         := -v_total_qty,
      p_reason         := 'production',
      p_reference_type := 'daily_kitchen',
      p_reference_id   := p_reference_id
    );

    -- Agregar al array de resultados
    v_movements := v_movements || jsonb_build_object(
      'stock_item_id', v_ingredient.stock_item_id,
      'stock_item_name', v_ingredient.stock_item_name,
      'qty_deducted', v_total_qty,
      'previous_qty', v_ingredient.current_qty,
      'new_qty', (v_movement->>'new_qty')::numeric
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'recipe_id', p_recipe_id,
    'recipe_name', v_recipe_name,
    'portions', p_portions,
    'ingredients_affected', v_count,
    'movements', v_movements
  );
END;
$$;


--
-- Name: FUNCTION "produce_recipe"("p_recipe_id" bigint, "p_portions" numeric, "p_reference_id" "text"); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION "public"."produce_recipe"("p_recipe_id" bigint, "p_portions" numeric, "p_reference_id" "text") IS 'Descuenta insumos del stock según receta. Usado por Cocina Diaria.';


--
-- Name: production_dashboard(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."production_dashboard"("p_days" integer DEFAULT 30) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  result json;
  since timestamptz := now() - (p_days || ' days')::interval;
BEGIN
  SELECT json_build_object(
    'period_days', p_days,
    'total_completed', COALESCE((
      SELECT count(*) FROM production_orders
      WHERE status = 'completed' AND completed_at >= since
    ), 0),
    'total_input_kg', (
      SELECT COALESCE(sum(qty_used), 0) FROM production_inputs pi
      JOIN production_orders o ON o.id = pi.production_order_id
      WHERE o.status = 'completed' AND o.completed_at >= since
    ),
    'total_waste_kg', (
      SELECT COALESCE(sum(qty_produced), 0) FROM production_outputs po
      JOIN production_orders o ON o.id = po.production_order_id
      WHERE o.status = 'completed' AND o.completed_at >= since AND po.is_waste = true
    ),
    'avg_efficiency_pct', (
      SELECT CASE
        WHEN sum(pi_sub.total_input) > 0 THEN
          round((1 - sum(po_sub.total_waste) / sum(pi_sub.total_input)) * 100, 1)
        ELSE null
      END
      FROM production_orders o
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(qty_used), 0) as total_input
        FROM production_inputs WHERE production_order_id = o.id
      ) pi_sub ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(qty_produced), 0) as total_waste
        FROM production_outputs WHERE production_order_id = o.id AND is_waste = true
      ) po_sub ON true
      WHERE o.status = 'completed' AND o.completed_at >= since
    ),
    'pending_orders', COALESCE((
      SELECT count(*) FROM production_orders
      WHERE status IN ('draft', 'in_progress')
    ), 0),
    'by_chef', COALESCE((
      SELECT json_agg(row_to_json(t)) FROM (
        SELECT
          o.chef_id,
          COALESCE(p.first_name || ' ' || p.last_name, 'Sin asignar') as chef_name,
          count(*) as total_orders,
          round(avg(
            CASE WHEN pi_sub.total_input > 0
              THEN (1 - po_sub.total_waste / pi_sub.total_input) * 100
              ELSE null
            END
          ), 1) as avg_efficiency,
          COALESCE(sum(po_sub.total_waste), 0) as total_waste
        FROM production_orders o
        LEFT JOIN profiles p ON p.id = o.chef_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(sum(qty_used), 0) as total_input
          FROM production_inputs WHERE production_order_id = o.id
        ) pi_sub ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(sum(qty_produced), 0) as total_waste
          FROM production_outputs WHERE production_order_id = o.id AND is_waste = true
        ) po_sub ON true
        WHERE o.status = 'completed' AND o.completed_at >= since
        GROUP BY o.chef_id, p.first_name, p.last_name
        ORDER BY count(*) DESC
      ) t
    ), '[]'::json),
    'daily', COALESCE((
      SELECT json_agg(row_to_json(t)) FROM (
        SELECT
          o.completed_at::date as day,
          count(*) as orders,
          null::numeric as avg_efficiency
        FROM production_orders o
        WHERE o.status = 'completed' AND o.completed_at >= since
        GROUP BY o.completed_at::date
        ORDER BY day DESC
        LIMIT 30
      ) t
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;


--
-- Name: recalculate_semaphores(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."recalculate_semaphores"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE stock_items
  SET semaphore = CASE
    WHEN current_qty <= min_qty * 0.5 THEN 'red'
    WHEN current_qty <= min_qty THEN 'yellow'
    WHEN next_purchase_date IS NOT NULL AND next_purchase_date <= CURRENT_DATE THEN 'red'
    WHEN next_purchase_date IS NOT NULL AND next_purchase_date <= CURRENT_DATE + 2 THEN 'yellow'
    ELSE 'green'
  END,
  updated_at = now()
  WHERE is_active = true;
END;
$$;


--
-- Name: recipes_at_risk(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."recipes_at_risk"("p_min_portions" numeric DEFAULT 5) RETURNS TABLE("recipe_id" "uuid", "recipe_name" "text", "max_portions" numeric, "missing_items" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  WITH ingredient_yields AS (
    SELECT
      r.id AS recipe_id,
      r.name AS recipe_name,
      si.id AS stock_item_id,
      si.name AS stock_item_name,
      si.current_qty,
      ri.qty_per_portion,
      CASE
        WHEN ri.qty_per_portion > 0
        THEN FLOOR(si.current_qty / ri.qty_per_portion)
        ELSE 999999
      END AS item_yield
    FROM recipes r
    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    JOIN stock_items si ON si.id = ri.stock_item_id
    WHERE r.is_active = true
      AND si.is_active = true
  ),
  recipe_max AS (
    SELECT
      iy.recipe_id,
      iy.recipe_name,
      MIN(iy.item_yield) AS max_portions
    FROM ingredient_yields iy
    GROUP BY iy.recipe_id, iy.recipe_name
    HAVING MIN(iy.item_yield) < p_min_portions
  ),
  missing AS (
    SELECT
      iy.recipe_id,
      jsonb_agg(
        jsonb_build_object(
          'stock_item_id', iy.stock_item_id,
          'name', iy.stock_item_name,
          'current_qty', iy.current_qty,
          'needed_per_portion', iy.qty_per_portion,
          'needed_total', iy.qty_per_portion * p_min_portions,
          'deficit', GREATEST(iy.qty_per_portion * p_min_portions - iy.current_qty, 0)
        ) ORDER BY (iy.qty_per_portion * p_min_portions - iy.current_qty) DESC
      ) FILTER (WHERE iy.item_yield < p_min_portions) AS missing_items
    FROM ingredient_yields iy
    WHERE iy.recipe_id IN (SELECT recipe_id FROM recipe_max)
    GROUP BY iy.recipe_id
  )
  SELECT
    rm.recipe_id,
    rm.recipe_name,
    rm.max_portions,
    COALESCE(m.missing_items, '[]'::jsonb) AS missing_items
  FROM recipe_max rm
  LEFT JOIN missing m ON m.recipe_id = rm.recipe_id
  ORDER BY rm.max_portions ASC;
$$;


--
-- Name: FUNCTION "recipes_at_risk"("p_min_portions" numeric); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION "public"."recipes_at_risk"("p_min_portions" numeric) IS 'Devuelve recetas que no pueden cubrir p_min_portions porciones con el stock actual.';


--
-- Name: resolve_alert("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."resolve_alert"("p_alert_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE stock_alerts
  SET status = 'resolved',
      resolved_at = NOW(),
      resolved_by = auth.uid()
  WHERE id = p_alert_id::uuid;
END;
$$;


--
-- Name: resolve_alert("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."resolve_alert"("p_alert_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NOT is_encargado() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos');
  END IF;

  UPDATE stock_alerts
  SET status = 'resolved',
      resolved_at = now(),
      resolved_by = auth.uid()
  WHERE id = p_alert_id AND status = 'active';

  RETURN jsonb_build_object('success', true);
END;
$$;


--
-- Name: set_supplier_links("jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_supplier_links"("p_changes" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  c      jsonb;
  v_item uuid;
  v_sup  uuid;
  v_op   text;
  v_n    integer := 0;
begin
  if not is_encargado() then
    raise exception 'Solo encargados y socios pueden vincular proveedores' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array'
     or jsonb_array_length(p_changes) = 0 or jsonb_array_length(p_changes) > 500 then
    raise exception 'Cambios inválidos (entre 1 y 500)' using errcode = '22023';
  end if;

  select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    into v_name from profiles where id = v_uid;

  for c in select * from jsonb_array_elements(p_changes) loop
    v_item := (c ->> 'item_id')::uuid;
    v_sup  := (c ->> 'supplier_id')::uuid;
    v_op   := c ->> 'op';

    if v_item is null or v_sup is null then
      raise exception 'Falta item_id o supplier_id' using errcode = '22023';
    end if;
    if not exists (select 1 from stock_items where id = v_item and is_active) then
      raise exception 'El insumo % no existe o está inactivo', v_item using errcode = '22023';
    end if;
    if v_op in ('primary', 'add') and not exists (select 1 from suppliers where id = v_sup and is_active) then
      raise exception 'El proveedor % no existe o está inactivo', v_sup using errcode = '22023';
    end if;

    if v_op = 'primary' then
      update stock_item_suppliers set is_primary = false, updated_at = now()
       where stock_item_id = v_item and is_primary and supplier_id <> v_sup;
      insert into stock_item_suppliers (stock_item_id, supplier_id, is_primary, source, confirmed_by, confirmed_at)
      values (v_item, v_sup, true, 'manual', v_uid, now())
      on conflict (stock_item_id, supplier_id) do update
        set is_primary = true, dismissed_at = null, dismissed_by = null,
            confirmed_by = v_uid, confirmed_at = now(), updated_at = now();

    elsif v_op = 'add' then
      insert into stock_item_suppliers (stock_item_id, supplier_id, is_primary, source, confirmed_by, confirmed_at)
      values (
        v_item, v_sup,
        not exists (select 1 from stock_item_suppliers where stock_item_id = v_item and is_primary),
        'manual', v_uid, now()
      )
      on conflict (stock_item_id, supplier_id) do update
        set dismissed_at = null, dismissed_by = null,
            confirmed_by = v_uid, confirmed_at = now(), updated_at = now();

    elsif v_op = 'confirm' then
      update stock_item_suppliers
         set confirmed_by = v_uid, confirmed_at = now(), updated_at = now()
       where stock_item_id = v_item and supplier_id = v_sup and dismissed_at is null;
      if not found then
        raise exception 'No existe ese vínculo para confirmar' using errcode = '22023';
      end if;

    elsif v_op = 'remove' then
      update stock_item_suppliers
         set is_primary = false, dismissed_by = v_uid, dismissed_at = now(), updated_at = now()
       where stock_item_id = v_item and supplier_id = v_sup and dismissed_at is null;
      -- Si quedó sin principal, asciende la alternativa con más compras en Fudo.
      if not exists (select 1 from stock_item_suppliers where stock_item_id = v_item and is_primary) then
        update stock_item_suppliers set is_primary = true, updated_at = now()
         where (stock_item_id, supplier_id) = (
           select stock_item_id, supplier_id from stock_item_suppliers
            where stock_item_id = v_item and dismissed_at is null
            order by fudo_purchases desc, last_purchase_at desc nulls last, created_at
            limit 1
         );
      end if;

    else
      raise exception 'Operación inválida: %', v_op using errcode = '22023';
    end if;

    v_n := v_n + 1;
  end loop;

  insert into audit_trail (user_id, user_name, action, module, entity_type, entity_id, description, metadata)
  values (
    v_uid, v_name, 'set_supplier_links', 'proveedores', 'stock_item',
    case when v_n = 1 then v_item::text end,
    format('%s actualizó %s vínculo%s producto–proveedor', coalesce(v_name, 'Usuario'), v_n, case when v_n = 1 then '' else 's' end),
    jsonb_build_object('changes', p_changes)
  );

  return jsonb_build_object('applied', v_n);
end $$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: stock_reconciliation(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."stock_reconciliation"("p_from" timestamp with time zone DEFAULT (CURRENT_DATE)::timestamp with time zone, "p_to" timestamp with time zone DEFAULT "now"()) RETURNS TABLE("stock_item_id" "uuid", "name" "text", "unit" "text", "opening_qty" numeric, "received" numeric, "prod_in" numeric, "prod_out" numeric, "sales" numeric, "waste" numeric, "manual_adj" numeric, "expected_closing" numeric, "actual_closing" numeric, "variance" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  WITH period_movements AS (
    SELECT
      sm.stock_item_id,
      SUM(CASE WHEN sm.movement_type = 'entrada' THEN sm.qty
               WHEN sm.movement_type IN ('uso', 'desperdicio') THEN -sm.qty
               WHEN sm.movement_type = 'ajuste' THEN sm.qty - sm.previous_qty
               ELSE 0 END)
        AS total_change,
      COALESCE(SUM(sm.qty) FILTER (WHERE sm.movement_type = 'entrada'), 0)
        AS received,
      0::numeric AS prod_in,
      COALESCE(SUM(-sm.qty) FILTER (WHERE sm.movement_type = 'uso'), 0)
        AS prod_out,
      0::numeric AS sales,
      COALESCE(SUM(-sm.qty) FILTER (WHERE sm.movement_type = 'desperdicio'), 0)
        AS waste,
      COALESCE(SUM(sm.new_qty - sm.previous_qty) FILTER (WHERE sm.movement_type = 'ajuste'), 0)
        AS manual_adj
    FROM stock_movements sm
    WHERE sm.created_at >= p_from
      AND sm.created_at <= p_to
    GROUP BY sm.stock_item_id
  )
  SELECT
    si.id                                          AS stock_item_id,
    si.name,
    si.unit,
    si.current_qty - COALESCE(pm.total_change, 0)  AS opening_qty,
    COALESCE(pm.received, 0)                        AS received,
    COALESCE(pm.prod_in, 0)                         AS prod_in,
    COALESCE(pm.prod_out, 0)                        AS prod_out,
    COALESCE(pm.sales, 0)                           AS sales,
    COALESCE(pm.waste, 0)                           AS waste,
    COALESCE(pm.manual_adj, 0)                      AS manual_adj,
    (si.current_qty - COALESCE(pm.total_change, 0))
      + COALESCE(pm.received, 0)
      + COALESCE(pm.prod_in, 0)
      + COALESCE(pm.prod_out, 0)
      + COALESCE(pm.sales, 0)
      + COALESCE(pm.waste, 0)
      + COALESCE(pm.manual_adj, 0)                  AS expected_closing,
    si.current_qty                                   AS actual_closing,
    si.current_qty - (
      (si.current_qty - COALESCE(pm.total_change, 0))
        + COALESCE(pm.received, 0)
        + COALESCE(pm.prod_in, 0)
        + COALESCE(pm.prod_out, 0)
        + COALESCE(pm.sales, 0)
        + COALESCE(pm.waste, 0)
        + COALESCE(pm.manual_adj, 0)
    )                                                AS variance
  FROM stock_items si
  LEFT JOIN period_movements pm ON pm.stock_item_id = si.id
  WHERE si.is_active = true
  ORDER BY
    ABS(COALESCE(pm.total_change, 0)) DESC,
    si.name;
$$;


--
-- Name: FUNCTION "stock_reconciliation"("p_from" timestamp with time zone, "p_to" timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION "public"."stock_reconciliation"("p_from" timestamp with time zone, "p_to" timestamp with time zone) IS 'Reconciliación de stock por periodo: opening + entradas - salidas = expected vs actual.';


--
-- Name: stock_yield(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."stock_yield"() RETURNS TABLE("recipe_id" "uuid", "recipe_name" "text", "yield_portions" numeric, "max_portions" numeric, "limiting_item" "text", "limiting_qty" numeric, "limiting_need" numeric, "ingredients" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  WITH ingredient_yields AS (
    SELECT
      r.id AS recipe_id,
      r.name AS recipe_name,
      r.yield_portions,
      si.id AS stock_item_id,
      si.name AS stock_item_name,
      si.current_qty,
      ri.qty_per_portion,
      CASE
        WHEN ri.qty_per_portion > 0
        THEN FLOOR(si.current_qty / ri.qty_per_portion)
        ELSE 999999
      END AS item_yield
    FROM recipes r
    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    JOIN stock_items si ON si.id = ri.stock_item_id
    WHERE r.is_active = true
      AND si.is_active = true
  ),
  recipe_max AS (
    SELECT
      iy.recipe_id,
      iy.recipe_name,
      iy.yield_portions,
      MIN(iy.item_yield) AS max_portions
    FROM ingredient_yields iy
    GROUP BY iy.recipe_id, iy.recipe_name, iy.yield_portions
  ),
  limiting AS (
    SELECT DISTINCT ON (iy.recipe_id)
      iy.recipe_id,
      iy.stock_item_name AS limiting_item,
      iy.current_qty AS limiting_qty,
      iy.qty_per_portion AS limiting_need
    FROM ingredient_yields iy
    JOIN recipe_max rm ON rm.recipe_id = iy.recipe_id
      AND iy.item_yield = rm.max_portions
    ORDER BY iy.recipe_id, iy.stock_item_name
  ),
  details AS (
    SELECT
      iy.recipe_id,
      jsonb_agg(
        jsonb_build_object(
          'stock_item_id', iy.stock_item_id,
          'name', iy.stock_item_name,
          'current_qty', iy.current_qty,
          'qty_per_portion', iy.qty_per_portion,
          'yield', iy.item_yield
        ) ORDER BY iy.item_yield
      ) AS ingredients
    FROM ingredient_yields iy
    GROUP BY iy.recipe_id
  )
  SELECT
    rm.recipe_id,
    rm.recipe_name,
    rm.yield_portions,
    rm.max_portions,
    l.limiting_item,
    l.limiting_qty,
    l.limiting_need,
    d.ingredients
  FROM recipe_max rm
  JOIN limiting l ON l.recipe_id = rm.recipe_id
  JOIN details d ON d.recipe_id = rm.recipe_id
  ORDER BY rm.max_portions ASC;
$$;


--
-- Name: FUNCTION "stock_yield"(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION "public"."stock_yield"() IS 'Calcula cuántas porciones de cada receta se pueden hacer con el stock actual.';


--
-- Name: sync_item_supplier_to_links(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."sync_item_supplier_to_links"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id then return null; end if;

  update stock_item_suppliers
     set is_primary = false, updated_at = now()
   where stock_item_id = new.id and is_primary
     and supplier_id is distinct from new.supplier_id;

  if new.supplier_id is not null then
    insert into stock_item_suppliers (stock_item_id, supplier_id, is_primary, source)
    values (new.id, new.supplier_id, true, 'manual')
    on conflict (stock_item_id, supplier_id) do update
      set is_primary = true, dismissed_at = null, dismissed_by = null, updated_at = now();
  end if;
  return null;
end $$;


--
-- Name: sync_primary_supplier_to_item(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."sync_primary_supplier_to_item"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_item uuid := coalesce(new.stock_item_id, old.stock_item_id);
  v_primary uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  select supplier_id into v_primary
  from stock_item_suppliers
  where stock_item_id = v_item and is_primary
  limit 1;
  update stock_items
     set supplier_id = v_primary, updated_at = now()
   where id = v_item and supplier_id is distinct from v_primary;
  return null;
end $$;


--
-- Name: trg_fudo_sales_deduct_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."trg_fudo_sales_deduct_stock"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := deduct_stock_on_sale(NEW.id);

  -- Log del resultado (visible en Supabase logs de Postgres)
  IF (v_result->>'success')::boolean = false THEN
    RAISE NOTICE '[fudo_sales trigger] Sale % — error: %',
      NEW.id, v_result->>'error';
  ELSE
    RAISE NOTICE '[fudo_sales trigger] Sale % — % ingredientes afectados',
      NEW.id, v_result->>'ingredients_affected';
  END IF;

  -- Nunca abortamos la inserción, incluso si falla la deducción
  RETURN NEW;
END;
$$;


--
-- Name: unir_insumos("uuid", "uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."unir_insumos"("p_duplicado" "uuid", "p_bueno" "uuid", "p_user" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  d record;
  b record;
  n_recetas int := 0;
  n_platos int := 0;
  n_prod int := 0;
  n_prov int := 0;
  n int;
begin
  if p_duplicado = p_bueno then raise exception 'Es el mismo insumo'; end if;
  select id, name, unit, is_active into d from stock_items where id = p_duplicado for update;
  select id, name, unit, is_active into b from stock_items where id = p_bueno for update;
  if d.id is null or b.id is null then raise exception 'Insumo no encontrado'; end if;
  if not b.is_active then raise exception 'El insumo correcto (%) está inactivo', b.name; end if;
  if d.unit is distinct from b.unit then
    raise exception 'Unidades distintas (% en %, % en %): no se pueden unir', d.unit, d.name, b.unit, b.name;
  end if;

  update recipe_ingredients set stock_item_id = p_bueno where stock_item_id = p_duplicado;
  get diagnostics n_recetas = row_count;
  update menu_items set consumo_stock_item_id = p_bueno where consumo_stock_item_id = p_duplicado;
  get diagnostics n_platos = row_count;
  update recipes set output_stock_item_id = p_bueno where output_stock_item_id = p_duplicado;
  get diagnostics n = row_count; n_prod := n_prod + n;
  update production_template_inputs set stock_item_id = p_bueno where stock_item_id = p_duplicado;
  get diagnostics n = row_count; n_prod := n_prod + n;
  update production_template_outputs set stock_item_id = p_bueno where stock_item_id = p_duplicado;
  get diagnostics n = row_count; n_prod := n_prod + n;
  update production_templates set default_input_stock_item_id = p_bueno where default_input_stock_item_id = p_duplicado;
  get diagnostics n = row_count; n_prod := n_prod + n;

  insert into stock_item_suppliers (stock_item_id, supplier_id, is_primary, source, fudo_purchases, last_purchase_at, confirmed_by, confirmed_at)
  select p_bueno, s.supplier_id, false, s.source, s.fudo_purchases, s.last_purchase_at, s.confirmed_by, s.confirmed_at
  from stock_item_suppliers s
  where s.stock_item_id = p_duplicado and s.dismissed_at is null
    and not exists (select 1 from stock_item_suppliers x where x.stock_item_id = p_bueno and x.supplier_id = s.supplier_id);
  get diagnostics n_prov = row_count;
  delete from stock_item_suppliers where stock_item_id = p_duplicado;

  if to_regclass('public.stock_count_aliases') is not null then
    execute 'update stock_count_aliases set stock_item_id = $1 where stock_item_id = $2' using p_bueno, p_duplicado;
  end if;

  update stock_items
     set is_active = false, fudo_ingredient_id = null, fudo_product_id = null, fudo_skip = true, updated_at = now()
   where id = p_duplicado;

  update fudo_sync_incidents set status = 'resolved', resolved_at = now(), resolved_by = p_user, updated_at = now()
   where stock_item_id = p_duplicado::text and status = 'open';

  return jsonb_build_object('duplicado', d.name, 'bueno', b.name, 'recetas', n_recetas, 'platos', n_platos, 'produccion', n_prod, 'proveedores', n_prov);
end;
$_$;


--
-- Name: update_stock_qty("text", numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."update_stock_qty"("p_item_id" "text", "p_new_qty" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE stock_items
  SET current_qty = p_new_qty
  WHERE id = p_item_id::bigint;
END;
$$;


--
-- Name: update_stock_qty("uuid", numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."update_stock_qty"("p_item_id" "uuid", "p_new_qty" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_semaphore text;
  v_min_qty numeric;
  v_next_date date;
BEGIN
  -- Solo encargado puede actualizar
  IF NOT is_encargado() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin permisos');
  END IF;

  SELECT min_qty, next_purchase_date INTO v_min_qty, v_next_date
  FROM stock_items WHERE id = p_item_id;

  -- Calcular semáforo
  v_semaphore := CASE
    WHEN p_new_qty <= v_min_qty * 0.5 THEN 'red'
    WHEN p_new_qty <= v_min_qty THEN 'yellow'
    WHEN v_next_date IS NOT NULL AND v_next_date <= CURRENT_DATE THEN 'red'
    WHEN v_next_date IS NOT NULL AND v_next_date <= CURRENT_DATE + 2 THEN 'yellow'
    ELSE 'green'
  END;

  UPDATE stock_items
  SET current_qty = p_new_qty,
      semaphore = v_semaphore,
      updated_at = now()
  WHERE id = p_item_id;

  RETURN jsonb_build_object('success', true, 'semaphore', v_semaphore);
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: _backup_menu_items_20260728; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."_backup_menu_items_20260728" (
    "id" "uuid",
    "recipe_id" "uuid"
);


--
-- Name: _backup_recipe_ingredients_20260728; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."_backup_recipe_ingredients_20260728" (
    "id" bigint,
    "recipe_id" "uuid",
    "stock_item_id" "uuid",
    "qty_per_portion" numeric,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "ingredient_unit" "text",
    "notes" "text"
);


--
-- Name: _backup_recipes_20260728; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."_backup_recipes_20260728" (
    "id" "uuid",
    "name" "text",
    "category" "text",
    "ingredients" "jsonb",
    "preparation" "text",
    "notes" "text",
    "created_by" "uuid",
    "is_active" boolean,
    "yield_portions" integer,
    "cost_per_portion" numeric,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "slug" "text",
    "output_stock_item_id" "uuid"
);


--
-- Name: announcement_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."announcement_reads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "announcement_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "read_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid"
);


--
-- Name: attendance_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."attendance_config" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


--
-- Name: attendance_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."attendance_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "operative_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "clock_in_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "clock_out_at" timestamp with time zone,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "clock_out_type" "text" DEFAULT 'manual'::"text",
    "edited_by" "uuid",
    "original_clock_out" timestamp with time zone,
    "clock_in_lat" numeric,
    "clock_in_lng" numeric,
    "clock_in_accuracy" numeric,
    "clock_out_lat" numeric,
    "clock_out_lng" numeric,
    "clock_out_accuracy" numeric,
    "clock_in_selfie_url" "text",
    "clock_out_selfie_url" "text",
    "device_fingerprint" "text",
    "network_ip" "text",
    "is_suspicious" boolean DEFAULT false,
    "suspicious_reasons" "text"[] DEFAULT '{}'::"text"[],
    "clock_in_type" "text" DEFAULT 'manual'::"text",
    "edit_reason" "text",
    "original_clock_in" timestamp with time zone,
    CONSTRAINT "attendance_logs_clock_out_type_check" CHECK (("clock_out_type" = ANY (ARRAY['manual'::"text", 'auto'::"text", 'edited'::"text"]))),
    CONSTRAINT "attendance_logs_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text", 'missing_checkout'::"text"])))
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."audit_log" (
    "id" bigint NOT NULL,
    "table_name" "text" NOT NULL,
    "action" "text" NOT NULL,
    "user_id" "uuid",
    "old_data" "jsonb",
    "new_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_log_action_check" CHECK (("action" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text"])))
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."audit_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: audit_trail; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."audit_trail" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "user_name" "text",
    "action" "text" NOT NULL,
    "module" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "text",
    "description" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: audit_trail_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."audit_trail_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_trail_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."audit_trail_id_seq" OWNED BY "public"."audit_trail"."id";


--
-- Name: bar_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."bar_orders" (
    "id" bigint NOT NULL,
    "product_name" "text" NOT NULL,
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "quantity" "text" DEFAULT '1'::"text" NOT NULL,
    "urgency" "text" DEFAULT 'normal'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "note" "text",
    "requested_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "supplier_id" "uuid",
    "bar_stock_item_id" bigint,
    "stock_item_id" "uuid",
    "received_qty" "text",
    "unit_cost" numeric,
    "expires_at" "date",
    "received_by" "uuid",
    "received_at" timestamp with time zone,
    "ordered_at" timestamp with time zone,
    "fudo_expense_id" "text",
    "fudo_amount" numeric,
    "received_mode" "text",
    "received_note" "text",
    CONSTRAINT "bar_orders_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'ordered'::"text", 'received'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "bar_orders_urgency_check" CHECK (("urgency" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'critical'::"text"])))
);


--
-- Name: bar_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."bar_orders_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bar_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."bar_orders_id_seq" OWNED BY "public"."bar_orders"."id";


--
-- Name: bar_product_recipes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."bar_product_recipes" (
    "id" bigint NOT NULL,
    "fudo_product_id" "text" NOT NULL,
    "fudo_product_name" "text" NOT NULL,
    "bar_stock_item_id" bigint NOT NULL,
    "qty_per_unit" numeric DEFAULT 0 NOT NULL,
    "unit" "text" DEFAULT 'gr'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: bar_product_recipes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."bar_product_recipes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bar_product_recipes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."bar_product_recipes_id_seq" OWNED BY "public"."bar_product_recipes"."id";


--
-- Name: bar_shift_handover; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."bar_shift_handover" (
    "id" bigint NOT NULL,
    "shift_type" "text" NOT NULL,
    "date" "text" NOT NULL,
    "closed_by" "uuid",
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bar_shift_handover_shift_type_check" CHECK (("shift_type" = ANY (ARRAY['morning'::"text", 'night'::"text"])))
);


--
-- Name: bar_shift_handover_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."bar_shift_handover_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bar_shift_handover_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."bar_shift_handover_id_seq" OWNED BY "public"."bar_shift_handover"."id";


--
-- Name: bar_stock_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."bar_stock_items" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "unit" "text" DEFAULT 'unidades'::"text" NOT NULL,
    "current_qty" numeric DEFAULT 0 NOT NULL,
    "current_detail" "text",
    "min_level" numeric DEFAULT 0 NOT NULL,
    "is_urgent" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "supplier_id" "uuid",
    CONSTRAINT "bar_stock_items_category_check" CHECK (("category" = ANY (ARRAY['lacteos'::"text", 'cafe'::"text", 'packaging'::"text", 'suministros'::"text", 'insumos_oyambre'::"text", 'libreria'::"text", 'general'::"text"])))
);


--
-- Name: bar_stock_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."bar_stock_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bar_stock_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."bar_stock_items_id_seq" OWNED BY "public"."bar_stock_items"."id";


--
-- Name: bar_stock_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."bar_stock_logs" (
    "id" bigint NOT NULL,
    "bar_stock_item_id" bigint NOT NULL,
    "user_id" "uuid",
    "action" "text" DEFAULT 'update'::"text" NOT NULL,
    "old_qty" numeric,
    "new_qty" numeric,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: bar_stock_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."bar_stock_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bar_stock_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."bar_stock_logs_id_seq" OWNED BY "public"."bar_stock_logs"."id";


--
-- Name: checklist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."checklist_items" (
    "id" bigint NOT NULL,
    "kitchen_shift_id" bigint NOT NULL,
    "template_id" bigint,
    "title" "text" NOT NULL,
    "type" "text" NOT NULL,
    "timing" "text" NOT NULL,
    "scheduled_time" "text",
    "family" "text" DEFAULT 'general'::"text" NOT NULL,
    "is_critical" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "completed_by" "uuid",
    "completed_at" timestamp with time zone,
    "note" "text",
    "is_alert_sent" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "checklist_items_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'done'::"text", 'skipped'::"text", 'overdue'::"text"]))),
    CONSTRAINT "checklist_items_timing_check" CHECK (("timing" = ANY (ARRAY['on_arrival'::"text", 'pre_service'::"text", 'during_service'::"text", 'closing'::"text", 'scheduled'::"text"]))),
    CONSTRAINT "checklist_items_type_check" CHECK (("type" = ANY (ARRAY['opening'::"text", 'production'::"text", 'service'::"text", 'closing'::"text"])))
);


--
-- Name: TABLE "checklist_items"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."checklist_items" IS 'Instancia de tarea en un turno real (copiado de template)';


--
-- Name: COLUMN "checklist_items"."title"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."checklist_items"."title" IS 'Copiado del template al crear el turno, para historial';


--
-- Name: COLUMN "checklist_items"."is_alert_sent"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."checklist_items"."is_alert_sent" IS 'Flag para evitar alertas duplicadas';


--
-- Name: checklist_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."checklist_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: checklist_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."checklist_items_id_seq" OWNED BY "public"."checklist_items"."id";


--
-- Name: checklist_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."checklist_templates" (
    "id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "type" "text" NOT NULL,
    "shift" "text" NOT NULL,
    "timing" "text" NOT NULL,
    "scheduled_time" "text",
    "family" "text" DEFAULT 'general'::"text" NOT NULL,
    "is_critical" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "checklist_templates_family_check" CHECK (("family" = ANY (ARRAY['equipment'::"text", 'proteins'::"text", 'vegetables'::"text", 'pastry'::"text", 'bread'::"text", 'dairy'::"text", 'cold_storage'::"text", 'mise_en_place'::"text", 'general'::"text"]))),
    CONSTRAINT "checklist_templates_shift_check" CHECK (("shift" = ANY (ARRAY['morning'::"text", 'night'::"text", 'both'::"text"]))),
    CONSTRAINT "checklist_templates_timing_check" CHECK (("timing" = ANY (ARRAY['on_arrival'::"text", 'pre_service'::"text", 'during_service'::"text", 'closing'::"text", 'scheduled'::"text"]))),
    CONSTRAINT "checklist_templates_type_check" CHECK (("type" = ANY (ARRAY['opening'::"text", 'production'::"text", 'service'::"text", 'closing'::"text"])))
);


--
-- Name: TABLE "checklist_templates"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."checklist_templates" IS 'Plantillas de tareas de cocina, editables por encargados';


--
-- Name: COLUMN "checklist_templates"."timing"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."checklist_templates"."timing" IS 'Cuándo se debe ejecutar: on_arrival, pre_service, scheduled, etc.';


--
-- Name: COLUMN "checklist_templates"."family"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."checklist_templates"."family" IS 'Familia/categoría: proteínas, verduras, equipos, mise_en_place, etc.';


--
-- Name: COLUMN "checklist_templates"."is_critical"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."checklist_templates"."is_critical" IS 'Si true, genera alerta cuando está overdue';


--
-- Name: checklist_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."checklist_templates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: checklist_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."checklist_templates_id_seq" OWNED BY "public"."checklist_templates"."id";


--
-- Name: closing_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."closing_hours" (
    "id" bigint NOT NULL,
    "day_of_week" integer NOT NULL,
    "closing_time" time without time zone NOT NULL,
    "is_default" boolean DEFAULT true NOT NULL,
    "override_date" "date",
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: closing_hours_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."closing_hours_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: closing_hours_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."closing_hours_id_seq" OWNED BY "public"."closing_hours"."id";


--
-- Name: device_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."device_registry" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "fingerprint" "text" NOT NULL,
    "device_label" "text",
    "is_trusted" boolean DEFAULT false,
    "first_seen_at" timestamp with time zone DEFAULT "now"(),
    "last_seen_at" timestamp with time zone DEFAULT "now"()
);


--
-- Name: device_registry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."device_registry" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."device_registry_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: expediente_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."expediente_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "expediente_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'comment'::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "expediente_comments_type_check" CHECK (("type" = ANY (ARRAY['comment'::"text", 'status_change'::"text", 'assignment_change'::"text", 'priority_change'::"text", 'edit'::"text"])))
);


--
-- Name: expediente_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."expediente_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "expediente_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "assigned_to" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "due_date" "date",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "expediente_tasks_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'done'::"text", 'cancelled'::"text"])))
);


--
-- Name: expedientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."expedientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" DEFAULT ''::"text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "type" "text" NOT NULL,
    "areas" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "urgency" "text" DEFAULT 'media'::"text" NOT NULL,
    "priority" smallint,
    "impact_categories" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "status" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "close_reason" "text",
    "author_id" "uuid" NOT NULL,
    "responsible_id" "uuid",
    "approver_id" "uuid",
    "target_date" "date",
    "closed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "expedientes_status_check" CHECK (("status" = ANY (ARRAY['borrador'::"text", 'presentado'::"text", 'en_revision'::"text", 'admitido'::"text", 'asignado'::"text", 'en_ejecucion'::"text", 'pausado'::"text", 'pendiente_tercero'::"text", 'pendiente_decision'::"text", 'revision_final'::"text", 'cumplido'::"text", 'cerrado_sin_implementacion'::"text", 'archivado'::"text"]))),
    CONSTRAINT "expedientes_type_check" CHECK (("type" = ANY (ARRAY['idea'::"text", 'tarea'::"text", 'proyecto'::"text", 'incidencia'::"text", 'mejora'::"text", 'compra'::"text", 'mantenimiento'::"text", 'contenido'::"text", 'desarrollo_gastronomico'::"text", 'experiencia_cliente'::"text", 'estetica'::"text", 'gestion_terceros'::"text"]))),
    CONSTRAINT "expedientes_urgency_check" CHECK (("urgency" = ANY (ARRAY['baja'::"text", 'media'::"text", 'alta'::"text", 'critica'::"text"])))
);


--
-- Name: fudo_sale_subitems; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."fudo_sale_subitems" (
    "fudo_subitem_id" "text" NOT NULL,
    "fudo_sale_item_id" "text" NOT NULL,
    "fudo_ticket_id" "text" NOT NULL,
    "fudo_product_id" "text" NOT NULL,
    "quantity" numeric DEFAULT 1 NOT NULL,
    "price" numeric,
    "sold_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: TABLE "fudo_sale_subitems"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."fudo_sale_subitems" IS 'Sub-ítems (modificadores/opciones) de cada ítem vendido en Fudo. Los escribe sales-sync.';


--
-- Name: fudo_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."fudo_sales" (
    "id" bigint NOT NULL,
    "fudo_ticket_id" "text" NOT NULL,
    "fudo_product_id" "text" NOT NULL,
    "quantity" numeric DEFAULT 0 NOT NULL,
    "sold_at" timestamp with time zone NOT NULL,
    "raw_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fudo_sale_item_id" "text"
);


--
-- Name: TABLE "fudo_sales"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."fudo_sales" IS 'Ventas importadas desde Fudo (una fila por producto por ticket)';


--
-- Name: fudo_consumo; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW "public"."fudo_consumo" WITH ("security_invoker"='on') AS
 SELECT ('v'::"text" || ("fs"."id")::"text") AS "id",
    "fs"."fudo_ticket_id",
    "fs"."fudo_product_id",
    "fs"."quantity",
    "fs"."sold_at",
    false AS "es_subitem"
   FROM "public"."fudo_sales" "fs"
UNION ALL
 SELECT ('s'::"text" || "ss"."fudo_subitem_id") AS "id",
    "ss"."fudo_ticket_id",
    "ss"."fudo_product_id",
    "ss"."quantity",
    "ss"."sold_at",
    true AS "es_subitem"
   FROM "public"."fudo_sale_subitems" "ss";


--
-- Name: VIEW "fudo_consumo"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW "public"."fudo_consumo" IS 'Qué se consumió: ítems vendidos + sub-ítems elegidos. Fuente de los cálculos de consumo.';


--
-- Name: fudo_reintentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."fudo_reintentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tipo" "text" NOT NULL,
    "stock_item_id" "uuid",
    "delta" numeric,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "origen" "text" NOT NULL,
    "nota" "text",
    "stock_movement_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "intentos" integer DEFAULT 0 NOT NULL,
    "ultimo_error" "text",
    "proximo_intento_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "alertado_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hecho_at" timestamp with time zone,
    CONSTRAINT "fudo_reintentos_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'hecho'::"text", 'descartado'::"text"]))),
    CONSTRAINT "fudo_reintentos_tipo_check" CHECK (("tipo" = ANY (ARRAY['stock_delta'::"text", 'pago_gasto'::"text"])))
);


--
-- Name: fudo_sales_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."fudo_sales_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fudo_sales_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."fudo_sales_id_seq" OWNED BY "public"."fudo_sales"."id";


--
-- Name: fudo_salud; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."fudo_salud" (
    "id" integer DEFAULT 1 NOT NULL,
    "ultimo_ok_at" timestamp with time zone,
    "ultimo_error_at" timestamp with time zone,
    "ultimo_error" "text",
    "fallas_seguidas" integer DEFAULT 0 NOT NULL,
    "caida_avisada_at" timestamp with time zone,
    "ultima_lectura_stock_at" timestamp with time zone,
    "ultimo_menu_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fudo_salud_id_check" CHECK (("id" = 1))
);


--
-- Name: fudo_sync_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."fudo_sync_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "operation" "text" NOT NULL,
    "direction" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "entity_type" "text",
    "entity_id" "text",
    "stock_item_id" "text",
    "fudo_type" "text",
    "fudo_id" "text",
    "idempotency_key" "text",
    "request_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "response_payload" "jsonb",
    "error_message" "text",
    "attempts" integer DEFAULT 1 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "fudo_sync_events_direction_check" CHECK (("direction" = ANY (ARRAY['fudo_to_lve'::"text", 'lve_to_fudo'::"text", 'read'::"text"]))),
    CONSTRAINT "fudo_sync_events_fudo_type_check" CHECK ((("fudo_type" IS NULL) OR ("fudo_type" = ANY (ARRAY['ingredient'::"text", 'product'::"text", 'sale'::"text", 'provider'::"text"])))),
    CONSTRAINT "fudo_sync_events_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'success'::"text", 'failed'::"text", 'skipped'::"text"])))
);


--
-- Name: fudo_sync_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."fudo_sync_incidents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source" "text" DEFAULT 'audit'::"text" NOT NULL,
    "code" "text" NOT NULL,
    "severity" "text" DEFAULT 'medium'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "entity_type" "text",
    "entity_id" "text",
    "stock_item_id" "text",
    "fudo_type" "text",
    "fudo_id" "text",
    "incident_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "detail" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fudo_sync_incidents_fudo_type_check" CHECK ((("fudo_type" IS NULL) OR ("fudo_type" = ANY (ARRAY['ingredient'::"text", 'product'::"text", 'sale'::"text", 'provider'::"text"])))),
    CONSTRAINT "fudo_sync_incidents_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "fudo_sync_incidents_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'resolved'::"text", 'ignored'::"text"])))
);


--
-- Name: kitchen_daily_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."kitchen_daily_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "operative_date" "date" NOT NULL,
    "service" "text" NOT NULL,
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "notes" "text",
    "status" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "submitted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "kitchen_daily_logs_service_check" CHECK (("service" = ANY (ARRAY['desayuno_merienda'::"text", 'almuerzo_cena'::"text"]))),
    CONSTRAINT "kitchen_daily_logs_status_check" CHECK (("status" = ANY (ARRAY['borrador'::"text", 'enviado'::"text"])))
);


--
-- Name: kitchen_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."kitchen_orders" (
    "id" bigint NOT NULL,
    "product_name" "text" NOT NULL,
    "category" "text" DEFAULT 'verduleria'::"text" NOT NULL,
    "quantity" "text" NOT NULL,
    "urgency" "text" DEFAULT 'normal'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "supplier_id" "uuid",
    "stock_item_id" "uuid",
    "received_qty" "text",
    "unit_cost" numeric,
    "expires_at" "date",
    "received_by" "uuid",
    "received_at" timestamp with time zone,
    "ordered_at" timestamp with time zone,
    "fudo_expense_id" "text",
    "fudo_amount" numeric,
    "received_mode" "text",
    "received_note" "text",
    CONSTRAINT "kitchen_orders_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'ordered'::"text", 'received'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "kitchen_orders_urgency_check" CHECK (("urgency" = ANY (ARRAY['normal'::"text", 'alta'::"text", 'urgente'::"text"])))
);


--
-- Name: COLUMN "kitchen_orders"."received_mode"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."kitchen_orders"."received_mode" IS 'fudo_expense (la compra se cargó en Fudo, LVE no toca stock) | lve_stock (LVE sumó el stock y lo empujó a Fudo) | sin_stock (solo se cerró el pedido)';


--
-- Name: kitchen_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."kitchen_orders_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kitchen_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."kitchen_orders_id_seq" OWNED BY "public"."kitchen_orders"."id";


--
-- Name: kitchen_shift_handover; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."kitchen_shift_handover" (
    "id" bigint NOT NULL,
    "shift_type" "text" NOT NULL,
    "date" "text" NOT NULL,
    "closed_by" "uuid",
    "items" "jsonb" DEFAULT '[]'::"jsonb",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: kitchen_shift_handover_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."kitchen_shift_handover_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kitchen_shift_handover_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."kitchen_shift_handover_id_seq" OWNED BY "public"."kitchen_shift_handover"."id";


--
-- Name: kitchen_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."kitchen_shifts" (
    "id" bigint NOT NULL,
    "date" "date" NOT NULL,
    "shift_type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "opened_by" "uuid",
    "closed_by" "uuid",
    "handover_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "kitchen_shifts_shift_type_check" CHECK (("shift_type" = ANY (ARRAY['morning'::"text", 'night'::"text"]))),
    CONSTRAINT "kitchen_shifts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text"])))
);


--
-- Name: TABLE "kitchen_shifts"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."kitchen_shifts" IS 'Turnos de cocina: mañana (9-15) y noche (17-23)';


--
-- Name: COLUMN "kitchen_shifts"."shift_type"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."kitchen_shifts"."shift_type" IS 'morning = turno mañana, night = turno noche';


--
-- Name: COLUMN "kitchen_shifts"."handover_note"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."kitchen_shifts"."handover_note" IS 'Nota para el turno siguiente (producción cruzada)';


--
-- Name: kitchen_shifts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."kitchen_shifts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kitchen_shifts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."kitchen_shifts_id_seq" OWNED BY "public"."kitchen_shifts"."id";


--
-- Name: menu_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."menu_categories" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "fudo_category_id" "text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: TABLE "menu_categories"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."menu_categories" IS 'Categor√≠as de la carta, sincronizables con Fudo';


--
-- Name: menu_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."menu_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: menu_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."menu_categories_id_seq" OWNED BY "public"."menu_categories"."id";


--
-- Name: menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."menu_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text" NOT NULL,
    "subcategory" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "requires_preparation" boolean DEFAULT false NOT NULL,
    "track_stock" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recipe_id" "uuid",
    "fudo_product_id" "text",
    "sale_price" numeric DEFAULT 0,
    "menu_category_id" bigint,
    "cost_price" numeric DEFAULT 0,
    "fudo_code" "text",
    "consumo_modo" "text",
    "recipe_link_source" "text",
    "consumo_stock_item_id" "uuid",
    "consumo_qty" numeric,
    CONSTRAINT "menu_items_consumo_insumo_check" CHECK ((("consumo_modo" IS DISTINCT FROM 'insumo'::"text") OR (("consumo_stock_item_id" IS NOT NULL) AND ("consumo_qty" > (0)::numeric)))),
    CONSTRAINT "menu_items_consumo_modo_check" CHECK ((("consumo_modo" IS NULL) OR ("consumo_modo" = ANY (ARRAY['receta'::"text", 'combo'::"text", 'sin_consumo'::"text", 'insumo'::"text"])))),
    CONSTRAINT "menu_items_recipe_link_source_check" CHECK ((("recipe_link_source" IS NULL) OR ("recipe_link_source" = ANY (ARRAY['importacion'::"text", 'auto_nombre'::"text", 'manual'::"text"]))))
);


--
-- Name: mise_en_place_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."mise_en_place_items" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "family" "text" DEFAULT 'mise_en_place'::"text" NOT NULL,
    "unit" "text" DEFAULT 'unidades'::"text" NOT NULL,
    "target_quantity" numeric DEFAULT 0 NOT NULL,
    "alert_threshold" numeric DEFAULT 0 NOT NULL,
    "shift" "text" NOT NULL,
    "recipe_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mise_en_place_items_family_check" CHECK (("family" = ANY (ARRAY['equipment'::"text", 'proteins'::"text", 'vegetables'::"text", 'pastry'::"text", 'bread'::"text", 'dairy'::"text", 'cold_storage'::"text", 'mise_en_place'::"text", 'general'::"text"]))),
    CONSTRAINT "mise_en_place_items_shift_check" CHECK (("shift" = ANY (ARRAY['morning'::"text", 'night'::"text", 'both'::"text"])))
);


--
-- Name: mise_en_place_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."mise_en_place_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mise_en_place_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."mise_en_place_items_id_seq" OWNED BY "public"."mise_en_place_items"."id";


--
-- Name: mise_en_place_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."mise_en_place_records" (
    "id" bigint NOT NULL,
    "kitchen_shift_id" bigint NOT NULL,
    "mise_en_place_item_id" bigint NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "quantity_produced" numeric,
    "produced_by" "uuid",
    "note" "text",
    "left_for_next_shift" boolean DEFAULT false NOT NULL,
    "quantity_left_for_next_shift" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mise_en_place_records_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'done'::"text", 'low'::"text", 'missing'::"text"])))
);


--
-- Name: mise_en_place_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."mise_en_place_records_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mise_en_place_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."mise_en_place_records_id_seq" OWNED BY "public"."mise_en_place_records"."id";


--
-- Name: payroll_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."payroll_rates" (
    "id" bigint NOT NULL,
    "role" "text" NOT NULL,
    "hourly_rate" numeric NOT NULL,
    "label" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: payroll_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."payroll_rates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."payroll_rates_id_seq" OWNED BY "public"."payroll_rates"."id";


--
-- Name: production_inputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."production_inputs" (
    "id" bigint NOT NULL,
    "production_order_id" bigint NOT NULL,
    "stock_item_id" "uuid",
    "qty_used" numeric DEFAULT 0 NOT NULL,
    "unit" "text" DEFAULT 'kg'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cost_per_unit" numeric,
    "stock_movement_id" bigint,
    "movement_uuid" "uuid"
);


--
-- Name: production_inputs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."production_inputs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: production_inputs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."production_inputs_id_seq" OWNED BY "public"."production_inputs"."id";


--
-- Name: production_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."production_orders" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "template_id" bigint,
    "parent_order_id" bigint,
    "chef_id" "uuid",
    "notes" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "submitted_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "review_notes" "text",
    "efficiency_pct" numeric,
    "total_cost" numeric,
    "cost_per_output_unit" numeric,
    "main_output_stock_item_id" "uuid",
    CONSTRAINT "production_orders_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'in_progress'::"text", 'pending_review'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


--
-- Name: COLUMN "production_orders"."submitted_at"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."production_orders"."submitted_at" IS 'When the chef submitted this production for manager validation.';


--
-- Name: COLUMN "production_orders"."reviewed_by"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."production_orders"."reviewed_by" IS 'Manager/socio who approved the production before stock and Fudo were changed.';


--
-- Name: COLUMN "production_orders"."reviewed_at"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."production_orders"."reviewed_at" IS 'When the production was approved.';


--
-- Name: COLUMN "production_orders"."review_notes"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."production_orders"."review_notes" IS 'Manager validation notes.';


--
-- Name: COLUMN "production_orders"."efficiency_pct"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."production_orders"."efficiency_pct" IS 'Rendimiento en masa/volumen: (entradas − merma) / entradas, solo unidades convertibles (kg/g/l/ml). NULL si no aplica.';


--
-- Name: COLUMN "production_orders"."total_cost"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."production_orders"."total_cost" IS 'Σ qty_used × cost_per_unit de los insumos, congelado al completar.';


--
-- Name: COLUMN "production_orders"."cost_per_output_unit"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."production_orders"."cost_per_output_unit" IS 'total_cost / cantidad de la salida principal (la de mayor cantidad no-merma con stock_item).';


--
-- Name: production_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."production_orders_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: production_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."production_orders_id_seq" OWNED BY "public"."production_orders"."id";


--
-- Name: production_outputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."production_outputs" (
    "id" bigint NOT NULL,
    "production_order_id" bigint NOT NULL,
    "stock_item_id" "uuid",
    "output_name" "text" NOT NULL,
    "qty_produced" numeric DEFAULT 0 NOT NULL,
    "theoretical_qty" numeric,
    "unit" "text" DEFAULT 'unidad'::"text" NOT NULL,
    "is_waste" boolean DEFAULT false,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stock_movement_id" bigint,
    "lot_code" "text",
    "produced_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "movement_uuid" "uuid"
);


--
-- Name: production_outputs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."production_outputs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: production_outputs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."production_outputs_id_seq" OWNED BY "public"."production_outputs"."id";


--
-- Name: production_template_inputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."production_template_inputs" (
    "id" bigint NOT NULL,
    "template_id" bigint NOT NULL,
    "stock_item_id" "uuid",
    "qty" numeric,
    "unit" "text",
    "sort_order" integer DEFAULT 0 NOT NULL
);


--
-- Name: production_template_inputs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."production_template_inputs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: production_template_inputs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."production_template_inputs_id_seq" OWNED BY "public"."production_template_inputs"."id";


--
-- Name: production_template_outputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."production_template_outputs" (
    "id" bigint NOT NULL,
    "template_id" bigint NOT NULL,
    "stock_item_id" "uuid",
    "output_name" "text" NOT NULL,
    "output_unit" "text" DEFAULT 'unidad'::"text" NOT NULL,
    "theoretical_yield_pct" numeric DEFAULT 100 NOT NULL,
    "is_waste" boolean DEFAULT false,
    "notes" "text",
    "sort_order" integer DEFAULT 0,
    "default_qty" numeric
);


--
-- Name: production_template_outputs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."production_template_outputs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: production_template_outputs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."production_template_outputs_id_seq" OWNED BY "public"."production_template_outputs"."id";


--
-- Name: production_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."production_templates" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "recipe_id" "uuid",
    "default_input_stock_item_id" "uuid",
    "default_input_unit" "text" DEFAULT 'kg'::"text",
    "is_active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: production_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."production_templates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: production_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."production_templates_id_seq" OWNED BY "public"."production_templates"."id";


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."profiles" (
    "id" "uuid" NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "role" "public"."app_role" DEFAULT 'barista'::"public"."app_role" NOT NULL,
    "avatar_url" "text",
    "phone" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "cuit" "text",
    "address" "text",
    "dni" "text",
    "birth_date" "date",
    "emergency_contact_name" "text",
    "emergency_contact_phone" "text"
);


--
-- Name: protocolo_tareas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."protocolo_tareas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "protocolo_id" "uuid" NOT NULL,
    "fecha" "date" NOT NULL,
    "hora" "text" NOT NULL,
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "asignado_a" "uuid",
    "asignado_por" "uuid",
    "asignado_at" timestamp with time zone,
    "hecho_por" "uuid",
    "hecho_at" timestamp with time zone,
    "foto_path" "text",
    "pasos_ok" "text"[],
    "nota" "text",
    "avisado_at" timestamp with time zone,
    "reaviso_at" timestamp with time zone,
    "recordatorio_at" timestamp with time zone,
    "atraso_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fotos" "text"[],
    CONSTRAINT "protocolo_tareas_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'asignada'::"text", 'hecha'::"text"])))
);


--
-- Name: protocolos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."protocolos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "horarios" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "pasos" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "requiere_foto" boolean DEFAULT true NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fotos" "text"[] DEFAULT ARRAY['Foto general'::"text"] NOT NULL
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."push_subscriptions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "keys" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."push_subscriptions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."push_subscriptions_id_seq" OWNED BY "public"."push_subscriptions"."id";


--
-- Name: recipe_ingredient_pending_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."recipe_ingredient_pending_links" (
    "id" bigint NOT NULL,
    "recipe_id" "uuid",
    "recipe_name" "text" NOT NULL,
    "recipe_slug" "text" NOT NULL,
    "ingredient_name" "text" NOT NULL,
    "normalized_name" "text" NOT NULL,
    "cantidad" numeric,
    "unidad" "text",
    "match_confidence" "text" DEFAULT 'sin_match'::"text" NOT NULL,
    "match_score" integer DEFAULT 0,
    "suggested_stock_item_id" "uuid",
    "suggested_stock_item_name" "text",
    "match_reasons" "text"[] DEFAULT '{}'::"text"[],
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "resolved_stock_item_id" "uuid",
    "resolved_qty_per_portion" numeric,
    "resolved_unit" "text",
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


--
-- Name: recipe_ingredient_pending_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."recipe_ingredient_pending_links_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recipe_ingredient_pending_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."recipe_ingredient_pending_links_id_seq" OWNED BY "public"."recipe_ingredient_pending_links"."id";


--
-- Name: recipe_ingredients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."recipe_ingredients" (
    "id" bigint NOT NULL,
    "recipe_id" "uuid" NOT NULL,
    "stock_item_id" "uuid" NOT NULL,
    "qty_per_portion" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ingredient_unit" "text",
    "notes" "text"
);


--
-- Name: recipe_ingredients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."recipe_ingredients_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recipe_ingredients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."recipe_ingredients_id_seq" OWNED BY "public"."recipe_ingredients"."id";


--
-- Name: recipes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."recipes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" DEFAULT 'platos'::"text" NOT NULL,
    "ingredients" "jsonb" DEFAULT '[]'::"jsonb",
    "preparation" "text" DEFAULT ''::"text",
    "notes" "text",
    "created_by" "uuid" NOT NULL,
    "is_active" boolean DEFAULT true,
    "yield_portions" integer DEFAULT 1,
    "cost_per_portion" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "slug" "text",
    "output_stock_item_id" "uuid",
    "fudo_synced_at" timestamp with time zone,
    "rinde_tanda" numeric,
    CONSTRAINT "recipes_rinde_tanda_check" CHECK ((("rinde_tanda" IS NULL) OR ("rinde_tanda" > (0)::numeric)))
);


--
-- Name: COLUMN "recipes"."output_stock_item_id"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."recipes"."output_stock_item_id" IS 'Item de stock que esta receta produce (elaborado intermedio). Si es null, el código cae al match por nombre.';


--
-- Name: COLUMN "recipes"."fudo_synced_at"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."recipes"."fudo_synced_at" IS 'Última sincronización desde el export de Fudo. NULL = receta local/de producción; con valor = espejo de Fudo (no editable en la app).';


--
-- Name: COLUMN "recipes"."rinde_tanda"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."recipes"."rinde_tanda" IS 'Cuánto rinde una tanda típica, en la unidad del elaborado (recetas de producción).';


--
-- Name: sales_engine_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sales_engine_daily" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "day" "date" NOT NULL,
    "stock_item_id" "uuid" NOT NULL,
    "qty_consumed" numeric DEFAULT 0 NOT NULL,
    "qty_produced" numeric DEFAULT 0 NOT NULL,
    "qty_received" numeric DEFAULT 0 NOT NULL,
    "lve_qty" numeric,
    "fudo_qty" numeric,
    "diff" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: TABLE "sales_engine_daily"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."sales_engine_daily" IS 'Motor paralelo (fase 1 reemplazo Fudo): snapshot diario por insumo — movimientos teóricos, lve_qty vs fudo_qty y diff.';


--
-- Name: sales_engine_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sales_engine_state" (
    "stock_item_id" "uuid" NOT NULL,
    "lve_qty" numeric DEFAULT 0 NOT NULL,
    "seeded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: TABLE "sales_engine_state"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."sales_engine_state" IS 'Motor paralelo: stock teórico acumulado por insumo (seed = current_qty al arrancar).';


--
-- Name: salon_item_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."salon_item_status" (
    "id" bigint NOT NULL,
    "fudo_sale_id" "text" NOT NULL,
    "fudo_item_id" "text" NOT NULL,
    "served_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "served_by" "uuid"
);


--
-- Name: salon_item_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."salon_item_status_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: salon_item_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."salon_item_status_id_seq" OWNED BY "public"."salon_item_status"."id";


--
-- Name: shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."shifts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "shift_date" "date" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "shift_role" "public"."app_role" NOT NULL,
    "color" "text" DEFAULT '#8B6914'::"text" NOT NULL,
    "emoji" "text" DEFAULT '☕'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: stock_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."stock_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stock_item_id" "uuid" NOT NULL,
    "alert_type" "text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "message" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "triggered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_alerts_alert_type_check" CHECK (("alert_type" = ANY (ARRAY['low_stock'::"text", 'upcoming_purchase'::"text", 'critical'::"text"]))),
    CONSTRAINT "stock_alerts_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "stock_alerts_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'resolved'::"text", 'snoozed'::"text"])))
);


--
-- Name: stock_anomaly_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."stock_anomaly_decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "issue_key" "text" NOT NULL,
    "stock_item_id" "uuid" NOT NULL,
    "issue_type" "text" NOT NULL,
    "decision" "text" NOT NULL,
    "note" "text",
    "snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "snoozed_until" timestamp with time zone,
    "decided_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_anomaly_decisions_decision_check" CHECK (("decision" = ANY (ARRAY['confirmed_ok'::"text", 'snoozed'::"text", 'rule_created'::"text", 'fix_fudo'::"text", 'fix_lve'::"text"])))
);


--
-- Name: stock_anomaly_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."stock_anomaly_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stock_item_id" "uuid",
    "issue_type" "text",
    "name_pattern" "text",
    "category" "text",
    "unit" "text",
    "min_qty" numeric,
    "max_qty" numeric,
    "notify_enabled" boolean DEFAULT true NOT NULL,
    "notification_priority" "text" DEFAULT 'media'::"text" NOT NULL,
    "last_notified_at" timestamp with time zone,
    "created_from_issue_key" "text",
    "note" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_anomaly_rules_notification_priority_check" CHECK (("notification_priority" = ANY (ARRAY['baja'::"text", 'media'::"text", 'alta'::"text", 'critica'::"text"]))),
    CONSTRAINT "stock_anomaly_rules_range_check" CHECK ((("min_qty" IS NULL) OR ("max_qty" IS NULL) OR ("min_qty" <= "max_qty")))
);


--
-- Name: stock_count_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."stock_count_aliases" (
    "alias" "text" NOT NULL,
    "stock_item_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: TABLE "stock_count_aliases"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."stock_count_aliases" IS 'Nombres con los que el equipo cuenta (ej. "bifes de pollo") → insumo del stock. Los guarda /api/stock/conteo-texto.';


--
-- Name: stock_item_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."stock_item_suppliers" (
    "stock_item_id" "uuid" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "fudo_purchases" integer DEFAULT 0 NOT NULL,
    "last_purchase_at" timestamp with time zone,
    "confirmed_by" "uuid",
    "confirmed_at" timestamp with time zone,
    "dismissed_by" "uuid",
    "dismissed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_item_suppliers_fudo_purchases_check" CHECK (("fudo_purchases" >= 0)),
    CONSTRAINT "stock_item_suppliers_primary_not_dismissed" CHECK ((NOT ("is_primary" AND ("dismissed_at" IS NOT NULL)))),
    CONSTRAINT "stock_item_suppliers_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'fudo'::"text", 'legacy'::"text"])))
);


--
-- Name: TABLE "stock_item_suppliers"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."stock_item_suppliers" IS 'Vínculos insumo↔proveedor. is_primary se refleja en stock_items.supplier_id. Evidencia desde gastos de Fudo.';


--
-- Name: stock_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."stock_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "unit" "text" NOT NULL,
    "current_qty" numeric(10,2) DEFAULT 0 NOT NULL,
    "min_qty" numeric(10,2) DEFAULT 0 NOT NULL,
    "next_purchase_date" "date",
    "supplier_id" "uuid",
    "notes" "text",
    "semaphore" "text" DEFAULT 'green'::"text" NOT NULL,
    "last_ordered_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fudo_product_id" "text",
    "cost_per_unit" numeric DEFAULT 0,
    "shelf_life_days" integer,
    "fudo_ingredient_id" "text",
    "fudo_skip" boolean DEFAULT false NOT NULL,
    "purchase_lead_time_days" integer,
    "last_counted_at" timestamp with time zone,
    "is_produced" boolean DEFAULT false NOT NULL,
    "area" "text",
    "fudo_category" "text",
    "area_locked" boolean DEFAULT false NOT NULL,
    "cost_source" "text",
    "cost_updated_at" timestamp with time zone,
    CONSTRAINT "stock_items_area_check" CHECK ((("area" IS NULL) OR ("area" = ANY (ARRAY['cocina'::"text", 'pasteleria'::"text", 'barra'::"text", 'descartables'::"text", 'limpieza'::"text", 'otros'::"text"])))),
    CONSTRAINT "stock_items_cost_source_check" CHECK (("cost_source" = ANY (ARRAY['compra'::"text", 'manual'::"text", 'produccion'::"text", 'estimado'::"text", 'fudo'::"text"]))),
    CONSTRAINT "stock_items_purchase_lead_time_days_check" CHECK ((("purchase_lead_time_days" IS NULL) OR (("purchase_lead_time_days" >= 0) AND ("purchase_lead_time_days" <= 60)))),
    CONSTRAINT "stock_items_semaphore_check" CHECK (("semaphore" = ANY (ARRAY['green'::"text", 'yellow'::"text", 'red'::"text"])))
);


--
-- Name: COLUMN "stock_items"."shelf_life_days"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."stock_items"."shelf_life_days" IS 'Vida útil en días para control de vencimientos en LVE';


--
-- Name: COLUMN "stock_items"."fudo_skip"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."stock_items"."fudo_skip" IS 'true = item local LVE, no se sincroniza con Fudo';


--
-- Name: COLUMN "stock_items"."purchase_lead_time_days"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."stock_items"."purchase_lead_time_days" IS 'Days of notice needed before ordering this stock item from its supplier. Used by LVE stock alerts; does not overwrite Fudo quantity.';


--
-- Name: COLUMN "stock_items"."is_produced"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."stock_items"."is_produced" IS 'true = lo produce la casa; false = se compra hecho a un proveedor';


--
-- Name: COLUMN "stock_items"."area"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."stock_items"."area" IS 'Área operativa: cocina | pasteleria | barra | descartables | limpieza | otros. La setea el sync desde la categoría de Fudo salvo area_locked.';


--
-- Name: COLUMN "stock_items"."fudo_category"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."stock_items"."fudo_category" IS 'Nombre de la categoría del ingrediente/producto en Fudo (solo lectura, espejo).';


--
-- Name: COLUMN "stock_items"."area_locked"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."stock_items"."area_locked" IS 'true cuando un encargado fijó el área a mano: el sync no la pisa.';


--
-- Name: COLUMN "stock_items"."cost_source"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."stock_items"."cost_source" IS 'Fuente del cost_per_unit. Confiables: compra, manual, produccion. estimado/fudo/NULL = sin costo real (la UI no muestra el número).';


--
-- Name: stock_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."stock_logs" (
    "id" bigint NOT NULL,
    "stock_item_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "action" "text" DEFAULT 'update'::"text" NOT NULL,
    "old_qty" numeric,
    "new_qty" numeric,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: stock_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."stock_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."stock_logs_id_seq" OWNED BY "public"."stock_logs"."id";


--
-- Name: stock_lots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."stock_lots" (
    "id" bigint NOT NULL,
    "stock_item_id" "uuid" NOT NULL,
    "production_order_id" bigint,
    "production_output_id" bigint,
    "lot_code" "text" NOT NULL,
    "qty_original" numeric DEFAULT 0 NOT NULL,
    "qty_remaining" numeric DEFAULT 0 NOT NULL,
    "unit" "text" DEFAULT 'unidad'::"text" NOT NULL,
    "produced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_lots_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'expired'::"text", 'depleted'::"text", 'discarded'::"text"])))
);


--
-- Name: stock_lots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."stock_lots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_lots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."stock_lots_id_seq" OWNED BY "public"."stock_lots"."id";


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stock_item_id" "uuid" NOT NULL,
    "movement_type" "text" NOT NULL,
    "qty" numeric NOT NULL,
    "previous_qty" numeric NOT NULL,
    "new_qty" numeric NOT NULL,
    "reason" "text",
    "related_log_id" "uuid",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "note" "text",
    "production_order_id" bigint,
    "fudo_synced" boolean DEFAULT false NOT NULL,
    "cost_per_unit" numeric,
    CONSTRAINT "stock_movements_movement_type_check" CHECK (("movement_type" = ANY (ARRAY['entrada'::"text", 'uso'::"text", 'ajuste'::"text", 'merma'::"text", 'in'::"text", 'out'::"text"])))
);


--
-- Name: COLUMN "stock_movements"."movement_type"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."stock_movements"."movement_type" IS 'entrada (compra/producción) | uso (consumo en producción) | ajuste (conteo físico) | merma (desperdicio)';


--
-- Name: COLUMN "stock_movements"."reason"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."stock_movements"."reason" IS 'physical_count | manual_adjustment | waste | reception | produccion_input | produccion_output';


--
-- Name: stock_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."stock_receipts" (
    "id" bigint NOT NULL,
    "stock_item_id" "uuid",
    "supplier_id" "uuid",
    "order_source" "text",
    "order_id" bigint,
    "qty" numeric NOT NULL,
    "unit" "text",
    "cost_total" numeric,
    "cost_per_unit" numeric,
    "freeze_qty" numeric,
    "expires_at" "date",
    "note" "text",
    "received_by" "uuid",
    "received_date" "date" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payment_status" "text" DEFAULT 'a_pagar'::"text" NOT NULL,
    "paid_at" timestamp with time zone,
    "paid_by" "uuid",
    "payment_method" "text",
    CONSTRAINT "stock_receipts_payment_method_check" CHECK (("payment_method" = ANY (ARRAY['efectivo'::"text", 'transferencia'::"text", 'tarjeta'::"text", 'cuenta_corriente'::"text"]))),
    CONSTRAINT "stock_receipts_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pagado'::"text", 'a_pagar'::"text"])))
);


--
-- Name: stock_receipts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."stock_receipts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_receipts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."stock_receipts_id_seq" OWNED BY "public"."stock_receipts"."id";


--
-- Name: stock_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."stock_snapshots" (
    "id" bigint NOT NULL,
    "snapshot_date" "date" NOT NULL,
    "snapshot_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "label" "text",
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "total_items" integer DEFAULT 0 NOT NULL,
    "total_qty" numeric DEFAULT 0 NOT NULL,
    "critical_count" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_snapshots_snapshot_type_check" CHECK (("snapshot_type" = ANY (ARRAY['manual'::"text", 'daily'::"text", 'audit'::"text"])))
);


--
-- Name: stock_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."stock_snapshots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."stock_snapshots_id_seq" OWNED BY "public"."stock_snapshots"."id";


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "contact_name" "text",
    "phone" "text",
    "email" "text",
    "notes" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fudo_provider_id" "text",
    "order_days" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "lead_time_days" integer
);


--
-- Name: COLUMN "suppliers"."order_days"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."suppliers"."order_days" IS 'Días de pedido: 0=domingo … 6=sábado';


--
-- Name: COLUMN "suppliers"."lead_time_days"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."suppliers"."lead_time_days" IS 'Días entre pedido y entrega';


--
-- Name: tolva_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."tolva_logs" (
    "id" bigint NOT NULL,
    "log_date" "date" NOT NULL,
    "shift" "text" NOT NULL,
    "start_gr" numeric,
    "added_gr" numeric DEFAULT 0 NOT NULL,
    "end_gr" numeric,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tolva_logs_shift_check" CHECK (("shift" = ANY (ARRAY['TM'::"text", 'TT'::"text"])))
);


--
-- Name: tolva_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."tolva_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tolva_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."tolva_logs_id_seq" OWNED BY "public"."tolva_logs"."id";


--
-- Name: v_active_alerts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW "public"."v_active_alerts" AS
 SELECT "sa"."id",
    "sa"."stock_item_id",
    "si"."name" AS "item_name",
    "si"."category",
    "si"."current_qty",
    "si"."min_qty",
    "si"."unit",
    "si"."semaphore",
    "sa"."alert_type",
    "sa"."priority",
    "sa"."message",
    "sa"."status",
    "sa"."triggered_at"
   FROM ("public"."stock_alerts" "sa"
     JOIN "public"."stock_items" "si" ON (("si"."id" = "sa"."stock_item_id")))
  WHERE ("sa"."status" = 'active'::"text")
  ORDER BY
        CASE "sa"."priority"
            WHEN 'high'::"text" THEN 1
            WHEN 'medium'::"text" THEN 2
            WHEN 'low'::"text" THEN 3
            ELSE NULL::integer
        END, "sa"."triggered_at" DESC;


--
-- Name: v_today_attendance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW "public"."v_today_attendance" AS
 SELECT "al"."id",
    "al"."user_id",
    "p"."first_name",
    "p"."last_name",
    "p"."role",
    "al"."clock_in_at",
    "al"."clock_out_at",
    "al"."status",
    "al"."notes"
   FROM ("public"."attendance_logs" "al"
     JOIN "public"."profiles" "p" ON (("p"."id" = "al"."user_id")))
  WHERE ("al"."operative_date" = CURRENT_DATE);


--
-- Name: vajilla_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."vajilla_snapshots" (
    "id" bigint NOT NULL,
    "snapshot_date" "date" NOT NULL,
    "label" "text",
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "total_pieces" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: vajilla_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."vajilla_snapshots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vajilla_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."vajilla_snapshots_id_seq" OWNED BY "public"."vajilla_snapshots"."id";


--
-- Name: vajilla_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."vajilla_stock" (
    "id" bigint NOT NULL,
    "item_name" "text" NOT NULL,
    "category" "text" DEFAULT 'general'::"text" NOT NULL,
    "quantity" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: vajilla_stock_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."vajilla_stock_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vajilla_stock_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."vajilla_stock_id_seq" OWNED BY "public"."vajilla_stock"."id";


--
-- Name: audit_trail id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."audit_trail" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."audit_trail_id_seq"'::"regclass");


--
-- Name: bar_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_orders" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."bar_orders_id_seq"'::"regclass");


--
-- Name: bar_product_recipes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_product_recipes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."bar_product_recipes_id_seq"'::"regclass");


--
-- Name: bar_shift_handover id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_shift_handover" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."bar_shift_handover_id_seq"'::"regclass");


--
-- Name: bar_stock_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_stock_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."bar_stock_items_id_seq"'::"regclass");


--
-- Name: bar_stock_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_stock_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."bar_stock_logs_id_seq"'::"regclass");


--
-- Name: checklist_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checklist_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."checklist_items_id_seq"'::"regclass");


--
-- Name: checklist_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checklist_templates" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."checklist_templates_id_seq"'::"regclass");


--
-- Name: closing_hours id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."closing_hours" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."closing_hours_id_seq"'::"regclass");


--
-- Name: fudo_sales id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."fudo_sales" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."fudo_sales_id_seq"'::"regclass");


--
-- Name: kitchen_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_orders" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kitchen_orders_id_seq"'::"regclass");


--
-- Name: kitchen_shift_handover id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_shift_handover" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kitchen_shift_handover_id_seq"'::"regclass");


--
-- Name: kitchen_shifts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_shifts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kitchen_shifts_id_seq"'::"regclass");


--
-- Name: menu_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."menu_categories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."menu_categories_id_seq"'::"regclass");


--
-- Name: mise_en_place_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."mise_en_place_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."mise_en_place_items_id_seq"'::"regclass");


--
-- Name: mise_en_place_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."mise_en_place_records" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."mise_en_place_records_id_seq"'::"regclass");


--
-- Name: payroll_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payroll_rates" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."payroll_rates_id_seq"'::"regclass");


--
-- Name: production_inputs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_inputs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."production_inputs_id_seq"'::"regclass");


--
-- Name: production_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_orders" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."production_orders_id_seq"'::"regclass");


--
-- Name: production_outputs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_outputs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."production_outputs_id_seq"'::"regclass");


--
-- Name: production_template_inputs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_template_inputs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."production_template_inputs_id_seq"'::"regclass");


--
-- Name: production_template_outputs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_template_outputs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."production_template_outputs_id_seq"'::"regclass");


--
-- Name: production_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_templates" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."production_templates_id_seq"'::"regclass");


--
-- Name: push_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."push_subscriptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."push_subscriptions_id_seq"'::"regclass");


--
-- Name: recipe_ingredient_pending_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipe_ingredient_pending_links" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."recipe_ingredient_pending_links_id_seq"'::"regclass");


--
-- Name: recipe_ingredients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipe_ingredients" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."recipe_ingredients_id_seq"'::"regclass");


--
-- Name: salon_item_status id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."salon_item_status" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."salon_item_status_id_seq"'::"regclass");


--
-- Name: stock_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."stock_logs_id_seq"'::"regclass");


--
-- Name: stock_lots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_lots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."stock_lots_id_seq"'::"regclass");


--
-- Name: stock_receipts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_receipts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."stock_receipts_id_seq"'::"regclass");


--
-- Name: stock_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."stock_snapshots_id_seq"'::"regclass");


--
-- Name: tolva_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."tolva_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."tolva_logs_id_seq"'::"regclass");


--
-- Name: vajilla_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."vajilla_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."vajilla_snapshots_id_seq"'::"regclass");


--
-- Name: vajilla_stock id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."vajilla_stock" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."vajilla_stock_id_seq"'::"regclass");


--
-- Name: announcement_reads announcement_reads_announcement_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."announcement_reads"
    ADD CONSTRAINT "announcement_reads_announcement_id_user_id_key" UNIQUE ("announcement_id", "user_id");


--
-- Name: announcement_reads announcement_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."announcement_reads"
    ADD CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id");


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_pkey" PRIMARY KEY ("id");


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");


--
-- Name: attendance_config attendance_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."attendance_config"
    ADD CONSTRAINT "attendance_config_pkey" PRIMARY KEY ("key");


--
-- Name: attendance_logs attendance_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."attendance_logs"
    ADD CONSTRAINT "attendance_logs_pkey" PRIMARY KEY ("id");


--
-- Name: attendance_logs attendance_logs_user_id_operative_date_clock_in_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."attendance_logs"
    ADD CONSTRAINT "attendance_logs_user_id_operative_date_clock_in_at_key" UNIQUE ("user_id", "operative_date", "clock_in_at");


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");


--
-- Name: audit_trail audit_trail_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."audit_trail"
    ADD CONSTRAINT "audit_trail_pkey" PRIMARY KEY ("id");


--
-- Name: bar_orders bar_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_orders"
    ADD CONSTRAINT "bar_orders_pkey" PRIMARY KEY ("id");


--
-- Name: bar_product_recipes bar_product_recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_product_recipes"
    ADD CONSTRAINT "bar_product_recipes_pkey" PRIMARY KEY ("id");


--
-- Name: bar_shift_handover bar_shift_handover_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_shift_handover"
    ADD CONSTRAINT "bar_shift_handover_pkey" PRIMARY KEY ("id");


--
-- Name: bar_stock_items bar_stock_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_stock_items"
    ADD CONSTRAINT "bar_stock_items_pkey" PRIMARY KEY ("id");


--
-- Name: bar_stock_logs bar_stock_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_stock_logs"
    ADD CONSTRAINT "bar_stock_logs_pkey" PRIMARY KEY ("id");


--
-- Name: checklist_items checklist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checklist_items"
    ADD CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id");


--
-- Name: checklist_templates checklist_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checklist_templates"
    ADD CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id");


--
-- Name: closing_hours closing_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."closing_hours"
    ADD CONSTRAINT "closing_hours_pkey" PRIMARY KEY ("id");


--
-- Name: device_registry device_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."device_registry"
    ADD CONSTRAINT "device_registry_pkey" PRIMARY KEY ("id");


--
-- Name: device_registry device_registry_user_id_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."device_registry"
    ADD CONSTRAINT "device_registry_user_id_fingerprint_key" UNIQUE ("user_id", "fingerprint");


--
-- Name: expediente_comments expediente_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."expediente_comments"
    ADD CONSTRAINT "expediente_comments_pkey" PRIMARY KEY ("id");


--
-- Name: expediente_tasks expediente_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."expediente_tasks"
    ADD CONSTRAINT "expediente_tasks_pkey" PRIMARY KEY ("id");


--
-- Name: expedientes expedientes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."expedientes"
    ADD CONSTRAINT "expedientes_code_key" UNIQUE ("code");


--
-- Name: expedientes expedientes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."expedientes"
    ADD CONSTRAINT "expedientes_pkey" PRIMARY KEY ("id");


--
-- Name: fudo_reintentos fudo_reintentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."fudo_reintentos"
    ADD CONSTRAINT "fudo_reintentos_pkey" PRIMARY KEY ("id");


--
-- Name: fudo_sale_subitems fudo_sale_subitems_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."fudo_sale_subitems"
    ADD CONSTRAINT "fudo_sale_subitems_pkey" PRIMARY KEY ("fudo_subitem_id");


--
-- Name: fudo_sales fudo_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."fudo_sales"
    ADD CONSTRAINT "fudo_sales_pkey" PRIMARY KEY ("id");


--
-- Name: fudo_salud fudo_salud_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."fudo_salud"
    ADD CONSTRAINT "fudo_salud_pkey" PRIMARY KEY ("id");


--
-- Name: fudo_sync_events fudo_sync_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."fudo_sync_events"
    ADD CONSTRAINT "fudo_sync_events_pkey" PRIMARY KEY ("id");


--
-- Name: fudo_sync_incidents fudo_sync_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."fudo_sync_incidents"
    ADD CONSTRAINT "fudo_sync_incidents_pkey" PRIMARY KEY ("id");


--
-- Name: kitchen_daily_logs kitchen_daily_logs_operative_date_service_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_daily_logs"
    ADD CONSTRAINT "kitchen_daily_logs_operative_date_service_key" UNIQUE ("operative_date", "service");


--
-- Name: kitchen_daily_logs kitchen_daily_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_daily_logs"
    ADD CONSTRAINT "kitchen_daily_logs_pkey" PRIMARY KEY ("id");


--
-- Name: kitchen_orders kitchen_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_orders"
    ADD CONSTRAINT "kitchen_orders_pkey" PRIMARY KEY ("id");


--
-- Name: kitchen_shift_handover kitchen_shift_handover_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_shift_handover"
    ADD CONSTRAINT "kitchen_shift_handover_pkey" PRIMARY KEY ("id");


--
-- Name: kitchen_shifts kitchen_shifts_date_shift_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_shifts"
    ADD CONSTRAINT "kitchen_shifts_date_shift_type_key" UNIQUE ("date", "shift_type");


--
-- Name: kitchen_shifts kitchen_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_shifts"
    ADD CONSTRAINT "kitchen_shifts_pkey" PRIMARY KEY ("id");


--
-- Name: menu_categories menu_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."menu_categories"
    ADD CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id");


--
-- Name: menu_items menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id");


--
-- Name: mise_en_place_items mise_en_place_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."mise_en_place_items"
    ADD CONSTRAINT "mise_en_place_items_pkey" PRIMARY KEY ("id");


--
-- Name: mise_en_place_records mise_en_place_records_kitchen_shift_id_mise_en_place_item_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."mise_en_place_records"
    ADD CONSTRAINT "mise_en_place_records_kitchen_shift_id_mise_en_place_item_i_key" UNIQUE ("kitchen_shift_id", "mise_en_place_item_id");


--
-- Name: mise_en_place_records mise_en_place_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."mise_en_place_records"
    ADD CONSTRAINT "mise_en_place_records_pkey" PRIMARY KEY ("id");


--
-- Name: payroll_rates payroll_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payroll_rates"
    ADD CONSTRAINT "payroll_rates_pkey" PRIMARY KEY ("id");


--
-- Name: payroll_rates payroll_rates_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."payroll_rates"
    ADD CONSTRAINT "payroll_rates_role_key" UNIQUE ("role");


--
-- Name: production_inputs production_inputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_inputs"
    ADD CONSTRAINT "production_inputs_pkey" PRIMARY KEY ("id");


--
-- Name: production_orders production_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_orders"
    ADD CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id");


--
-- Name: production_outputs production_outputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_outputs"
    ADD CONSTRAINT "production_outputs_pkey" PRIMARY KEY ("id");


--
-- Name: production_template_inputs production_template_inputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_template_inputs"
    ADD CONSTRAINT "production_template_inputs_pkey" PRIMARY KEY ("id");


--
-- Name: production_template_outputs production_template_outputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_template_outputs"
    ADD CONSTRAINT "production_template_outputs_pkey" PRIMARY KEY ("id");


--
-- Name: production_templates production_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_templates"
    ADD CONSTRAINT "production_templates_pkey" PRIMARY KEY ("id");


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");


--
-- Name: protocolo_tareas protocolo_tareas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."protocolo_tareas"
    ADD CONSTRAINT "protocolo_tareas_pkey" PRIMARY KEY ("id");


--
-- Name: protocolo_tareas protocolo_tareas_protocolo_id_fecha_hora_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."protocolo_tareas"
    ADD CONSTRAINT "protocolo_tareas_protocolo_id_fecha_hora_key" UNIQUE ("protocolo_id", "fecha", "hora");


--
-- Name: protocolos protocolos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."protocolos"
    ADD CONSTRAINT "protocolos_pkey" PRIMARY KEY ("id");


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");


--
-- Name: push_subscriptions push_subscriptions_user_id_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_endpoint_key" UNIQUE ("user_id", "endpoint");


--
-- Name: recipe_ingredient_pending_links recipe_ingredient_pending_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipe_ingredient_pending_links"
    ADD CONSTRAINT "recipe_ingredient_pending_links_pkey" PRIMARY KEY ("id");


--
-- Name: recipe_ingredients recipe_ingredients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipe_ingredients"
    ADD CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id");


--
-- Name: recipe_ingredients recipe_ingredients_recipe_id_stock_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipe_ingredients"
    ADD CONSTRAINT "recipe_ingredients_recipe_id_stock_item_id_key" UNIQUE ("recipe_id", "stock_item_id");


--
-- Name: recipes recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_pkey" PRIMARY KEY ("id");


--
-- Name: recipes recipes_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_slug_key" UNIQUE ("slug");


--
-- Name: sales_engine_daily sales_engine_daily_day_stock_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_engine_daily"
    ADD CONSTRAINT "sales_engine_daily_day_stock_item_id_key" UNIQUE ("day", "stock_item_id");


--
-- Name: sales_engine_daily sales_engine_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_engine_daily"
    ADD CONSTRAINT "sales_engine_daily_pkey" PRIMARY KEY ("id");


--
-- Name: sales_engine_state sales_engine_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_engine_state"
    ADD CONSTRAINT "sales_engine_state_pkey" PRIMARY KEY ("stock_item_id");


--
-- Name: salon_item_status salon_item_status_fudo_sale_id_fudo_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."salon_item_status"
    ADD CONSTRAINT "salon_item_status_fudo_sale_id_fudo_item_id_key" UNIQUE ("fudo_sale_id", "fudo_item_id");


--
-- Name: salon_item_status salon_item_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."salon_item_status"
    ADD CONSTRAINT "salon_item_status_pkey" PRIMARY KEY ("id");


--
-- Name: shifts shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_pkey" PRIMARY KEY ("id");


--
-- Name: stock_alerts stock_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_alerts"
    ADD CONSTRAINT "stock_alerts_pkey" PRIMARY KEY ("id");


--
-- Name: stock_anomaly_decisions stock_anomaly_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_anomaly_decisions"
    ADD CONSTRAINT "stock_anomaly_decisions_pkey" PRIMARY KEY ("id");


--
-- Name: stock_anomaly_rules stock_anomaly_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_anomaly_rules"
    ADD CONSTRAINT "stock_anomaly_rules_pkey" PRIMARY KEY ("id");


--
-- Name: stock_count_aliases stock_count_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_count_aliases"
    ADD CONSTRAINT "stock_count_aliases_pkey" PRIMARY KEY ("alias");


--
-- Name: stock_item_suppliers stock_item_suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_item_suppliers"
    ADD CONSTRAINT "stock_item_suppliers_pkey" PRIMARY KEY ("stock_item_id", "supplier_id");


--
-- Name: stock_items stock_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_items"
    ADD CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id");


--
-- Name: stock_logs stock_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_logs"
    ADD CONSTRAINT "stock_logs_pkey" PRIMARY KEY ("id");


--
-- Name: stock_lots stock_lots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_lots"
    ADD CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id");


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");


--
-- Name: stock_receipts stock_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_receipts"
    ADD CONSTRAINT "stock_receipts_pkey" PRIMARY KEY ("id");


--
-- Name: stock_snapshots stock_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_snapshots"
    ADD CONSTRAINT "stock_snapshots_pkey" PRIMARY KEY ("id");


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");


--
-- Name: tolva_logs tolva_logs_log_date_shift_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."tolva_logs"
    ADD CONSTRAINT "tolva_logs_log_date_shift_key" UNIQUE ("log_date", "shift");


--
-- Name: tolva_logs tolva_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."tolva_logs"
    ADD CONSTRAINT "tolva_logs_pkey" PRIMARY KEY ("id");


--
-- Name: recipe_ingredient_pending_links uq_pending_recipe_ingredient; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipe_ingredient_pending_links"
    ADD CONSTRAINT "uq_pending_recipe_ingredient" UNIQUE ("recipe_id", "normalized_name");


--
-- Name: vajilla_snapshots vajilla_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."vajilla_snapshots"
    ADD CONSTRAINT "vajilla_snapshots_pkey" PRIMARY KEY ("id");


--
-- Name: vajilla_stock vajilla_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."vajilla_stock"
    ADD CONSTRAINT "vajilla_stock_pkey" PRIMARY KEY ("id");


--
-- Name: fudo_reintentos_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "fudo_reintentos_item" ON "public"."fudo_reintentos" USING "btree" ("stock_item_id") WHERE ("estado" = 'pendiente'::"text");


--
-- Name: fudo_reintentos_pendientes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "fudo_reintentos_pendientes" ON "public"."fudo_reintentos" USING "btree" ("proximo_intento_at") WHERE ("estado" = 'pendiente'::"text");


--
-- Name: fudo_sale_subitems_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "fudo_sale_subitems_item" ON "public"."fudo_sale_subitems" USING "btree" ("fudo_sale_item_id");


--
-- Name: fudo_sale_subitems_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "fudo_sale_subitems_product" ON "public"."fudo_sale_subitems" USING "btree" ("fudo_product_id");


--
-- Name: fudo_sale_subitems_sold_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "fudo_sale_subitems_sold_at" ON "public"."fudo_sale_subitems" USING "btree" ("sold_at");


--
-- Name: idx_alerts_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_alerts_item" ON "public"."stock_alerts" USING "btree" ("stock_item_id");


--
-- Name: idx_alerts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_alerts_status" ON "public"."stock_alerts" USING "btree" ("status");


--
-- Name: idx_announcements_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_announcements_active" ON "public"."announcements" USING "btree" ("is_active") WHERE ("is_active" = true);


--
-- Name: idx_announcements_publish; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_announcements_publish" ON "public"."announcements" USING "btree" ("publish_at");


--
-- Name: idx_announcements_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_announcements_scope" ON "public"."announcements" USING "btree" ("scope");


--
-- Name: idx_attendance_operative_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_attendance_operative_date" ON "public"."attendance_logs" USING "btree" ("operative_date" DESC);


--
-- Name: idx_attendance_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_attendance_status" ON "public"."attendance_logs" USING "btree" ("status");


--
-- Name: idx_attendance_suspicious; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_attendance_suspicious" ON "public"."attendance_logs" USING "btree" ("is_suspicious") WHERE ("is_suspicious" = true);


--
-- Name: idx_attendance_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_attendance_user_date" ON "public"."attendance_logs" USING "btree" ("user_id", "operative_date");


--
-- Name: idx_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_audit_created" ON "public"."audit_log" USING "btree" ("created_at");


--
-- Name: idx_audit_table_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_audit_table_action" ON "public"."audit_log" USING "btree" ("table_name", "action");


--
-- Name: idx_audit_trail_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_audit_trail_created" ON "public"."audit_trail" USING "btree" ("created_at" DESC);


--
-- Name: idx_audit_trail_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_audit_trail_entity" ON "public"."audit_trail" USING "btree" ("entity_type", "entity_id");


--
-- Name: idx_audit_trail_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_audit_trail_module" ON "public"."audit_trail" USING "btree" ("module");


--
-- Name: idx_audit_trail_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_audit_trail_user" ON "public"."audit_trail" USING "btree" ("user_id");


--
-- Name: idx_bar_handover_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bar_handover_date" ON "public"."bar_shift_handover" USING "btree" ("date" DESC);


--
-- Name: idx_bar_orders_bar_stock_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bar_orders_bar_stock_item_id" ON "public"."bar_orders" USING "btree" ("bar_stock_item_id");


--
-- Name: idx_bar_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bar_orders_status" ON "public"."bar_orders" USING "btree" ("status");


--
-- Name: idx_bar_orders_stock_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bar_orders_stock_item" ON "public"."bar_orders" USING "btree" ("stock_item_id") WHERE ("stock_item_id" IS NOT NULL);


--
-- Name: idx_bar_orders_supplier_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bar_orders_supplier_id" ON "public"."bar_orders" USING "btree" ("supplier_id");


--
-- Name: idx_bar_product_recipes_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bar_product_recipes_product" ON "public"."bar_product_recipes" USING "btree" ("fudo_product_id");


--
-- Name: idx_bar_stock_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bar_stock_logs_created" ON "public"."bar_stock_logs" USING "btree" ("created_at" DESC);


--
-- Name: idx_bar_stock_logs_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_bar_stock_logs_item" ON "public"."bar_stock_logs" USING "btree" ("bar_stock_item_id");


--
-- Name: idx_checklist_items_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_checklist_items_shift" ON "public"."checklist_items" USING "btree" ("kitchen_shift_id");


--
-- Name: idx_checklist_items_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_checklist_items_status" ON "public"."checklist_items" USING "btree" ("status") WHERE (("status" = 'pending'::"text") OR ("status" = 'overdue'::"text"));


--
-- Name: idx_checklist_templates_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_checklist_templates_shift" ON "public"."checklist_templates" USING "btree" ("shift") WHERE ("is_active" = true);


--
-- Name: idx_exp_comments_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_exp_comments_author" ON "public"."expediente_comments" USING "btree" ("author_id");


--
-- Name: idx_exp_comments_exp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_exp_comments_exp" ON "public"."expediente_comments" USING "btree" ("expediente_id");


--
-- Name: idx_exp_comments_expediente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_exp_comments_expediente" ON "public"."expediente_comments" USING "btree" ("expediente_id", "created_at");


--
-- Name: idx_exp_tasks_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_exp_tasks_assigned" ON "public"."expediente_tasks" USING "btree" ("assigned_to");


--
-- Name: idx_exp_tasks_exp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_exp_tasks_exp" ON "public"."expediente_tasks" USING "btree" ("expediente_id");


--
-- Name: idx_exp_tasks_expediente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_exp_tasks_expediente" ON "public"."expediente_tasks" USING "btree" ("expediente_id");


--
-- Name: idx_expedientes_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_expedientes_author" ON "public"."expedientes" USING "btree" ("author_id");


--
-- Name: idx_expedientes_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_expedientes_created" ON "public"."expedientes" USING "btree" ("created_at" DESC);


--
-- Name: idx_expedientes_responsible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_expedientes_responsible" ON "public"."expedientes" USING "btree" ("responsible_id");


--
-- Name: idx_expedientes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_expedientes_status" ON "public"."expedientes" USING "btree" ("status");


--
-- Name: idx_fudo_sales_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_fudo_sales_product" ON "public"."fudo_sales" USING "btree" ("fudo_product_id");


--
-- Name: idx_fudo_sales_product_sold_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_fudo_sales_product_sold_at" ON "public"."fudo_sales" USING "btree" ("fudo_product_id", "sold_at");


--
-- Name: idx_fudo_sales_sold_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_fudo_sales_sold_at" ON "public"."fudo_sales" USING "btree" ("sold_at");


--
-- Name: idx_fudo_sales_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_fudo_sales_ticket" ON "public"."fudo_sales" USING "btree" ("fudo_ticket_id");


--
-- Name: idx_fudo_sync_events_fudo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_fudo_sync_events_fudo" ON "public"."fudo_sync_events" USING "btree" ("fudo_type", "fudo_id") WHERE ("fudo_id" IS NOT NULL);


--
-- Name: idx_fudo_sync_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_fudo_sync_events_status" ON "public"."fudo_sync_events" USING "btree" ("status", "created_at" DESC);


--
-- Name: idx_fudo_sync_events_stock_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_fudo_sync_events_stock_item" ON "public"."fudo_sync_events" USING "btree" ("stock_item_id", "created_at" DESC) WHERE ("stock_item_id" IS NOT NULL);


--
-- Name: idx_fudo_sync_incidents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_fudo_sync_incidents_status" ON "public"."fudo_sync_incidents" USING "btree" ("status", "severity", "last_seen_at" DESC);


--
-- Name: idx_fudo_sync_incidents_stock_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_fudo_sync_incidents_stock_item" ON "public"."fudo_sync_incidents" USING "btree" ("stock_item_id", "status") WHERE ("stock_item_id" IS NOT NULL);


--
-- Name: idx_kitchen_daily_logs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_kitchen_daily_logs_date" ON "public"."kitchen_daily_logs" USING "btree" ("operative_date" DESC);


--
-- Name: idx_kitchen_handover_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_kitchen_handover_date" ON "public"."kitchen_shift_handover" USING "btree" ("date" DESC);


--
-- Name: idx_kitchen_orders_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_kitchen_orders_created_by" ON "public"."kitchen_orders" USING "btree" ("created_by");


--
-- Name: idx_kitchen_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_kitchen_orders_status" ON "public"."kitchen_orders" USING "btree" ("status");


--
-- Name: idx_kitchen_orders_stock_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_kitchen_orders_stock_item" ON "public"."kitchen_orders" USING "btree" ("stock_item_id") WHERE ("stock_item_id" IS NOT NULL);


--
-- Name: idx_kitchen_orders_supplier_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_kitchen_orders_supplier_id" ON "public"."kitchen_orders" USING "btree" ("supplier_id");


--
-- Name: idx_kitchen_shifts_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_kitchen_shifts_date" ON "public"."kitchen_shifts" USING "btree" ("date");


--
-- Name: idx_kitchen_shifts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_kitchen_shifts_status" ON "public"."kitchen_shifts" USING "btree" ("status") WHERE ("status" <> 'completed'::"text");


--
-- Name: idx_menu_categories_fudo_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_menu_categories_fudo_unique" ON "public"."menu_categories" USING "btree" ("fudo_category_id") WHERE ("fudo_category_id" IS NOT NULL);


--
-- Name: idx_menu_items_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_menu_items_active" ON "public"."menu_items" USING "btree" ("is_active") WHERE ("is_active" = true);


--
-- Name: idx_menu_items_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_menu_items_category" ON "public"."menu_items" USING "btree" ("category");


--
-- Name: idx_menu_items_fudo_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_menu_items_fudo_unique" ON "public"."menu_items" USING "btree" ("fudo_product_id") WHERE ("fudo_product_id" IS NOT NULL);


--
-- Name: idx_menu_items_menu_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_menu_items_menu_category" ON "public"."menu_items" USING "btree" ("menu_category_id");


--
-- Name: idx_mise_items_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_mise_items_active" ON "public"."mise_en_place_items" USING "btree" ("shift") WHERE ("is_active" = true);


--
-- Name: idx_mise_records_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_mise_records_shift" ON "public"."mise_en_place_records" USING "btree" ("kitchen_shift_id");


--
-- Name: idx_prod_orders_pending_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_prod_orders_pending_review" ON "public"."production_orders" USING "btree" ("created_at" DESC) WHERE ("status" = 'pending_review'::"text");


--
-- Name: idx_profiles_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_profiles_is_active" ON "public"."profiles" USING "btree" ("is_active");


--
-- Name: idx_profiles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING "btree" ("role");


--
-- Name: idx_push_subs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_push_subs_user" ON "public"."push_subscriptions" USING "btree" ("user_id");


--
-- Name: idx_recipes_output_stock_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_recipes_output_stock_item_id" ON "public"."recipes" USING "btree" ("output_stock_item_id") WHERE ("output_stock_item_id" IS NOT NULL);


--
-- Name: idx_recipes_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_recipes_slug" ON "public"."recipes" USING "btree" ("slug") WHERE ("slug" IS NOT NULL);


--
-- Name: idx_sales_engine_daily_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_sales_engine_daily_day" ON "public"."sales_engine_daily" USING "btree" ("day" DESC);


--
-- Name: idx_sales_engine_daily_item_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_sales_engine_daily_item_day" ON "public"."sales_engine_daily" USING "btree" ("stock_item_id", "day" DESC);


--
-- Name: idx_salon_item_sale; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_salon_item_sale" ON "public"."salon_item_status" USING "btree" ("fudo_sale_id");


--
-- Name: idx_shifts_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_shifts_date" ON "public"."shifts" USING "btree" ("shift_date");


--
-- Name: idx_shifts_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_shifts_user_date" ON "public"."shifts" USING "btree" ("user_id", "shift_date");


--
-- Name: idx_stock_anomaly_decisions_issue_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_anomaly_decisions_issue_key" ON "public"."stock_anomaly_decisions" USING "btree" ("issue_key", "created_at" DESC);


--
-- Name: idx_stock_anomaly_decisions_stock_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_anomaly_decisions_stock_item" ON "public"."stock_anomaly_decisions" USING "btree" ("stock_item_id", "created_at" DESC);


--
-- Name: idx_stock_anomaly_rules_item_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_anomaly_rules_item_active" ON "public"."stock_anomaly_rules" USING "btree" ("stock_item_id", "is_active") WHERE ("is_active" = true);


--
-- Name: idx_stock_anomaly_rules_notify; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_anomaly_rules_notify" ON "public"."stock_anomaly_rules" USING "btree" ("notify_enabled", "last_notified_at") WHERE (("is_active" = true) AND ("notify_enabled" = true));


--
-- Name: idx_stock_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_category" ON "public"."stock_items" USING "btree" ("category");


--
-- Name: idx_stock_items_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_items_area" ON "public"."stock_items" USING "btree" ("area") WHERE "is_active";


--
-- Name: idx_stock_items_fudo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_items_fudo" ON "public"."stock_items" USING "btree" ("fudo_product_id") WHERE ("fudo_product_id" IS NOT NULL);


--
-- Name: idx_stock_items_fudo_ingredient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_items_fudo_ingredient" ON "public"."stock_items" USING "btree" ("fudo_ingredient_id") WHERE ("fudo_ingredient_id" IS NOT NULL);


--
-- Name: idx_stock_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_logs_created" ON "public"."stock_logs" USING "btree" ("created_at" DESC);


--
-- Name: idx_stock_logs_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_logs_item" ON "public"."stock_logs" USING "btree" ("stock_item_id");


--
-- Name: idx_stock_lots_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_lots_expires" ON "public"."stock_lots" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);


--
-- Name: idx_stock_lots_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_lots_item" ON "public"."stock_lots" USING "btree" ("stock_item_id");


--
-- Name: idx_stock_lots_output_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_stock_lots_output_unique" ON "public"."stock_lots" USING "btree" ("production_output_id") WHERE ("production_output_id" IS NOT NULL);


--
-- Name: idx_stock_lots_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_lots_status" ON "public"."stock_lots" USING "btree" ("status");


--
-- Name: idx_stock_movements_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_movements_date" ON "public"."stock_movements" USING "btree" ("created_at");


--
-- Name: idx_stock_movements_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_movements_item" ON "public"."stock_movements" USING "btree" ("stock_item_id");


--
-- Name: idx_stock_movements_item_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_movements_item_created" ON "public"."stock_movements" USING "btree" ("stock_item_id", "created_at" DESC);


--
-- Name: idx_stock_movements_item_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_movements_item_date" ON "public"."stock_movements" USING "btree" ("stock_item_id", "created_at");


--
-- Name: idx_stock_movements_production_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_movements_production_order" ON "public"."stock_movements" USING "btree" ("production_order_id") WHERE ("production_order_id" IS NOT NULL);


--
-- Name: idx_stock_receipts_item_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_receipts_item_date" ON "public"."stock_receipts" USING "btree" ("stock_item_id", "received_date" DESC);


--
-- Name: idx_stock_receipts_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_receipts_supplier" ON "public"."stock_receipts" USING "btree" ("supplier_id", "received_date" DESC);


--
-- Name: idx_stock_semaphore; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_semaphore" ON "public"."stock_items" USING "btree" ("semaphore");


--
-- Name: idx_stock_snapshots_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_snapshots_date" ON "public"."stock_snapshots" USING "btree" ("snapshot_date");


--
-- Name: idx_stock_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_stock_supplier" ON "public"."stock_items" USING "btree" ("supplier_id");


--
-- Name: idx_suppliers_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_suppliers_category" ON "public"."suppliers" USING "btree" ("category");


--
-- Name: idx_suppliers_fudo_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_suppliers_fudo_provider" ON "public"."suppliers" USING "btree" ("fudo_provider_id") WHERE ("fudo_provider_id" IS NOT NULL);


--
-- Name: idx_suppliers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_suppliers_name" ON "public"."suppliers" USING "btree" ("name");


--
-- Name: idx_tolva_logs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_tolva_logs_date" ON "public"."tolva_logs" USING "btree" ("log_date" DESC, "shift");


--
-- Name: idx_tpl_inputs_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_tpl_inputs_template" ON "public"."production_template_inputs" USING "btree" ("template_id");


--
-- Name: idx_vajilla_snapshots_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_vajilla_snapshots_date" ON "public"."vajilla_snapshots" USING "btree" ("snapshot_date");


--
-- Name: idx_vajilla_stock_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_vajilla_stock_category" ON "public"."vajilla_stock" USING "btree" ("category");


--
-- Name: protocolo_tareas_asignado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "protocolo_tareas_asignado" ON "public"."protocolo_tareas" USING "btree" ("asignado_a") WHERE ("estado" = 'asignada'::"text");


--
-- Name: protocolo_tareas_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "protocolo_tareas_fecha" ON "public"."protocolo_tareas" USING "btree" ("fecha");


--
-- Name: push_subscriptions_endpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "public"."push_subscriptions" USING "btree" ("endpoint");


--
-- Name: push_subscriptions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "push_subscriptions_user_id_idx" ON "public"."push_subscriptions" USING "btree" ("user_id");


--
-- Name: stock_item_suppliers_one_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "stock_item_suppliers_one_primary" ON "public"."stock_item_suppliers" USING "btree" ("stock_item_id") WHERE "is_primary";


--
-- Name: stock_item_suppliers_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "stock_item_suppliers_supplier" ON "public"."stock_item_suppliers" USING "btree" ("supplier_id");


--
-- Name: uq_fudo_sales_sale_item; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_fudo_sales_sale_item" ON "public"."fudo_sales" USING "btree" ("fudo_sale_item_id") WHERE ("fudo_sale_item_id" IS NOT NULL);


--
-- Name: uq_fudo_sync_events_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_fudo_sync_events_idempotency" ON "public"."fudo_sync_events" USING "btree" ("idempotency_key");


--
-- Name: uq_fudo_sync_incidents_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_fudo_sync_incidents_key" ON "public"."fudo_sync_incidents" USING "btree" ("incident_key");


--
-- Name: uq_stock_items_fudo_ingredient_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_stock_items_fudo_ingredient_active" ON "public"."stock_items" USING "btree" ("fudo_ingredient_id") WHERE (("fudo_ingredient_id" IS NOT NULL) AND ("is_active" = true) AND (COALESCE("fudo_skip", false) = false));


--
-- Name: uq_stock_items_fudo_product_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_stock_items_fudo_product_active" ON "public"."stock_items" USING "btree" ("fudo_product_id") WHERE (("fudo_product_id" IS NOT NULL) AND ("is_active" = true) AND (COALESCE("fudo_skip", false) = false));


--
-- Name: kitchen_daily_logs set_kitchen_daily_logs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "set_kitchen_daily_logs_updated_at" BEFORE UPDATE ON "public"."kitchen_daily_logs" FOR EACH ROW EXECUTE FUNCTION "public"."handle_kitchen_logs_updated_at"();


--
-- Name: kitchen_orders set_kitchen_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "set_kitchen_orders_updated_at" BEFORE UPDATE ON "public"."kitchen_orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: menu_items set_menu_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "set_menu_items_updated_at" BEFORE UPDATE ON "public"."menu_items" FOR EACH ROW EXECUTE FUNCTION "public"."handle_menu_items_updated_at"();


--
-- Name: announcements trg_announcements_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_announcements_updated_at" BEFORE UPDATE ON "public"."announcements" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: announcements trg_audit_announcements; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_audit_announcements" AFTER INSERT ON "public"."announcements" FOR EACH ROW EXECUTE FUNCTION "public"."fn_audit_announcements"();


--
-- Name: attendance_logs trg_audit_attendance; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_audit_attendance" AFTER INSERT OR UPDATE ON "public"."attendance_logs" FOR EACH ROW EXECUTE FUNCTION "public"."fn_audit_attendance"();


--
-- Name: bar_orders trg_audit_bar_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_audit_bar_orders" AFTER INSERT OR UPDATE ON "public"."bar_orders" FOR EACH ROW EXECUTE FUNCTION "public"."fn_audit_orders"();


--
-- Name: bar_stock_items trg_audit_bar_stock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_audit_bar_stock" AFTER UPDATE ON "public"."bar_stock_items" FOR EACH ROW EXECUTE FUNCTION "public"."fn_audit_bar_stock"();


--
-- Name: kitchen_orders trg_audit_kitchen_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_audit_kitchen_orders" AFTER INSERT OR UPDATE ON "public"."kitchen_orders" FOR EACH ROW EXECUTE FUNCTION "public"."fn_audit_orders"();


--
-- Name: stock_items trg_audit_stock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_audit_stock" AFTER UPDATE ON "public"."stock_items" FOR EACH ROW EXECUTE FUNCTION "public"."fn_audit_stock"();


--
-- Name: vajilla_stock trg_audit_vajilla; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_audit_vajilla" AFTER INSERT OR UPDATE ON "public"."vajilla_stock" FOR EACH ROW EXECUTE FUNCTION "public"."fn_audit_vajilla"();


--
-- Name: bar_stock_items trg_bar_stock_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_bar_stock_log" AFTER UPDATE ON "public"."bar_stock_items" FOR EACH ROW EXECUTE FUNCTION "public"."fn_bar_stock_log"();


--
-- Name: checklist_items trg_checklist_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_checklist_items_updated_at" BEFORE UPDATE ON "public"."checklist_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: checklist_templates trg_checklist_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_checklist_templates_updated_at" BEFORE UPDATE ON "public"."checklist_templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: expedientes trg_expediente_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_expediente_code" BEFORE INSERT ON "public"."expedientes" FOR EACH ROW EXECUTE FUNCTION "public"."generate_expediente_code"();


--
-- Name: expedientes trg_expediente_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_expediente_updated" BEFORE UPDATE ON "public"."expedientes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: stock_items trg_item_supplier_links; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_item_supplier_links" AFTER INSERT OR UPDATE OF "supplier_id" ON "public"."stock_items" FOR EACH ROW EXECUTE FUNCTION "public"."sync_item_supplier_to_links"();


--
-- Name: kitchen_shifts trg_kitchen_shifts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_kitchen_shifts_updated_at" BEFORE UPDATE ON "public"."kitchen_shifts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: menu_categories trg_menu_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_menu_categories_updated_at" BEFORE UPDATE ON "public"."menu_categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: mise_en_place_items trg_mise_en_place_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_mise_en_place_items_updated_at" BEFORE UPDATE ON "public"."mise_en_place_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: mise_en_place_records trg_mise_en_place_records_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_mise_en_place_records_updated_at" BEFORE UPDATE ON "public"."mise_en_place_records" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: profiles trg_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: push_subscriptions trg_push_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_push_subscriptions_updated_at" BEFORE UPDATE ON "public"."push_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: shifts trg_shifts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_shifts_updated_at" BEFORE UPDATE ON "public"."shifts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: stock_item_suppliers trg_sis_sync_item; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_sis_sync_item" AFTER INSERT OR DELETE OR UPDATE OF "is_primary" ON "public"."stock_item_suppliers" FOR EACH ROW EXECUTE FUNCTION "public"."sync_primary_supplier_to_item"();


--
-- Name: stock_items trg_stock_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_stock_items_updated_at" BEFORE UPDATE ON "public"."stock_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: stock_items trg_stock_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_stock_log" AFTER UPDATE ON "public"."stock_items" FOR EACH ROW EXECUTE FUNCTION "public"."fn_stock_log"();


--
-- Name: suppliers trg_suppliers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_suppliers_updated_at" BEFORE UPDATE ON "public"."suppliers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();


--
-- Name: announcement_reads announcement_reads_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."announcement_reads"
    ADD CONSTRAINT "announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE CASCADE;


--
-- Name: announcement_reads announcement_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."announcement_reads"
    ADD CONSTRAINT "announcement_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: announcements announcements_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: announcements announcements_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."profiles"("id");


--
-- Name: app_settings app_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: attendance_config attendance_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."attendance_config"
    ADD CONSTRAINT "attendance_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: attendance_logs attendance_logs_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."attendance_logs"
    ADD CONSTRAINT "attendance_logs_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "public"."profiles"("id");


--
-- Name: attendance_logs attendance_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."attendance_logs"
    ADD CONSTRAINT "attendance_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: audit_trail audit_trail_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."audit_trail"
    ADD CONSTRAINT "audit_trail_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");


--
-- Name: bar_orders bar_orders_bar_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_orders"
    ADD CONSTRAINT "bar_orders_bar_stock_item_id_fkey" FOREIGN KEY ("bar_stock_item_id") REFERENCES "public"."bar_stock_items"("id") ON DELETE SET NULL;


--
-- Name: bar_orders bar_orders_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_orders"
    ADD CONSTRAINT "bar_orders_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: bar_orders bar_orders_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_orders"
    ADD CONSTRAINT "bar_orders_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE SET NULL;


--
-- Name: bar_orders bar_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_orders"
    ADD CONSTRAINT "bar_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");


--
-- Name: bar_product_recipes bar_product_recipes_bar_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_product_recipes"
    ADD CONSTRAINT "bar_product_recipes_bar_stock_item_id_fkey" FOREIGN KEY ("bar_stock_item_id") REFERENCES "public"."bar_stock_items"("id");


--
-- Name: bar_shift_handover bar_shift_handover_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_shift_handover"
    ADD CONSTRAINT "bar_shift_handover_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."profiles"("id");


--
-- Name: bar_stock_items bar_stock_items_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_stock_items"
    ADD CONSTRAINT "bar_stock_items_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");


--
-- Name: bar_stock_logs bar_stock_logs_bar_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_stock_logs"
    ADD CONSTRAINT "bar_stock_logs_bar_stock_item_id_fkey" FOREIGN KEY ("bar_stock_item_id") REFERENCES "public"."bar_stock_items"("id");


--
-- Name: bar_stock_logs bar_stock_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bar_stock_logs"
    ADD CONSTRAINT "bar_stock_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");


--
-- Name: checklist_items checklist_items_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checklist_items"
    ADD CONSTRAINT "checklist_items_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: checklist_items checklist_items_kitchen_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checklist_items"
    ADD CONSTRAINT "checklist_items_kitchen_shift_id_fkey" FOREIGN KEY ("kitchen_shift_id") REFERENCES "public"."kitchen_shifts"("id") ON DELETE CASCADE;


--
-- Name: checklist_items checklist_items_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checklist_items"
    ADD CONSTRAINT "checklist_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE SET NULL;


--
-- Name: checklist_templates checklist_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."checklist_templates"
    ADD CONSTRAINT "checklist_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: closing_hours closing_hours_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."closing_hours"
    ADD CONSTRAINT "closing_hours_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: device_registry device_registry_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."device_registry"
    ADD CONSTRAINT "device_registry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");


--
-- Name: expediente_comments expediente_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."expediente_comments"
    ADD CONSTRAINT "expediente_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id");


--
-- Name: expediente_comments expediente_comments_expediente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."expediente_comments"
    ADD CONSTRAINT "expediente_comments_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "public"."expedientes"("id") ON DELETE CASCADE;


--
-- Name: expediente_tasks expediente_tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."expediente_tasks"
    ADD CONSTRAINT "expediente_tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");


--
-- Name: expediente_tasks expediente_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."expediente_tasks"
    ADD CONSTRAINT "expediente_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: expediente_tasks expediente_tasks_expediente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."expediente_tasks"
    ADD CONSTRAINT "expediente_tasks_expediente_id_fkey" FOREIGN KEY ("expediente_id") REFERENCES "public"."expedientes"("id") ON DELETE CASCADE;


--
-- Name: expedientes expedientes_approver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."expedientes"
    ADD CONSTRAINT "expedientes_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "public"."profiles"("id");


--
-- Name: expedientes expedientes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."expedientes"
    ADD CONSTRAINT "expedientes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id");


--
-- Name: expedientes expedientes_responsible_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."expedientes"
    ADD CONSTRAINT "expedientes_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "public"."profiles"("id");


--
-- Name: fudo_reintentos fudo_reintentos_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."fudo_reintentos"
    ADD CONSTRAINT "fudo_reintentos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: fudo_reintentos fudo_reintentos_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."fudo_reintentos"
    ADD CONSTRAINT "fudo_reintentos_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE CASCADE;


--
-- Name: fudo_sync_events fudo_sync_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."fudo_sync_events"
    ADD CONSTRAINT "fudo_sync_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: fudo_sync_incidents fudo_sync_incidents_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."fudo_sync_incidents"
    ADD CONSTRAINT "fudo_sync_incidents_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: kitchen_daily_logs kitchen_daily_logs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_daily_logs"
    ADD CONSTRAINT "kitchen_daily_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: kitchen_orders kitchen_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_orders"
    ADD CONSTRAINT "kitchen_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: kitchen_orders kitchen_orders_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_orders"
    ADD CONSTRAINT "kitchen_orders_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: kitchen_orders kitchen_orders_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_orders"
    ADD CONSTRAINT "kitchen_orders_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE SET NULL;


--
-- Name: kitchen_orders kitchen_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_orders"
    ADD CONSTRAINT "kitchen_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");


--
-- Name: kitchen_shift_handover kitchen_shift_handover_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_shift_handover"
    ADD CONSTRAINT "kitchen_shift_handover_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."profiles"("id");


--
-- Name: kitchen_shifts kitchen_shifts_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_shifts"
    ADD CONSTRAINT "kitchen_shifts_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: kitchen_shifts kitchen_shifts_opened_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."kitchen_shifts"
    ADD CONSTRAINT "kitchen_shifts_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: menu_items menu_items_consumo_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_consumo_stock_item_id_fkey" FOREIGN KEY ("consumo_stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE SET NULL;


--
-- Name: menu_items menu_items_menu_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_menu_category_id_fkey" FOREIGN KEY ("menu_category_id") REFERENCES "public"."menu_categories"("id") ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: menu_items menu_items_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id");


--
-- Name: mise_en_place_items mise_en_place_items_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."mise_en_place_items"
    ADD CONSTRAINT "mise_en_place_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE SET NULL;


--
-- Name: mise_en_place_records mise_en_place_records_kitchen_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."mise_en_place_records"
    ADD CONSTRAINT "mise_en_place_records_kitchen_shift_id_fkey" FOREIGN KEY ("kitchen_shift_id") REFERENCES "public"."kitchen_shifts"("id") ON DELETE CASCADE;


--
-- Name: mise_en_place_records mise_en_place_records_mise_en_place_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."mise_en_place_records"
    ADD CONSTRAINT "mise_en_place_records_mise_en_place_item_id_fkey" FOREIGN KEY ("mise_en_place_item_id") REFERENCES "public"."mise_en_place_items"("id") ON DELETE CASCADE;


--
-- Name: mise_en_place_records mise_en_place_records_produced_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."mise_en_place_records"
    ADD CONSTRAINT "mise_en_place_records_produced_by_fkey" FOREIGN KEY ("produced_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: production_inputs production_inputs_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_inputs"
    ADD CONSTRAINT "production_inputs_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE CASCADE;


--
-- Name: production_inputs production_inputs_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_inputs"
    ADD CONSTRAINT "production_inputs_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id");


--
-- Name: production_orders production_orders_chef_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_orders"
    ADD CONSTRAINT "production_orders_chef_id_fkey" FOREIGN KEY ("chef_id") REFERENCES "public"."profiles"("id");


--
-- Name: production_orders production_orders_main_output_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_orders"
    ADD CONSTRAINT "production_orders_main_output_stock_item_id_fkey" FOREIGN KEY ("main_output_stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE SET NULL;


--
-- Name: production_orders production_orders_parent_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_orders"
    ADD CONSTRAINT "production_orders_parent_order_id_fkey" FOREIGN KEY ("parent_order_id") REFERENCES "public"."production_orders"("id");


--
-- Name: production_orders production_orders_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_orders"
    ADD CONSTRAINT "production_orders_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: production_orders production_orders_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_orders"
    ADD CONSTRAINT "production_orders_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."production_templates"("id");


--
-- Name: production_outputs production_outputs_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_outputs"
    ADD CONSTRAINT "production_outputs_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE CASCADE;


--
-- Name: production_outputs production_outputs_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_outputs"
    ADD CONSTRAINT "production_outputs_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id");


--
-- Name: production_template_inputs production_template_inputs_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_template_inputs"
    ADD CONSTRAINT "production_template_inputs_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE SET NULL;


--
-- Name: production_template_inputs production_template_inputs_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_template_inputs"
    ADD CONSTRAINT "production_template_inputs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."production_templates"("id") ON DELETE CASCADE;


--
-- Name: production_template_outputs production_template_outputs_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_template_outputs"
    ADD CONSTRAINT "production_template_outputs_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id");


--
-- Name: production_template_outputs production_template_outputs_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_template_outputs"
    ADD CONSTRAINT "production_template_outputs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."production_templates"("id") ON DELETE CASCADE;


--
-- Name: production_templates production_templates_default_input_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_templates"
    ADD CONSTRAINT "production_templates_default_input_stock_item_id_fkey" FOREIGN KEY ("default_input_stock_item_id") REFERENCES "public"."stock_items"("id");


--
-- Name: production_templates production_templates_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_templates"
    ADD CONSTRAINT "production_templates_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id");


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: protocolo_tareas protocolo_tareas_asignado_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."protocolo_tareas"
    ADD CONSTRAINT "protocolo_tareas_asignado_a_fkey" FOREIGN KEY ("asignado_a") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: protocolo_tareas protocolo_tareas_asignado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."protocolo_tareas"
    ADD CONSTRAINT "protocolo_tareas_asignado_por_fkey" FOREIGN KEY ("asignado_por") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: protocolo_tareas protocolo_tareas_hecho_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."protocolo_tareas"
    ADD CONSTRAINT "protocolo_tareas_hecho_por_fkey" FOREIGN KEY ("hecho_por") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: protocolo_tareas protocolo_tareas_protocolo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."protocolo_tareas"
    ADD CONSTRAINT "protocolo_tareas_protocolo_id_fkey" FOREIGN KEY ("protocolo_id") REFERENCES "public"."protocolos"("id") ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");


--
-- Name: recipe_ingredient_pending_links recipe_ingredient_pending_links_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipe_ingredient_pending_links"
    ADD CONSTRAINT "recipe_ingredient_pending_links_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE CASCADE;


--
-- Name: recipe_ingredient_pending_links recipe_ingredient_pending_links_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipe_ingredient_pending_links"
    ADD CONSTRAINT "recipe_ingredient_pending_links_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id");


--
-- Name: recipe_ingredient_pending_links recipe_ingredient_pending_links_resolved_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipe_ingredient_pending_links"
    ADD CONSTRAINT "recipe_ingredient_pending_links_resolved_stock_item_id_fkey" FOREIGN KEY ("resolved_stock_item_id") REFERENCES "public"."stock_items"("id");


--
-- Name: recipe_ingredient_pending_links recipe_ingredient_pending_links_suggested_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipe_ingredient_pending_links"
    ADD CONSTRAINT "recipe_ingredient_pending_links_suggested_stock_item_id_fkey" FOREIGN KEY ("suggested_stock_item_id") REFERENCES "public"."stock_items"("id");


--
-- Name: recipe_ingredients recipe_ingredients_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipe_ingredients"
    ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id");


--
-- Name: recipe_ingredients recipe_ingredients_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipe_ingredients"
    ADD CONSTRAINT "recipe_ingredients_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id");


--
-- Name: recipes recipes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: recipes recipes_output_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_output_stock_item_id_fkey" FOREIGN KEY ("output_stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE SET NULL;


--
-- Name: sales_engine_daily sales_engine_daily_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_engine_daily"
    ADD CONSTRAINT "sales_engine_daily_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE CASCADE;


--
-- Name: sales_engine_state sales_engine_state_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sales_engine_state"
    ADD CONSTRAINT "sales_engine_state_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE CASCADE;


--
-- Name: salon_item_status salon_item_status_served_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."salon_item_status"
    ADD CONSTRAINT "salon_item_status_served_by_fkey" FOREIGN KEY ("served_by") REFERENCES "public"."profiles"("id");


--
-- Name: shifts shifts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: shifts shifts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: stock_alerts stock_alerts_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_alerts"
    ADD CONSTRAINT "stock_alerts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id");


--
-- Name: stock_alerts stock_alerts_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_alerts"
    ADD CONSTRAINT "stock_alerts_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE CASCADE;


--
-- Name: stock_anomaly_decisions stock_anomaly_decisions_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_anomaly_decisions"
    ADD CONSTRAINT "stock_anomaly_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: stock_anomaly_decisions stock_anomaly_decisions_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_anomaly_decisions"
    ADD CONSTRAINT "stock_anomaly_decisions_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE CASCADE;


--
-- Name: stock_anomaly_rules stock_anomaly_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_anomaly_rules"
    ADD CONSTRAINT "stock_anomaly_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: stock_anomaly_rules stock_anomaly_rules_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_anomaly_rules"
    ADD CONSTRAINT "stock_anomaly_rules_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE CASCADE;


--
-- Name: stock_count_aliases stock_count_aliases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_count_aliases"
    ADD CONSTRAINT "stock_count_aliases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: stock_count_aliases stock_count_aliases_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_count_aliases"
    ADD CONSTRAINT "stock_count_aliases_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE CASCADE;


--
-- Name: stock_item_suppliers stock_item_suppliers_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_item_suppliers"
    ADD CONSTRAINT "stock_item_suppliers_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: stock_item_suppliers stock_item_suppliers_dismissed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_item_suppliers"
    ADD CONSTRAINT "stock_item_suppliers_dismissed_by_fkey" FOREIGN KEY ("dismissed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: stock_item_suppliers stock_item_suppliers_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_item_suppliers"
    ADD CONSTRAINT "stock_item_suppliers_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE CASCADE;


--
-- Name: stock_item_suppliers stock_item_suppliers_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_item_suppliers"
    ADD CONSTRAINT "stock_item_suppliers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE;


--
-- Name: stock_items stock_items_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_items"
    ADD CONSTRAINT "stock_items_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");


--
-- Name: stock_logs stock_logs_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_logs"
    ADD CONSTRAINT "stock_logs_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id");


--
-- Name: stock_logs stock_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_logs"
    ADD CONSTRAINT "stock_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");


--
-- Name: stock_lots stock_lots_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_lots"
    ADD CONSTRAINT "stock_lots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: stock_lots stock_lots_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_lots"
    ADD CONSTRAINT "stock_lots_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE SET NULL;


--
-- Name: stock_lots stock_lots_production_output_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_lots"
    ADD CONSTRAINT "stock_lots_production_output_id_fkey" FOREIGN KEY ("production_output_id") REFERENCES "public"."production_outputs"("id") ON DELETE SET NULL;


--
-- Name: stock_lots stock_lots_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_lots"
    ADD CONSTRAINT "stock_lots_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE CASCADE;


--
-- Name: stock_movements stock_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: stock_movements stock_movements_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE SET NULL;


--
-- Name: stock_movements stock_movements_related_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_related_log_id_fkey" FOREIGN KEY ("related_log_id") REFERENCES "public"."kitchen_daily_logs"("id");


--
-- Name: stock_movements stock_movements_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id");


--
-- Name: stock_receipts stock_receipts_paid_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_receipts"
    ADD CONSTRAINT "stock_receipts_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "public"."profiles"("id");


--
-- Name: stock_receipts stock_receipts_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_receipts"
    ADD CONSTRAINT "stock_receipts_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: stock_receipts stock_receipts_stock_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_receipts"
    ADD CONSTRAINT "stock_receipts_stock_item_id_fkey" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE SET NULL;


--
-- Name: stock_receipts stock_receipts_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_receipts"
    ADD CONSTRAINT "stock_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;


--
-- Name: stock_snapshots stock_snapshots_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."stock_snapshots"
    ADD CONSTRAINT "stock_snapshots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: tolva_logs tolva_logs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."tolva_logs"
    ADD CONSTRAINT "tolva_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: vajilla_snapshots vajilla_snapshots_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."vajilla_snapshots"
    ADD CONSTRAINT "vajilla_snapshots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: recipe_ingredient_pending_links Admins can manage pending links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage pending links" ON "public"."recipe_ingredient_pending_links" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: recipe_ingredient_pending_links Authenticated can read pending links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read pending links" ON "public"."recipe_ingredient_pending_links" FOR SELECT TO "authenticated" USING (true);


--
-- Name: recipes Authenticated can read recipes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read recipes" ON "public"."recipes" FOR SELECT TO "authenticated" USING (true);


--
-- Name: stock_movements Authenticated can read stock_movements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read stock_movements" ON "public"."stock_movements" FOR SELECT TO "authenticated" USING (true);


--
-- Name: recipes Kitchen roles can manage recipes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Kitchen roles can manage recipes" ON "public"."recipes" TO "authenticated" USING (true) WITH CHECK (true);


--
-- Name: stock_movements Roles can insert stock_movements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Roles can insert stock_movements" ON "public"."stock_movements" FOR INSERT TO "authenticated" WITH CHECK (true);


--
-- Name: stock_alerts alerts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "alerts_select" ON "public"."stock_alerts" FOR SELECT TO "authenticated" USING ("public"."is_encargado"());


--
-- Name: stock_alerts alerts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "alerts_update" ON "public"."stock_alerts" FOR UPDATE TO "authenticated" USING ("public"."is_encargado"());


--
-- Name: announcement_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."announcement_reads" ENABLE ROW LEVEL SECURITY;

--
-- Name: announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."announcements" ENABLE ROW LEVEL SECURITY;

--
-- Name: announcements announcements_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "announcements_delete" ON "public"."announcements" FOR DELETE TO "authenticated" USING ("public"."is_encargado"());


--
-- Name: announcements announcements_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "announcements_insert" ON "public"."announcements" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_encargado_or_chef"());


--
-- Name: announcements announcements_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "announcements_select" ON "public"."announcements" FOR SELECT TO "authenticated" USING (true);


--
-- Name: announcements announcements_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "announcements_update" ON "public"."announcements" FOR UPDATE TO "authenticated" USING ((("author_id" = "auth"."uid"()) OR "public"."is_encargado"()));


--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings app_settings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "app_settings_read" ON "public"."app_settings" FOR SELECT TO "authenticated" USING (true);


--
-- Name: app_settings app_settings_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "app_settings_write" ON "public"."app_settings" USING (("public"."auth_role"() = 'socio'::"text")) WITH CHECK (("public"."auth_role"() = 'socio'::"text"));


--
-- Name: attendance_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."attendance_config" ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_config attendance_config_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "attendance_config_read" ON "public"."attendance_config" FOR SELECT TO "authenticated" USING (true);


--
-- Name: attendance_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."attendance_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_logs attendance_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "attendance_select" ON "public"."attendance_logs" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_encargado"()));


--
-- Name: attendance_logs attendance_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "attendance_update" ON "public"."attendance_logs" FOR UPDATE TO "authenticated" USING ("public"."is_encargado"()) WITH CHECK ("public"."is_encargado"());


--
-- Name: audit_log audit_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "audit_insert" ON "public"."audit_log" FOR INSERT TO "authenticated" WITH CHECK (true);


--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "audit_select" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ("public"."is_encargado"());


--
-- Name: audit_trail; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."audit_trail" ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_trail audit_trail_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "audit_trail_insert" ON "public"."audit_trail" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: audit_trail audit_trail_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "audit_trail_select" ON "public"."audit_trail" FOR SELECT USING ((("public"."auth_role"() = 'socio'::"text") OR ("auth"."uid"() = 'd058c880-9ec3-4205-be49-84476da0b2d6'::"uuid")));


--
-- Name: bar_shift_handover bar_handover_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bar_handover_insert" ON "public"."bar_shift_handover" FOR INSERT WITH CHECK (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'barista'::"text"])));


--
-- Name: bar_shift_handover bar_handover_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bar_handover_select" ON "public"."bar_shift_handover" FOR SELECT TO "authenticated" USING (true);


--
-- Name: bar_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."bar_orders" ENABLE ROW LEVEL SECURITY;

--
-- Name: bar_orders bar_orders_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bar_orders_select" ON "public"."bar_orders" FOR SELECT TO "authenticated" USING (true);


--
-- Name: bar_orders bar_orders_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bar_orders_update" ON "public"."bar_orders" FOR UPDATE TO "authenticated" USING ("public"."is_encargado"()) WITH CHECK ("public"."is_encargado"());


--
-- Name: bar_product_recipes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."bar_product_recipes" ENABLE ROW LEVEL SECURITY;

--
-- Name: bar_product_recipes bar_product_recipes_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bar_product_recipes_modify" ON "public"."bar_product_recipes" USING (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'barista'::"text"])));


--
-- Name: bar_product_recipes bar_product_recipes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bar_product_recipes_select" ON "public"."bar_product_recipes" FOR SELECT TO "authenticated" USING (true);


--
-- Name: bar_shift_handover; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."bar_shift_handover" ENABLE ROW LEVEL SECURITY;

--
-- Name: bar_stock_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."bar_stock_items" ENABLE ROW LEVEL SECURITY;

--
-- Name: bar_stock_items bar_stock_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bar_stock_items_insert" ON "public"."bar_stock_items" FOR INSERT WITH CHECK (true);


--
-- Name: bar_stock_items bar_stock_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bar_stock_items_select" ON "public"."bar_stock_items" FOR SELECT USING (true);


--
-- Name: bar_stock_items bar_stock_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bar_stock_items_update" ON "public"."bar_stock_items" FOR UPDATE USING (true);


--
-- Name: bar_stock_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."bar_stock_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: bar_stock_logs bar_stock_logs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bar_stock_logs_insert" ON "public"."bar_stock_logs" FOR INSERT WITH CHECK (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'barista'::"text"])));


--
-- Name: bar_stock_logs bar_stock_logs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bar_stock_logs_select" ON "public"."bar_stock_logs" FOR SELECT TO "authenticated" USING (true);


--
-- Name: checklist_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."checklist_items" ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_items checklist_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "checklist_items_insert" ON "public"."checklist_items" FOR INSERT WITH CHECK (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'chef'::"text", 'cocina'::"text"])));


--
-- Name: checklist_items checklist_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "checklist_items_select" ON "public"."checklist_items" FOR SELECT TO "authenticated" USING (true);


--
-- Name: checklist_items checklist_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "checklist_items_update" ON "public"."checklist_items" FOR UPDATE USING (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'chef'::"text", 'cocina'::"text"])));


--
-- Name: checklist_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."checklist_templates" ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_templates checklist_templates_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "checklist_templates_delete" ON "public"."checklist_templates" FOR DELETE USING (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text"])));


--
-- Name: checklist_templates checklist_templates_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "checklist_templates_insert" ON "public"."checklist_templates" FOR INSERT WITH CHECK (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'chef'::"text"])));


--
-- Name: checklist_templates checklist_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "checklist_templates_select" ON "public"."checklist_templates" FOR SELECT TO "authenticated" USING (true);


--
-- Name: checklist_templates checklist_templates_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "checklist_templates_update" ON "public"."checklist_templates" FOR UPDATE USING (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'chef'::"text"])));


--
-- Name: closing_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."closing_hours" ENABLE ROW LEVEL SECURITY;

--
-- Name: closing_hours closing_hours_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "closing_hours_all" ON "public"."closing_hours" USING (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text"])));


--
-- Name: closing_hours closing_hours_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "closing_hours_select" ON "public"."closing_hours" FOR SELECT TO "authenticated" USING (true);


--
-- Name: device_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."device_registry" ENABLE ROW LEVEL SECURITY;

--
-- Name: device_registry device_registry_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "device_registry_own" ON "public"."device_registry" USING ((("user_id" = "auth"."uid"()) OR ("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text"])))) WITH CHECK ((("user_id" = "auth"."uid"()) OR ("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text"]))));


--
-- Name: expediente_comments exp_comments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "exp_comments_insert" ON "public"."expediente_comments" FOR INSERT TO "authenticated" WITH CHECK (("author_id" = "auth"."uid"()));


--
-- Name: expediente_comments exp_comments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "exp_comments_select" ON "public"."expediente_comments" FOR SELECT TO "authenticated" USING (true);


--
-- Name: expediente_tasks exp_tasks_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "exp_tasks_delete" ON "public"."expediente_tasks" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: expediente_tasks exp_tasks_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "exp_tasks_insert" ON "public"."expediente_tasks" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: expediente_tasks exp_tasks_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "exp_tasks_select" ON "public"."expediente_tasks" FOR SELECT TO "authenticated" USING (true);


--
-- Name: expediente_tasks exp_tasks_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "exp_tasks_update" ON "public"."expediente_tasks" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND (("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"])) OR ("profiles"."id" = "expediente_tasks"."assigned_to"))))));


--
-- Name: expediente_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."expediente_comments" ENABLE ROW LEVEL SECURITY;

--
-- Name: expediente_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."expediente_tasks" ENABLE ROW LEVEL SECURITY;

--
-- Name: expedientes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."expedientes" ENABLE ROW LEVEL SECURITY;

--
-- Name: expedientes expedientes_anyone_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "expedientes_anyone_insert" ON "public"."expedientes" FOR INSERT TO "authenticated" WITH CHECK (("author_id" = "auth"."uid"()));


--
-- Name: expedientes expedientes_encargado_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "expedientes_encargado_read" ON "public"."expedientes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'encargado'::"public"."app_role")))));


--
-- Name: expedientes expedientes_encargado_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "expedientes_encargado_update" ON "public"."expedientes" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'encargado'::"public"."app_role")))));


--
-- Name: expedientes expedientes_socio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "expedientes_socio" ON "public"."expedientes" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'socio'::"public"."app_role")))));


--
-- Name: expedientes expedientes_staff_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "expedientes_staff_own" ON "public"."expedientes" FOR SELECT TO "authenticated" USING ((("author_id" = "auth"."uid"()) OR ("responsible_id" = "auth"."uid"())));


--
-- Name: fudo_reintentos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."fudo_reintentos" ENABLE ROW LEVEL SECURITY;

--
-- Name: fudo_reintentos fudo_reintentos_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "fudo_reintentos_select" ON "public"."fudo_reintentos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: fudo_sale_subitems; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."fudo_sale_subitems" ENABLE ROW LEVEL SECURITY;

--
-- Name: fudo_sale_subitems fudo_sale_subitems_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "fudo_sale_subitems_select" ON "public"."fudo_sale_subitems" FOR SELECT TO "authenticated" USING (true);


--
-- Name: fudo_sales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."fudo_sales" ENABLE ROW LEVEL SECURITY;

--
-- Name: fudo_sales fudo_sales_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "fudo_sales_select" ON "public"."fudo_sales" FOR SELECT TO "authenticated" USING (true);


--
-- Name: fudo_salud; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."fudo_salud" ENABLE ROW LEVEL SECURITY;

--
-- Name: fudo_salud fudo_salud_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "fudo_salud_select" ON "public"."fudo_salud" FOR SELECT TO "authenticated" USING (true);


--
-- Name: fudo_sync_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."fudo_sync_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: fudo_sync_incidents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."fudo_sync_incidents" ENABLE ROW LEVEL SECURITY;

--
-- Name: kitchen_daily_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."kitchen_daily_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: kitchen_shift_handover kitchen_handover_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "kitchen_handover_insert" ON "public"."kitchen_shift_handover" FOR INSERT WITH CHECK (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'chef'::"text", 'cocina'::"text"])));


--
-- Name: kitchen_shift_handover kitchen_handover_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "kitchen_handover_select" ON "public"."kitchen_shift_handover" FOR SELECT TO "authenticated" USING (true);


--
-- Name: kitchen_daily_logs kitchen_logs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "kitchen_logs_insert" ON "public"."kitchen_daily_logs" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['cocina'::"public"."app_role", 'chef'::"public"."app_role"]))))) AND ("created_by" = "auth"."uid"())));


--
-- Name: kitchen_daily_logs kitchen_logs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "kitchen_logs_select" ON "public"."kitchen_daily_logs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['cocina'::"public"."app_role", 'chef'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: kitchen_daily_logs kitchen_logs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "kitchen_logs_update" ON "public"."kitchen_daily_logs" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['cocina'::"public"."app_role", 'chef'::"public"."app_role"]))))));


--
-- Name: kitchen_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."kitchen_orders" ENABLE ROW LEVEL SECURITY;

--
-- Name: kitchen_orders kitchen_orders_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "kitchen_orders_insert" ON "public"."kitchen_orders" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['chef'::"public"."app_role", 'cocina'::"public"."app_role", 'encargado'::"public"."app_role", 'socio'::"public"."app_role"]))))));


--
-- Name: kitchen_orders kitchen_orders_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "kitchen_orders_select" ON "public"."kitchen_orders" FOR SELECT TO "authenticated" USING (true);


--
-- Name: kitchen_orders kitchen_orders_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "kitchen_orders_update" ON "public"."kitchen_orders" FOR UPDATE TO "authenticated" USING ("public"."is_encargado"()) WITH CHECK ("public"."is_encargado"());


--
-- Name: kitchen_shift_handover; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."kitchen_shift_handover" ENABLE ROW LEVEL SECURITY;

--
-- Name: kitchen_shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."kitchen_shifts" ENABLE ROW LEVEL SECURITY;

--
-- Name: kitchen_shifts kitchen_shifts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "kitchen_shifts_insert" ON "public"."kitchen_shifts" FOR INSERT WITH CHECK (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'chef'::"text", 'cocina'::"text"])));


--
-- Name: kitchen_shifts kitchen_shifts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "kitchen_shifts_select" ON "public"."kitchen_shifts" FOR SELECT TO "authenticated" USING (true);


--
-- Name: kitchen_shifts kitchen_shifts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "kitchen_shifts_update" ON "public"."kitchen_shifts" FOR UPDATE USING (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'chef'::"text", 'cocina'::"text"])));


--
-- Name: production_inputs manage_production_inputs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "manage_production_inputs" ON "public"."production_inputs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role", 'chef'::"public"."app_role", 'cocina'::"public"."app_role"]))))));


--
-- Name: production_orders manage_production_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "manage_production_orders" ON "public"."production_orders" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role", 'chef'::"public"."app_role", 'cocina'::"public"."app_role"]))))));


--
-- Name: production_outputs manage_production_outputs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "manage_production_outputs" ON "public"."production_outputs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role", 'chef'::"public"."app_role", 'cocina'::"public"."app_role"]))))));


--
-- Name: production_template_outputs manage_production_template_outputs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "manage_production_template_outputs" ON "public"."production_template_outputs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role", 'chef'::"public"."app_role"]))))));


--
-- Name: production_templates manage_production_templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "manage_production_templates" ON "public"."production_templates" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role", 'chef'::"public"."app_role"]))))));


--
-- Name: stock_lots manage_stock_lots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "manage_stock_lots" ON "public"."stock_lots" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role", 'chef'::"public"."app_role", 'cocina'::"public"."app_role"]))))));


--
-- Name: stock_anomaly_decisions managers_manage_stock_anomaly_decisions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers_manage_stock_anomaly_decisions" ON "public"."stock_anomaly_decisions" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: stock_anomaly_rules managers_manage_stock_anomaly_rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers_manage_stock_anomaly_rules" ON "public"."stock_anomaly_rules" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: stock_anomaly_decisions managers_read_stock_anomaly_decisions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers_read_stock_anomaly_decisions" ON "public"."stock_anomaly_decisions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: stock_anomaly_rules managers_read_stock_anomaly_rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers_read_stock_anomaly_rules" ON "public"."stock_anomaly_rules" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: menu_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."menu_categories" ENABLE ROW LEVEL SECURITY;

--
-- Name: menu_categories menu_categories_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "menu_categories_select" ON "public"."menu_categories" FOR SELECT TO "authenticated" USING (true);


--
-- Name: menu_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."menu_items" ENABLE ROW LEVEL SECURITY;

--
-- Name: menu_items menu_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "menu_items_insert" ON "public"."menu_items" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['encargado'::"public"."app_role", 'chef'::"public"."app_role"]))))));


--
-- Name: menu_items menu_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "menu_items_select" ON "public"."menu_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));


--
-- Name: menu_items menu_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "menu_items_update" ON "public"."menu_items" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['encargado'::"public"."app_role", 'chef'::"public"."app_role"]))))));


--
-- Name: mise_en_place_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."mise_en_place_items" ENABLE ROW LEVEL SECURITY;

--
-- Name: mise_en_place_items mise_en_place_items_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "mise_en_place_items_delete" ON "public"."mise_en_place_items" FOR DELETE USING (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text"])));


--
-- Name: mise_en_place_items mise_en_place_items_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "mise_en_place_items_insert" ON "public"."mise_en_place_items" FOR INSERT WITH CHECK (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'chef'::"text"])));


--
-- Name: mise_en_place_items mise_en_place_items_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "mise_en_place_items_select" ON "public"."mise_en_place_items" FOR SELECT TO "authenticated" USING (true);


--
-- Name: mise_en_place_items mise_en_place_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "mise_en_place_items_update" ON "public"."mise_en_place_items" FOR UPDATE USING (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'chef'::"text"])));


--
-- Name: mise_en_place_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."mise_en_place_records" ENABLE ROW LEVEL SECURITY;

--
-- Name: mise_en_place_records mise_en_place_records_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "mise_en_place_records_insert" ON "public"."mise_en_place_records" FOR INSERT WITH CHECK (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'chef'::"text", 'cocina'::"text"])));


--
-- Name: mise_en_place_records mise_en_place_records_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "mise_en_place_records_select" ON "public"."mise_en_place_records" FOR SELECT TO "authenticated" USING (true);


--
-- Name: mise_en_place_records mise_en_place_records_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "mise_en_place_records_update" ON "public"."mise_en_place_records" FOR UPDATE USING (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'chef'::"text", 'cocina'::"text"])));


--
-- Name: payroll_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."payroll_rates" ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_rates payroll_rates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "payroll_rates_select" ON "public"."payroll_rates" FOR SELECT TO "authenticated" USING (true);


--
-- Name: payroll_rates payroll_rates_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "payroll_rates_update" ON "public"."payroll_rates" FOR UPDATE USING (("public"."auth_role"() = 'socio'::"text"));


--
-- Name: production_inputs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."production_inputs" ENABLE ROW LEVEL SECURITY;

--
-- Name: production_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."production_orders" ENABLE ROW LEVEL SECURITY;

--
-- Name: production_outputs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."production_outputs" ENABLE ROW LEVEL SECURITY;

--
-- Name: production_template_inputs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."production_template_inputs" ENABLE ROW LEVEL SECURITY;

--
-- Name: production_template_outputs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."production_template_outputs" ENABLE ROW LEVEL SECURITY;

--
-- Name: production_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."production_templates" ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles_insert" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("id" = "auth"."uid"()));


--
-- Name: profiles profiles_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles_select_all" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_encargado"()));


--
-- Name: protocolo_tareas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."protocolo_tareas" ENABLE ROW LEVEL SECURITY;

--
-- Name: protocolo_tareas protocolo_tareas_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "protocolo_tareas_select" ON "public"."protocolo_tareas" FOR SELECT TO "authenticated" USING (true);


--
-- Name: protocolos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."protocolos" ENABLE ROW LEVEL SECURITY;

--
-- Name: protocolos protocolos_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "protocolos_select" ON "public"."protocolos" FOR SELECT TO "authenticated" USING (true);


--
-- Name: push_subscriptions push_sub_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "push_sub_own" ON "public"."push_subscriptions" USING (("auth"."uid"() = "user_id"));


--
-- Name: push_subscriptions push_subs_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "push_subs_delete" ON "public"."push_subscriptions" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: push_subscriptions push_subs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "push_subs_insert" ON "public"."push_subscriptions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: push_subscriptions push_subs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "push_subs_select" ON "public"."push_subscriptions" FOR SELECT USING ((("auth"."uid"() = "user_id") OR ("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text"]))));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "push_subscriptions_delete_own" ON "public"."push_subscriptions" FOR DELETE USING (("auth"."uid"() = "user_id"));


--
-- Name: push_subscriptions push_subscriptions_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "push_subscriptions_insert_own" ON "public"."push_subscriptions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: push_subscriptions push_subscriptions_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "push_subscriptions_select_own" ON "public"."push_subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: push_subscriptions push_subscriptions_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "push_subscriptions_update_own" ON "public"."push_subscriptions" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));


--
-- Name: fudo_sync_events read_fudo_sync_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read_fudo_sync_events" ON "public"."fudo_sync_events" FOR SELECT TO "authenticated" USING (true);


--
-- Name: fudo_sync_incidents read_fudo_sync_incidents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read_fudo_sync_incidents" ON "public"."fudo_sync_incidents" FOR SELECT TO "authenticated" USING (true);


--
-- Name: production_inputs read_production_inputs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read_production_inputs" ON "public"."production_inputs" FOR SELECT TO "authenticated" USING (true);


--
-- Name: production_orders read_production_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read_production_orders" ON "public"."production_orders" FOR SELECT TO "authenticated" USING (true);


--
-- Name: production_outputs read_production_outputs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read_production_outputs" ON "public"."production_outputs" FOR SELECT TO "authenticated" USING (true);


--
-- Name: production_template_outputs read_production_template_outputs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read_production_template_outputs" ON "public"."production_template_outputs" FOR SELECT TO "authenticated" USING (true);


--
-- Name: production_templates read_production_templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read_production_templates" ON "public"."production_templates" FOR SELECT TO "authenticated" USING (true);


--
-- Name: stock_lots read_stock_lots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read_stock_lots" ON "public"."stock_lots" FOR SELECT TO "authenticated" USING (true);


--
-- Name: announcement_reads reads_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "reads_insert" ON "public"."announcement_reads" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));


--
-- Name: announcement_reads reads_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "reads_select" ON "public"."announcement_reads" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_encargado"()));


--
-- Name: recipe_ingredient_pending_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."recipe_ingredient_pending_links" ENABLE ROW LEVEL SECURITY;

--
-- Name: recipe_ingredients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."recipe_ingredients" ENABLE ROW LEVEL SECURITY;

--
-- Name: recipe_ingredients recipe_ingredients_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "recipe_ingredients_select" ON "public"."recipe_ingredients" FOR SELECT TO "authenticated" USING (true);


--
-- Name: recipes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."recipes" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_engine_daily; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sales_engine_daily" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_engine_daily sales_engine_daily_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales_engine_daily_read" ON "public"."sales_engine_daily" FOR SELECT TO "authenticated" USING (true);


--
-- Name: sales_engine_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."sales_engine_state" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_engine_state sales_engine_state_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sales_engine_state_read" ON "public"."sales_engine_state" FOR SELECT TO "authenticated" USING (true);


--
-- Name: salon_item_status salon_item_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "salon_item_delete" ON "public"."salon_item_status" FOR DELETE USING (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text"])));


--
-- Name: salon_item_status salon_item_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "salon_item_insert" ON "public"."salon_item_status" FOR INSERT WITH CHECK (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'runner'::"text", 'barista'::"text", 'bacha'::"text"])));


--
-- Name: salon_item_status salon_item_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "salon_item_select" ON "public"."salon_item_status" FOR SELECT TO "authenticated" USING (true);


--
-- Name: salon_item_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."salon_item_status" ENABLE ROW LEVEL SECURITY;

--
-- Name: fudo_sync_events service_manage_fudo_sync_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_manage_fudo_sync_events" ON "public"."fudo_sync_events" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role", 'chef'::"public"."app_role"]))))));


--
-- Name: fudo_sync_incidents service_manage_fudo_sync_incidents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_manage_fudo_sync_incidents" ON "public"."fudo_sync_incidents" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role", 'chef'::"public"."app_role"]))))));


--
-- Name: shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."shifts" ENABLE ROW LEVEL SECURITY;

--
-- Name: shifts shifts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "shifts_delete" ON "public"."shifts" FOR DELETE TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['encargado'::"text", 'socio'::"text"])));


--
-- Name: shifts shifts_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "shifts_insert" ON "public"."shifts" FOR INSERT TO "authenticated" WITH CHECK (("public"."auth_role"() = ANY (ARRAY['encargado'::"text", 'socio'::"text"])));


--
-- Name: shifts shifts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "shifts_select" ON "public"."shifts" FOR SELECT TO "authenticated" USING (true);


--
-- Name: shifts shifts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "shifts_update" ON "public"."shifts" FOR UPDATE TO "authenticated" USING (("public"."auth_role"() = ANY (ARRAY['encargado'::"text", 'socio'::"text"]))) WITH CHECK (("public"."auth_role"() = ANY (ARRAY['encargado'::"text", 'socio'::"text"])));


--
-- Name: stock_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."stock_alerts" ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_anomaly_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."stock_anomaly_decisions" ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_anomaly_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."stock_anomaly_rules" ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_count_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."stock_count_aliases" ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_count_aliases stock_count_aliases_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stock_count_aliases_select" ON "public"."stock_count_aliases" FOR SELECT TO "authenticated" USING (true);


--
-- Name: stock_items stock_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stock_delete" ON "public"."stock_items" FOR DELETE TO "authenticated" USING ("public"."is_encargado"());


--
-- Name: stock_items stock_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stock_insert" ON "public"."stock_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_encargado"());


--
-- Name: stock_item_suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."stock_item_suppliers" ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_item_suppliers stock_item_suppliers_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stock_item_suppliers_select" ON "public"."stock_item_suppliers" FOR SELECT TO "authenticated" USING (true);


--
-- Name: stock_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."stock_items" ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."stock_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_logs stock_logs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stock_logs_insert" ON "public"."stock_logs" FOR INSERT WITH CHECK (("public"."auth_role"() = ANY (ARRAY['socio'::"text", 'encargado'::"text", 'chef'::"text", 'cocina'::"text"])));


--
-- Name: stock_logs stock_logs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stock_logs_select" ON "public"."stock_logs" FOR SELECT TO "authenticated" USING (true);


--
-- Name: stock_lots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."stock_lots" ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_movements stock_movements_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stock_movements_select" ON "public"."stock_movements" FOR SELECT TO "authenticated" USING (true);


--
-- Name: stock_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."stock_receipts" ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_receipts stock_receipts_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stock_receipts_read" ON "public"."stock_receipts" FOR SELECT TO "authenticated" USING (true);


--
-- Name: stock_items stock_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stock_select" ON "public"."stock_items" FOR SELECT TO "authenticated" USING (true);


--
-- Name: stock_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."stock_snapshots" ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_snapshots stock_snapshots_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stock_snapshots_insert" ON "public"."stock_snapshots" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: stock_snapshots stock_snapshots_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stock_snapshots_select" ON "public"."stock_snapshots" FOR SELECT TO "authenticated" USING (true);


--
-- Name: stock_items stock_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "stock_update" ON "public"."stock_items" FOR UPDATE TO "authenticated" USING ("public"."is_encargado"());


--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers suppliers_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "suppliers_delete" ON "public"."suppliers" FOR DELETE TO "authenticated" USING ("public"."is_encargado"());


--
-- Name: suppliers suppliers_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "suppliers_insert" ON "public"."suppliers" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_encargado"());


--
-- Name: suppliers suppliers_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "suppliers_select" ON "public"."suppliers" FOR SELECT TO "authenticated" USING (true);


--
-- Name: suppliers suppliers_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "suppliers_update" ON "public"."suppliers" FOR UPDATE TO "authenticated" USING ("public"."is_encargado"());


--
-- Name: tolva_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."tolva_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: tolva_logs tolva_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tolva_read" ON "public"."tolva_logs" FOR SELECT TO "authenticated" USING (true);


--
-- Name: tolva_logs tolva_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tolva_update" ON "public"."tolva_logs" FOR UPDATE TO "authenticated" USING (true);


--
-- Name: tolva_logs tolva_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tolva_write" ON "public"."tolva_logs" FOR INSERT TO "authenticated" WITH CHECK (true);


--
-- Name: production_template_inputs tpl_inputs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tpl_inputs_read" ON "public"."production_template_inputs" FOR SELECT TO "authenticated" USING (true);


--
-- Name: vajilla_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."vajilla_snapshots" ENABLE ROW LEVEL SECURITY;

--
-- Name: vajilla_snapshots vajilla_snapshots_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vajilla_snapshots_insert" ON "public"."vajilla_snapshots" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: vajilla_snapshots vajilla_snapshots_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vajilla_snapshots_select" ON "public"."vajilla_snapshots" FOR SELECT TO "authenticated" USING (true);


--
-- Name: vajilla_stock; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."vajilla_stock" ENABLE ROW LEVEL SECURITY;

--
-- Name: vajilla_stock vajilla_stock_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vajilla_stock_delete" ON "public"."vajilla_stock" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: vajilla_stock vajilla_stock_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vajilla_stock_insert" ON "public"."vajilla_stock" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: vajilla_stock vajilla_stock_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vajilla_stock_select" ON "public"."vajilla_stock" FOR SELECT TO "authenticated" USING (true);


--
-- Name: vajilla_stock vajilla_stock_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vajilla_stock_update" ON "public"."vajilla_stock" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['socio'::"public"."app_role", 'encargado'::"public"."app_role"]))))));


--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


--
-- Name: FUNCTION "admin_announcements_summary"("p_from" "date", "p_to" "date"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."admin_announcements_summary"("p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_announcements_summary"("p_from" "date", "p_to" "date") TO "service_role";


--
-- Name: FUNCTION "admin_attendance_summary"("p_from" "date", "p_to" "date"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."admin_attendance_summary"("p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_attendance_summary"("p_from" "date", "p_to" "date") TO "service_role";


--
-- Name: FUNCTION "admin_dashboard_kpis"(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."admin_dashboard_kpis"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_dashboard_kpis"() TO "service_role";


--
-- Name: FUNCTION "admin_shifts_summary"("p_from" "date", "p_to" "date"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."admin_shifts_summary"("p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_shifts_summary"("p_from" "date", "p_to" "date") TO "service_role";


--
-- Name: FUNCTION "admin_stock_snapshot"(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."admin_stock_snapshot"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_stock_snapshot"() TO "service_role";


--
-- Name: FUNCTION "auth_role"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."auth_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_role"() TO "service_role";


--
-- Name: FUNCTION "check_attendance_anomalies"("p_log_id" "uuid", "p_event" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."check_attendance_anomalies"("p_log_id" "uuid", "p_event" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_attendance_anomalies"("p_log_id" "uuid", "p_event" "text") TO "service_role";


--
-- Name: FUNCTION "clock_in"("p_notes" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."clock_in"("p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clock_in"("p_notes" "text") TO "service_role";


--
-- Name: FUNCTION "clock_in"("p_notes" "text", "p_lat" numeric, "p_lng" numeric, "p_accuracy" numeric, "p_selfie_url" "text", "p_device_fingerprint" "text", "p_network_ip" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."clock_in"("p_notes" "text", "p_lat" numeric, "p_lng" numeric, "p_accuracy" numeric, "p_selfie_url" "text", "p_device_fingerprint" "text", "p_network_ip" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clock_in"("p_notes" "text", "p_lat" numeric, "p_lng" numeric, "p_accuracy" numeric, "p_selfie_url" "text", "p_device_fingerprint" "text", "p_network_ip" "text") TO "service_role";


--
-- Name: FUNCTION "clock_out"("p_notes" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."clock_out"("p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clock_out"("p_notes" "text") TO "service_role";


--
-- Name: FUNCTION "clock_out"("p_notes" "text", "p_lat" numeric, "p_lng" numeric, "p_accuracy" numeric, "p_selfie_url" "text", "p_device_fingerprint" "text", "p_network_ip" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."clock_out"("p_notes" "text", "p_lat" numeric, "p_lng" numeric, "p_accuracy" numeric, "p_selfie_url" "text", "p_device_fingerprint" "text", "p_network_ip" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clock_out"("p_notes" "text", "p_lat" numeric, "p_lng" numeric, "p_accuracy" numeric, "p_selfie_url" "text", "p_device_fingerprint" "text", "p_network_ip" "text") TO "service_role";


--
-- Name: FUNCTION "complete_production_order"("p_order_id" bigint, "p_user_id" "uuid"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."complete_production_order"("p_order_id" bigint, "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_production_order"("p_order_id" bigint, "p_user_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "deduct_stock_on_sale"("p_sale_id" bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."deduct_stock_on_sale"("p_sale_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."deduct_stock_on_sale"("p_sale_id" bigint) TO "service_role";


--
-- Name: FUNCTION "fn_audit_announcements"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."fn_audit_announcements"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_audit_announcements"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_audit_announcements"() TO "service_role";


--
-- Name: FUNCTION "fn_audit_attendance"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."fn_audit_attendance"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_audit_attendance"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_audit_attendance"() TO "service_role";


--
-- Name: FUNCTION "fn_audit_bar_stock"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."fn_audit_bar_stock"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_audit_bar_stock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_audit_bar_stock"() TO "service_role";


--
-- Name: FUNCTION "fn_audit_orders"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."fn_audit_orders"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_audit_orders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_audit_orders"() TO "service_role";


--
-- Name: FUNCTION "fn_audit_stock"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."fn_audit_stock"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_audit_stock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_audit_stock"() TO "service_role";


--
-- Name: FUNCTION "fn_audit_vajilla"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."fn_audit_vajilla"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_audit_vajilla"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_audit_vajilla"() TO "service_role";


--
-- Name: FUNCTION "fn_bar_stock_log"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."fn_bar_stock_log"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_bar_stock_log"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_bar_stock_log"() TO "service_role";


--
-- Name: FUNCTION "fn_stock_log"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."fn_stock_log"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_stock_log"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_stock_log"() TO "service_role";


--
-- Name: FUNCTION "generate_expediente_code"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."generate_expediente_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_expediente_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_expediente_code"() TO "service_role";


--
-- Name: TABLE "announcements"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."announcements" TO "anon";
GRANT ALL ON TABLE "public"."announcements" TO "authenticated";
GRANT ALL ON TABLE "public"."announcements" TO "service_role";


--
-- Name: FUNCTION "get_my_announcements"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."get_my_announcements"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_announcements"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_announcements"() TO "service_role";


--
-- Name: FUNCTION "get_my_role"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."get_my_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "service_role";


--
-- Name: FUNCTION "get_weekly_schedule"("p_start_date" "date"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."get_weekly_schedule"("p_start_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_weekly_schedule"("p_start_date" "date") TO "service_role";


--
-- Name: FUNCTION "guardar_receta_produccion"("p_output" "uuid", "p_rinde" numeric, "p_ingredientes" "jsonb", "p_notas" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."guardar_receta_produccion"("p_output" "uuid", "p_rinde" numeric, "p_ingredientes" "jsonb", "p_notas" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guardar_receta_produccion"("p_output" "uuid", "p_rinde" numeric, "p_ingredientes" "jsonb", "p_notas" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."guardar_receta_produccion"("p_output" "uuid", "p_rinde" numeric, "p_ingredientes" "jsonb", "p_notas" "text") TO "service_role";


--
-- Name: FUNCTION "handle_kitchen_logs_updated_at"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."handle_kitchen_logs_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_kitchen_logs_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_kitchen_logs_updated_at"() TO "service_role";


--
-- Name: FUNCTION "handle_menu_items_updated_at"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."handle_menu_items_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_menu_items_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_menu_items_updated_at"() TO "service_role";


--
-- Name: FUNCTION "handle_new_user"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";


--
-- Name: FUNCTION "is_encargado"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."is_encargado"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_encargado"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_encargado"() TO "service_role";


--
-- Name: FUNCTION "is_encargado_or_chef"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."is_encargado_or_chef"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_encargado_or_chef"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_encargado_or_chef"() TO "service_role";


--
-- Name: FUNCTION "menu_item_reconciliation"("p_from" timestamp with time zone, "p_to" timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."menu_item_reconciliation"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."menu_item_reconciliation"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";


--
-- Name: FUNCTION "produce_recipe"("p_recipe_id" bigint, "p_portions" numeric, "p_reference_id" "text"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."produce_recipe"("p_recipe_id" bigint, "p_portions" numeric, "p_reference_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."produce_recipe"("p_recipe_id" bigint, "p_portions" numeric, "p_reference_id" "text") TO "service_role";


--
-- Name: FUNCTION "production_dashboard"("p_days" integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."production_dashboard"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."production_dashboard"("p_days" integer) TO "service_role";


--
-- Name: FUNCTION "recalculate_semaphores"(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."recalculate_semaphores"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recalculate_semaphores"() TO "service_role";


--
-- Name: FUNCTION "recipes_at_risk"("p_min_portions" numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."recipes_at_risk"("p_min_portions" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recipes_at_risk"("p_min_portions" numeric) TO "service_role";


--
-- Name: FUNCTION "resolve_alert"("p_alert_id" "text"); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."resolve_alert"("p_alert_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_alert"("p_alert_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_alert"("p_alert_id" "text") TO "service_role";


--
-- Name: FUNCTION "resolve_alert"("p_alert_id" "uuid"); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."resolve_alert"("p_alert_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_alert"("p_alert_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_alert"("p_alert_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "set_supplier_links"("p_changes" "jsonb"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."set_supplier_links"("p_changes" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_supplier_links"("p_changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_supplier_links"("p_changes" "jsonb") TO "service_role";


--
-- Name: FUNCTION "set_updated_at"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


--
-- Name: FUNCTION "stock_reconciliation"("p_from" timestamp with time zone, "p_to" timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."stock_reconciliation"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stock_reconciliation"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";


--
-- Name: FUNCTION "stock_yield"(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."stock_yield"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stock_yield"() TO "service_role";


--
-- Name: FUNCTION "sync_item_supplier_to_links"(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."sync_item_supplier_to_links"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_item_supplier_to_links"() TO "service_role";


--
-- Name: FUNCTION "sync_primary_supplier_to_item"(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."sync_primary_supplier_to_item"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_primary_supplier_to_item"() TO "service_role";


--
-- Name: FUNCTION "trg_fudo_sales_deduct_stock"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."trg_fudo_sales_deduct_stock"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_fudo_sales_deduct_stock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_fudo_sales_deduct_stock"() TO "service_role";


--
-- Name: FUNCTION "unir_insumos"("p_duplicado" "uuid", "p_bueno" "uuid", "p_user" "uuid"); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."unir_insumos"("p_duplicado" "uuid", "p_bueno" "uuid", "p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unir_insumos"("p_duplicado" "uuid", "p_bueno" "uuid", "p_user" "uuid") TO "service_role";


--
-- Name: FUNCTION "update_stock_qty"("p_item_id" "text", "p_new_qty" numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."update_stock_qty"("p_item_id" "text", "p_new_qty" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_stock_qty"("p_item_id" "text", "p_new_qty" numeric) TO "service_role";


--
-- Name: FUNCTION "update_stock_qty"("p_item_id" "uuid", "p_new_qty" numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION "public"."update_stock_qty"("p_item_id" "uuid", "p_new_qty" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_stock_qty"("p_item_id" "uuid", "p_new_qty" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_stock_qty"("p_item_id" "uuid", "p_new_qty" numeric) TO "service_role";


--
-- Name: FUNCTION "update_updated_at"(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";


--
-- Name: TABLE "_backup_menu_items_20260728"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."_backup_menu_items_20260728" TO "anon";
GRANT ALL ON TABLE "public"."_backup_menu_items_20260728" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_menu_items_20260728" TO "service_role";


--
-- Name: TABLE "_backup_recipe_ingredients_20260728"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."_backup_recipe_ingredients_20260728" TO "anon";
GRANT ALL ON TABLE "public"."_backup_recipe_ingredients_20260728" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_recipe_ingredients_20260728" TO "service_role";


--
-- Name: TABLE "_backup_recipes_20260728"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."_backup_recipes_20260728" TO "anon";
GRANT ALL ON TABLE "public"."_backup_recipes_20260728" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_recipes_20260728" TO "service_role";


--
-- Name: TABLE "announcement_reads"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."announcement_reads" TO "anon";
GRANT ALL ON TABLE "public"."announcement_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."announcement_reads" TO "service_role";


--
-- Name: TABLE "app_settings"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";


--
-- Name: TABLE "attendance_config"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."attendance_config" TO "anon";
GRANT ALL ON TABLE "public"."attendance_config" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_config" TO "service_role";


--
-- Name: TABLE "attendance_logs"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."attendance_logs" TO "anon";
GRANT ALL ON TABLE "public"."attendance_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_logs" TO "service_role";


--
-- Name: TABLE "audit_log"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";


--
-- Name: SEQUENCE "audit_log_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "service_role";


--
-- Name: TABLE "audit_trail"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."audit_trail" TO "anon";
GRANT ALL ON TABLE "public"."audit_trail" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_trail" TO "service_role";


--
-- Name: SEQUENCE "audit_trail_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."audit_trail_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_trail_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_trail_id_seq" TO "service_role";


--
-- Name: TABLE "bar_orders"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."bar_orders" TO "anon";
GRANT ALL ON TABLE "public"."bar_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."bar_orders" TO "service_role";


--
-- Name: SEQUENCE "bar_orders_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."bar_orders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bar_orders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bar_orders_id_seq" TO "service_role";


--
-- Name: TABLE "bar_product_recipes"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."bar_product_recipes" TO "anon";
GRANT ALL ON TABLE "public"."bar_product_recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."bar_product_recipes" TO "service_role";


--
-- Name: SEQUENCE "bar_product_recipes_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."bar_product_recipes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bar_product_recipes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bar_product_recipes_id_seq" TO "service_role";


--
-- Name: TABLE "bar_shift_handover"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."bar_shift_handover" TO "anon";
GRANT ALL ON TABLE "public"."bar_shift_handover" TO "authenticated";
GRANT ALL ON TABLE "public"."bar_shift_handover" TO "service_role";


--
-- Name: SEQUENCE "bar_shift_handover_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."bar_shift_handover_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bar_shift_handover_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bar_shift_handover_id_seq" TO "service_role";


--
-- Name: TABLE "bar_stock_items"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."bar_stock_items" TO "anon";
GRANT ALL ON TABLE "public"."bar_stock_items" TO "authenticated";
GRANT ALL ON TABLE "public"."bar_stock_items" TO "service_role";


--
-- Name: SEQUENCE "bar_stock_items_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."bar_stock_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bar_stock_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bar_stock_items_id_seq" TO "service_role";


--
-- Name: TABLE "bar_stock_logs"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."bar_stock_logs" TO "anon";
GRANT ALL ON TABLE "public"."bar_stock_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."bar_stock_logs" TO "service_role";


--
-- Name: SEQUENCE "bar_stock_logs_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."bar_stock_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bar_stock_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bar_stock_logs_id_seq" TO "service_role";


--
-- Name: TABLE "checklist_items"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."checklist_items" TO "anon";
GRANT ALL ON TABLE "public"."checklist_items" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_items" TO "service_role";


--
-- Name: SEQUENCE "checklist_items_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."checklist_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."checklist_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."checklist_items_id_seq" TO "service_role";


--
-- Name: TABLE "checklist_templates"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."checklist_templates" TO "anon";
GRANT ALL ON TABLE "public"."checklist_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_templates" TO "service_role";


--
-- Name: SEQUENCE "checklist_templates_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."checklist_templates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."checklist_templates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."checklist_templates_id_seq" TO "service_role";


--
-- Name: TABLE "closing_hours"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."closing_hours" TO "anon";
GRANT ALL ON TABLE "public"."closing_hours" TO "authenticated";
GRANT ALL ON TABLE "public"."closing_hours" TO "service_role";


--
-- Name: SEQUENCE "closing_hours_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."closing_hours_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."closing_hours_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."closing_hours_id_seq" TO "service_role";


--
-- Name: TABLE "device_registry"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."device_registry" TO "anon";
GRANT ALL ON TABLE "public"."device_registry" TO "authenticated";
GRANT ALL ON TABLE "public"."device_registry" TO "service_role";


--
-- Name: SEQUENCE "device_registry_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."device_registry_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."device_registry_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."device_registry_id_seq" TO "service_role";


--
-- Name: TABLE "expediente_comments"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."expediente_comments" TO "anon";
GRANT ALL ON TABLE "public"."expediente_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."expediente_comments" TO "service_role";


--
-- Name: TABLE "expediente_tasks"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."expediente_tasks" TO "anon";
GRANT ALL ON TABLE "public"."expediente_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."expediente_tasks" TO "service_role";


--
-- Name: TABLE "expedientes"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."expedientes" TO "anon";
GRANT ALL ON TABLE "public"."expedientes" TO "authenticated";
GRANT ALL ON TABLE "public"."expedientes" TO "service_role";


--
-- Name: TABLE "fudo_sale_subitems"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."fudo_sale_subitems" TO "anon";
GRANT ALL ON TABLE "public"."fudo_sale_subitems" TO "authenticated";
GRANT ALL ON TABLE "public"."fudo_sale_subitems" TO "service_role";


--
-- Name: TABLE "fudo_sales"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."fudo_sales" TO "anon";
GRANT ALL ON TABLE "public"."fudo_sales" TO "authenticated";
GRANT ALL ON TABLE "public"."fudo_sales" TO "service_role";


--
-- Name: TABLE "fudo_consumo"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."fudo_consumo" TO "authenticated";
GRANT ALL ON TABLE "public"."fudo_consumo" TO "service_role";


--
-- Name: TABLE "fudo_reintentos"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."fudo_reintentos" TO "anon";
GRANT ALL ON TABLE "public"."fudo_reintentos" TO "authenticated";
GRANT ALL ON TABLE "public"."fudo_reintentos" TO "service_role";


--
-- Name: SEQUENCE "fudo_sales_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."fudo_sales_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."fudo_sales_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."fudo_sales_id_seq" TO "service_role";


--
-- Name: TABLE "fudo_salud"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."fudo_salud" TO "anon";
GRANT ALL ON TABLE "public"."fudo_salud" TO "authenticated";
GRANT ALL ON TABLE "public"."fudo_salud" TO "service_role";


--
-- Name: TABLE "fudo_sync_events"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."fudo_sync_events" TO "anon";
GRANT ALL ON TABLE "public"."fudo_sync_events" TO "authenticated";
GRANT ALL ON TABLE "public"."fudo_sync_events" TO "service_role";


--
-- Name: TABLE "fudo_sync_incidents"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."fudo_sync_incidents" TO "anon";
GRANT ALL ON TABLE "public"."fudo_sync_incidents" TO "authenticated";
GRANT ALL ON TABLE "public"."fudo_sync_incidents" TO "service_role";


--
-- Name: TABLE "kitchen_daily_logs"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."kitchen_daily_logs" TO "anon";
GRANT ALL ON TABLE "public"."kitchen_daily_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."kitchen_daily_logs" TO "service_role";


--
-- Name: TABLE "kitchen_orders"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."kitchen_orders" TO "anon";
GRANT ALL ON TABLE "public"."kitchen_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."kitchen_orders" TO "service_role";


--
-- Name: SEQUENCE "kitchen_orders_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."kitchen_orders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kitchen_orders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kitchen_orders_id_seq" TO "service_role";


--
-- Name: TABLE "kitchen_shift_handover"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."kitchen_shift_handover" TO "anon";
GRANT ALL ON TABLE "public"."kitchen_shift_handover" TO "authenticated";
GRANT ALL ON TABLE "public"."kitchen_shift_handover" TO "service_role";


--
-- Name: SEQUENCE "kitchen_shift_handover_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."kitchen_shift_handover_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kitchen_shift_handover_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kitchen_shift_handover_id_seq" TO "service_role";


--
-- Name: TABLE "kitchen_shifts"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."kitchen_shifts" TO "anon";
GRANT ALL ON TABLE "public"."kitchen_shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."kitchen_shifts" TO "service_role";


--
-- Name: SEQUENCE "kitchen_shifts_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."kitchen_shifts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kitchen_shifts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kitchen_shifts_id_seq" TO "service_role";


--
-- Name: TABLE "menu_categories"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."menu_categories" TO "anon";
GRANT ALL ON TABLE "public"."menu_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_categories" TO "service_role";


--
-- Name: SEQUENCE "menu_categories_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."menu_categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."menu_categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."menu_categories_id_seq" TO "service_role";


--
-- Name: TABLE "menu_items"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."menu_items" TO "anon";
GRANT ALL ON TABLE "public"."menu_items" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_items" TO "service_role";


--
-- Name: TABLE "mise_en_place_items"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."mise_en_place_items" TO "anon";
GRANT ALL ON TABLE "public"."mise_en_place_items" TO "authenticated";
GRANT ALL ON TABLE "public"."mise_en_place_items" TO "service_role";


--
-- Name: SEQUENCE "mise_en_place_items_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."mise_en_place_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."mise_en_place_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."mise_en_place_items_id_seq" TO "service_role";


--
-- Name: TABLE "mise_en_place_records"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."mise_en_place_records" TO "anon";
GRANT ALL ON TABLE "public"."mise_en_place_records" TO "authenticated";
GRANT ALL ON TABLE "public"."mise_en_place_records" TO "service_role";


--
-- Name: SEQUENCE "mise_en_place_records_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."mise_en_place_records_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."mise_en_place_records_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."mise_en_place_records_id_seq" TO "service_role";


--
-- Name: TABLE "payroll_rates"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."payroll_rates" TO "anon";
GRANT ALL ON TABLE "public"."payroll_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_rates" TO "service_role";


--
-- Name: SEQUENCE "payroll_rates_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."payroll_rates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."payroll_rates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."payroll_rates_id_seq" TO "service_role";


--
-- Name: TABLE "production_inputs"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."production_inputs" TO "anon";
GRANT ALL ON TABLE "public"."production_inputs" TO "authenticated";
GRANT ALL ON TABLE "public"."production_inputs" TO "service_role";


--
-- Name: SEQUENCE "production_inputs_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."production_inputs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."production_inputs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."production_inputs_id_seq" TO "service_role";


--
-- Name: TABLE "production_orders"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."production_orders" TO "anon";
GRANT ALL ON TABLE "public"."production_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."production_orders" TO "service_role";


--
-- Name: SEQUENCE "production_orders_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."production_orders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."production_orders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."production_orders_id_seq" TO "service_role";


--
-- Name: TABLE "production_outputs"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."production_outputs" TO "anon";
GRANT ALL ON TABLE "public"."production_outputs" TO "authenticated";
GRANT ALL ON TABLE "public"."production_outputs" TO "service_role";


--
-- Name: SEQUENCE "production_outputs_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."production_outputs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."production_outputs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."production_outputs_id_seq" TO "service_role";


--
-- Name: TABLE "production_template_inputs"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."production_template_inputs" TO "anon";
GRANT ALL ON TABLE "public"."production_template_inputs" TO "authenticated";
GRANT ALL ON TABLE "public"."production_template_inputs" TO "service_role";


--
-- Name: SEQUENCE "production_template_inputs_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."production_template_inputs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."production_template_inputs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."production_template_inputs_id_seq" TO "service_role";


--
-- Name: TABLE "production_template_outputs"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."production_template_outputs" TO "anon";
GRANT ALL ON TABLE "public"."production_template_outputs" TO "authenticated";
GRANT ALL ON TABLE "public"."production_template_outputs" TO "service_role";


--
-- Name: SEQUENCE "production_template_outputs_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."production_template_outputs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."production_template_outputs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."production_template_outputs_id_seq" TO "service_role";


--
-- Name: TABLE "production_templates"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."production_templates" TO "anon";
GRANT ALL ON TABLE "public"."production_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."production_templates" TO "service_role";


--
-- Name: SEQUENCE "production_templates_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."production_templates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."production_templates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."production_templates_id_seq" TO "service_role";


--
-- Name: TABLE "profiles"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";


--
-- Name: TABLE "protocolo_tareas"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."protocolo_tareas" TO "anon";
GRANT ALL ON TABLE "public"."protocolo_tareas" TO "authenticated";
GRANT ALL ON TABLE "public"."protocolo_tareas" TO "service_role";


--
-- Name: TABLE "protocolos"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."protocolos" TO "anon";
GRANT ALL ON TABLE "public"."protocolos" TO "authenticated";
GRANT ALL ON TABLE "public"."protocolos" TO "service_role";


--
-- Name: TABLE "push_subscriptions"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";


--
-- Name: SEQUENCE "push_subscriptions_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."push_subscriptions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."push_subscriptions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."push_subscriptions_id_seq" TO "service_role";


--
-- Name: TABLE "recipe_ingredient_pending_links"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."recipe_ingredient_pending_links" TO "anon";
GRANT ALL ON TABLE "public"."recipe_ingredient_pending_links" TO "authenticated";
GRANT ALL ON TABLE "public"."recipe_ingredient_pending_links" TO "service_role";


--
-- Name: SEQUENCE "recipe_ingredient_pending_links_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."recipe_ingredient_pending_links_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."recipe_ingredient_pending_links_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."recipe_ingredient_pending_links_id_seq" TO "service_role";


--
-- Name: TABLE "recipe_ingredients"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."recipe_ingredients" TO "anon";
GRANT ALL ON TABLE "public"."recipe_ingredients" TO "authenticated";
GRANT ALL ON TABLE "public"."recipe_ingredients" TO "service_role";


--
-- Name: SEQUENCE "recipe_ingredients_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."recipe_ingredients_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."recipe_ingredients_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."recipe_ingredients_id_seq" TO "service_role";


--
-- Name: TABLE "recipes"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."recipes" TO "anon";
GRANT ALL ON TABLE "public"."recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."recipes" TO "service_role";


--
-- Name: TABLE "sales_engine_daily"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."sales_engine_daily" TO "anon";
GRANT ALL ON TABLE "public"."sales_engine_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_engine_daily" TO "service_role";


--
-- Name: TABLE "sales_engine_state"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."sales_engine_state" TO "anon";
GRANT ALL ON TABLE "public"."sales_engine_state" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_engine_state" TO "service_role";


--
-- Name: TABLE "salon_item_status"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."salon_item_status" TO "anon";
GRANT ALL ON TABLE "public"."salon_item_status" TO "authenticated";
GRANT ALL ON TABLE "public"."salon_item_status" TO "service_role";


--
-- Name: SEQUENCE "salon_item_status_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."salon_item_status_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."salon_item_status_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."salon_item_status_id_seq" TO "service_role";


--
-- Name: TABLE "shifts"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."shifts" TO "anon";
GRANT ALL ON TABLE "public"."shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."shifts" TO "service_role";


--
-- Name: TABLE "stock_alerts"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."stock_alerts" TO "anon";
GRANT ALL ON TABLE "public"."stock_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_alerts" TO "service_role";


--
-- Name: TABLE "stock_anomaly_decisions"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."stock_anomaly_decisions" TO "anon";
GRANT ALL ON TABLE "public"."stock_anomaly_decisions" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_anomaly_decisions" TO "service_role";


--
-- Name: TABLE "stock_anomaly_rules"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."stock_anomaly_rules" TO "anon";
GRANT ALL ON TABLE "public"."stock_anomaly_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_anomaly_rules" TO "service_role";


--
-- Name: TABLE "stock_count_aliases"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."stock_count_aliases" TO "anon";
GRANT ALL ON TABLE "public"."stock_count_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_count_aliases" TO "service_role";


--
-- Name: TABLE "stock_item_suppliers"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."stock_item_suppliers" TO "anon";
GRANT ALL ON TABLE "public"."stock_item_suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_item_suppliers" TO "service_role";


--
-- Name: TABLE "stock_items"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."stock_items" TO "anon";
GRANT ALL ON TABLE "public"."stock_items" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_items" TO "service_role";


--
-- Name: TABLE "stock_logs"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."stock_logs" TO "anon";
GRANT ALL ON TABLE "public"."stock_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_logs" TO "service_role";


--
-- Name: SEQUENCE "stock_logs_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."stock_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stock_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stock_logs_id_seq" TO "service_role";


--
-- Name: TABLE "stock_lots"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."stock_lots" TO "anon";
GRANT ALL ON TABLE "public"."stock_lots" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_lots" TO "service_role";


--
-- Name: SEQUENCE "stock_lots_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."stock_lots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stock_lots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stock_lots_id_seq" TO "service_role";


--
-- Name: TABLE "stock_movements"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."stock_movements" TO "anon";
GRANT ALL ON TABLE "public"."stock_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_movements" TO "service_role";


--
-- Name: TABLE "stock_receipts"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."stock_receipts" TO "anon";
GRANT ALL ON TABLE "public"."stock_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_receipts" TO "service_role";


--
-- Name: SEQUENCE "stock_receipts_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."stock_receipts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stock_receipts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stock_receipts_id_seq" TO "service_role";


--
-- Name: TABLE "stock_snapshots"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."stock_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."stock_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_snapshots" TO "service_role";


--
-- Name: SEQUENCE "stock_snapshots_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."stock_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."stock_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."stock_snapshots_id_seq" TO "service_role";


--
-- Name: TABLE "suppliers"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."suppliers" TO "anon";
GRANT ALL ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";


--
-- Name: TABLE "tolva_logs"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."tolva_logs" TO "anon";
GRANT ALL ON TABLE "public"."tolva_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."tolva_logs" TO "service_role";


--
-- Name: SEQUENCE "tolva_logs_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."tolva_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tolva_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tolva_logs_id_seq" TO "service_role";


--
-- Name: TABLE "v_active_alerts"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."v_active_alerts" TO "anon";
GRANT ALL ON TABLE "public"."v_active_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."v_active_alerts" TO "service_role";


--
-- Name: TABLE "v_today_attendance"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."v_today_attendance" TO "anon";
GRANT ALL ON TABLE "public"."v_today_attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."v_today_attendance" TO "service_role";


--
-- Name: TABLE "vajilla_snapshots"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."vajilla_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."vajilla_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."vajilla_snapshots" TO "service_role";


--
-- Name: SEQUENCE "vajilla_snapshots_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."vajilla_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vajilla_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vajilla_snapshots_id_seq" TO "service_role";


--
-- Name: TABLE "vajilla_stock"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE "public"."vajilla_stock" TO "anon";
GRANT ALL ON TABLE "public"."vajilla_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."vajilla_stock" TO "service_role";


--
-- Name: SEQUENCE "vajilla_stock_id_seq"; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE "public"."vajilla_stock_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vajilla_stock_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vajilla_stock_id_seq" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--

\unrestrict d9DcbyRbge0dhXeulAn0gnBFnVqu6EspmrBXLRDpQxBlrdCtiHBLTjEorcydlXL

