-- ============================================================================
-- MIGRACIÓN: RPCs para módulo Admin / Centro de Control
-- Fecha: 2026-03-18
-- ============================================================================

-- ============================================================================
-- 1) admin_dashboard_kpis — KPIs del día para Centro de Control
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_dashboard_kpis()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
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

COMMENT ON FUNCTION admin_dashboard_kpis IS 'KPIs del día para el Centro de Control admin';

-- ============================================================================
-- 2) admin_attendance_summary — Resumen de asistencia por rango de fechas
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_attendance_summary(
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
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

-- ============================================================================
-- 3) admin_shifts_summary — Resumen de turnos por rango de fechas
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_shifts_summary(
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
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

-- ============================================================================
-- 4) admin_stock_snapshot — Estado actual del stock
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_stock_snapshot()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
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

-- ============================================================================
-- 5) admin_announcements_summary — Resumen de notificaciones
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_announcements_summary(
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
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

-- ============================================================================
-- FIN
-- ============================================================================
