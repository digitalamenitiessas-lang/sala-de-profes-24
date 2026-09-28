-- ============================================================
-- Sistema de Control de Producción y Despiece
-- Fecha: 2026-04-04
-- ============================================================
-- Tablas:
--   production_templates        — procesos estándar con rendimientos teóricos
--   production_template_outputs — salidas esperadas por template
--   production_orders           — órdenes reales de producción (con soporte cascada)
--   production_inputs           — insumos que entran a cada orden
--   production_outputs          — productos que salen (incl. merma)
--
-- RPC:
--   complete_production_order   — aplica movimientos de stock y cierra la orden
--   production_dashboard        — métricas agregadas de rendimiento
-- ============================================================

-- ============================================================
-- 1) Templates: procesos estándar de producción
-- ============================================================

CREATE TABLE IF NOT EXISTS production_templates (
  id                  bigserial    PRIMARY KEY,
  name                text         NOT NULL,
  description         text,
  input_stock_item_id bigint       REFERENCES stock_items(id) ON DELETE SET NULL,
  input_unit          text         NOT NULL DEFAULT 'kg',
  is_active           boolean      NOT NULL DEFAULT true,
  created_by          uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE production_templates IS 'Procesos estándar de producción con rendimientos teóricos';

CREATE TABLE IF NOT EXISTS production_template_outputs (
  id                     bigserial PRIMARY KEY,
  template_id            bigint    NOT NULL REFERENCES production_templates(id) ON DELETE CASCADE,
  stock_item_id          bigint    REFERENCES stock_items(id) ON DELETE SET NULL,
  output_name            text      NOT NULL,
  theoretical_yield_pct  numeric   NOT NULL
    CHECK (theoretical_yield_pct >= 0 AND theoretical_yield_pct <= 100),
  output_unit            text      NOT NULL,
  is_waste               boolean   NOT NULL DEFAULT false,
  sort_order             int       NOT NULL DEFAULT 0,
  notes                  text
);

COMMENT ON TABLE production_template_outputs IS 'Rendimientos teóricos por template';

-- ============================================================
-- 2) Production orders: eventos reales de transformación
-- ============================================================

CREATE TABLE IF NOT EXISTS production_orders (
  id              bigserial   PRIMARY KEY,
  name            text        NOT NULL,
  parent_order_id bigint      REFERENCES production_orders(id) ON DELETE SET NULL,
  template_id     bigint      REFERENCES production_templates(id) ON DELETE SET NULL,
  status          text        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  chef_id         uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  notes           text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE production_orders IS 'Órdenes de producción / despiece (soporta cascada vía parent_order_id)';
COMMENT ON COLUMN production_orders.parent_order_id IS 'Si no es null, esta orden es sub-producción de una mayor';

-- ============================================================
-- 3) Production inputs: lo que entra
-- ============================================================

CREATE TABLE IF NOT EXISTS production_inputs (
  id                  bigserial   PRIMARY KEY,
  production_order_id bigint      NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  stock_item_id       bigint      NOT NULL REFERENCES stock_items(id),
  qty_used            numeric     NOT NULL CHECK (qty_used > 0),
  unit                text        NOT NULL,
  cost_per_unit       numeric,
  stock_movement_id   bigint      REFERENCES stock_movements(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE production_inputs IS 'Insumos consumidos por una orden de producción';

-- ============================================================
-- 4) Production outputs: lo que sale
-- ============================================================

CREATE TABLE IF NOT EXISTS production_outputs (
  id                  bigserial   PRIMARY KEY,
  production_order_id bigint      NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  stock_item_id       bigint      REFERENCES stock_items(id) ON DELETE SET NULL,
  output_name         text        NOT NULL,
  qty_produced        numeric     NOT NULL CHECK (qty_produced >= 0),
  theoretical_qty     numeric,
  unit                text        NOT NULL,
  is_waste            boolean     NOT NULL DEFAULT false,
  notes               text,
  stock_movement_id   bigint      REFERENCES stock_movements(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE production_outputs IS 'Productos obtenidos de una orden de producción (incl. merma)';

-- ============================================================
-- 5) Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_prod_orders_chef
  ON production_orders(chef_id);
CREATE INDEX IF NOT EXISTS idx_prod_orders_parent
  ON production_orders(parent_order_id);
CREATE INDEX IF NOT EXISTS idx_prod_orders_status
  ON production_orders(status);
CREATE INDEX IF NOT EXISTS idx_prod_orders_created
  ON production_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prod_orders_template
  ON production_orders(template_id);
CREATE INDEX IF NOT EXISTS idx_prod_inputs_order
  ON production_inputs(production_order_id);
CREATE INDEX IF NOT EXISTS idx_prod_outputs_order
  ON production_outputs(production_order_id);
CREATE INDEX IF NOT EXISTS idx_prod_tmpl_outputs_tmpl
  ON production_template_outputs(template_id);

-- ============================================================
-- 6) Updated_at triggers
-- ============================================================

CREATE OR REPLACE FUNCTION _trg_set_updated_at_production_orders()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_production_orders_updated_at ON production_orders;
CREATE TRIGGER trg_production_orders_updated_at
  BEFORE UPDATE ON production_orders
  FOR EACH ROW EXECUTE FUNCTION _trg_set_updated_at_production_orders();

CREATE OR REPLACE FUNCTION _trg_set_updated_at_production_templates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_production_templates_updated_at ON production_templates;
CREATE TRIGGER trg_production_templates_updated_at
  BEFORE UPDATE ON production_templates
  FOR EACH ROW EXECUTE FUNCTION _trg_set_updated_at_production_templates();

-- ============================================================
-- 7) RLS
-- ============================================================

ALTER TABLE production_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_template_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_inputs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_outputs          ENABLE ROW LEVEL SECURITY;

-- Templates: lectura amplia, escritura solo gestión
DROP POLICY IF EXISTS "prod_templates_read"  ON production_templates;
DROP POLICY IF EXISTS "prod_templates_write" ON production_templates;
CREATE POLICY "prod_templates_read" ON production_templates
  FOR SELECT USING (auth_role() IN ('socio','encargado','chef','cocina'));
CREATE POLICY "prod_templates_write" ON production_templates
  FOR ALL USING (auth_role() IN ('socio','encargado','chef'));

DROP POLICY IF EXISTS "prod_tmpl_outputs_read"  ON production_template_outputs;
DROP POLICY IF EXISTS "prod_tmpl_outputs_write" ON production_template_outputs;
CREATE POLICY "prod_tmpl_outputs_read" ON production_template_outputs
  FOR SELECT USING (auth_role() IN ('socio','encargado','chef','cocina'));
CREATE POLICY "prod_tmpl_outputs_write" ON production_template_outputs
  FOR ALL USING (auth_role() IN ('socio','encargado','chef'));

-- Orders: chefs/cocina escriben los suyos, gestión ve todo
DROP POLICY IF EXISTS "prod_orders_read"  ON production_orders;
DROP POLICY IF EXISTS "prod_orders_write" ON production_orders;
CREATE POLICY "prod_orders_read" ON production_orders
  FOR SELECT USING (auth_role() IN ('socio','encargado','chef','cocina'));
CREATE POLICY "prod_orders_write" ON production_orders
  FOR ALL USING (auth_role() IN ('socio','encargado','chef','cocina'));

DROP POLICY IF EXISTS "prod_inputs_read"  ON production_inputs;
DROP POLICY IF EXISTS "prod_inputs_write" ON production_inputs;
CREATE POLICY "prod_inputs_read" ON production_inputs
  FOR SELECT USING (auth_role() IN ('socio','encargado','chef','cocina'));
CREATE POLICY "prod_inputs_write" ON production_inputs
  FOR ALL USING (auth_role() IN ('socio','encargado','chef','cocina'));

DROP POLICY IF EXISTS "prod_outputs_read"  ON production_outputs;
DROP POLICY IF EXISTS "prod_outputs_write" ON production_outputs;
CREATE POLICY "prod_outputs_read" ON production_outputs
  FOR SELECT USING (auth_role() IN ('socio','encargado','chef','cocina'));
CREATE POLICY "prod_outputs_write" ON production_outputs
  FOR ALL USING (auth_role() IN ('socio','encargado','chef','cocina'));

-- ============================================================
-- 8) RPC: complete_production_order
-- ============================================================
-- Aplica los movimientos de stock y cierra la orden.
-- Solo funciona en órdenes status='draft' o 'in_progress'.
-- Retorna un jsonb con el resumen (eficiencia, merma, movimientos).
-- ============================================================

CREATE OR REPLACE FUNCTION complete_production_order(
  p_order_id bigint,
  p_user_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order       production_orders%ROWTYPE;
  v_input       production_inputs%ROWTYPE;
  v_output      production_outputs%ROWTYPE;
  v_movement_id bigint;
  v_total_input numeric := 0;
  v_total_output_net numeric := 0;
  v_total_waste  numeric := 0;
  v_efficiency   numeric := 0;
  v_movements    jsonb   := '[]'::jsonb;
  v_input_count  int;
  v_output_count int;
BEGIN
  -- Lock and fetch order
  SELECT * INTO v_order
  FROM production_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Orden no encontrada');
  END IF;

  IF v_order.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden ya fue completada');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden fue cancelada');
  END IF;

  -- Validate inputs exist
  SELECT COUNT(*) INTO v_input_count
  FROM production_inputs
  WHERE production_order_id = p_order_id;

  IF v_input_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden no tiene insumos registrados');
  END IF;

  -- Validate outputs exist
  SELECT COUNT(*) INTO v_output_count
  FROM production_outputs
  WHERE production_order_id = p_order_id;

  IF v_output_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden no tiene productos registrados');
  END IF;

  -- Check sufficient stock for all inputs
  FOR v_input IN
    SELECT pi.*, si.current_qty, si.name AS item_name
    FROM production_inputs pi
    JOIN stock_items si ON si.id = pi.stock_item_id
    WHERE pi.production_order_id = p_order_id
  LOOP
    IF v_input.current_qty < v_input.qty_used THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', format('Stock insuficiente de "%s": disponible %.3f, requerido %.3f',
          v_input.item_name, v_input.current_qty, v_input.qty_used)
      );
    END IF;
  END LOOP;

  -- Process inputs: deduct from stock
  FOR v_input IN
    SELECT * FROM production_inputs WHERE production_order_id = p_order_id
  LOOP
    UPDATE stock_items
    SET current_qty = current_qty - v_input.qty_used,
        updated_at  = now()
    WHERE id = v_input.stock_item_id;

    INSERT INTO stock_movements
      (stock_item_id, change, reason, reference_type, reference_id, created_by)
    VALUES
      (v_input.stock_item_id, -v_input.qty_used,
       'produccion_input', 'production_order', p_order_id::text, p_user_id)
    RETURNING id INTO v_movement_id;

    UPDATE production_inputs
    SET stock_movement_id = v_movement_id
    WHERE id = v_input.id;

    v_total_input := v_total_input + v_input.qty_used;
    v_movements := v_movements || jsonb_build_object(
      'type', 'input',
      'stock_item_id', v_input.stock_item_id,
      'change', -v_input.qty_used,
      'movement_id', v_movement_id
    );
  END LOOP;

  -- Process outputs: add to stock (skip waste with no stock_item)
  FOR v_output IN
    SELECT * FROM production_outputs WHERE production_order_id = p_order_id
  LOOP
    IF v_output.is_waste THEN
      v_total_waste := v_total_waste + v_output.qty_produced;
      CONTINUE;
    END IF;

    IF v_output.stock_item_id IS NULL THEN
      -- Unlinked output — still counts for balance but no stock movement
      v_total_output_net := v_total_output_net + v_output.qty_produced;
      CONTINUE;
    END IF;

    UPDATE stock_items
    SET current_qty = current_qty + v_output.qty_produced,
        updated_at  = now()
    WHERE id = v_output.stock_item_id;

    INSERT INTO stock_movements
      (stock_item_id, change, reason, reference_type, reference_id, created_by)
    VALUES
      (v_output.stock_item_id, v_output.qty_produced,
       'produccion_output', 'production_order', p_order_id::text, p_user_id)
    RETURNING id INTO v_movement_id;

    UPDATE production_outputs
    SET stock_movement_id = v_movement_id
    WHERE id = v_output.id;

    v_total_output_net := v_total_output_net + v_output.qty_produced;
    v_movements := v_movements || jsonb_build_object(
      'type', 'output',
      'stock_item_id', v_output.stock_item_id,
      'change', v_output.qty_produced,
      'movement_id', v_movement_id
    );
  END LOOP;

  -- Efficiency = (input - waste) / input * 100
  IF v_total_input > 0 THEN
    v_efficiency := round(
      ((v_total_input - v_total_waste) / v_total_input) * 100,
      1
    );
  END IF;

  -- Close the order
  UPDATE production_orders SET
    status       = 'completed',
    completed_at = now(),
    started_at   = COALESCE(started_at, now()),
    updated_at   = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success',          true,
    'order_id',         p_order_id,
    'total_input_qty',  v_total_input,
    'total_output_qty', v_total_output_net,
    'waste_qty',        v_total_waste,
    'efficiency_pct',   v_efficiency,
    'movements',        v_movements
  );
END;
$$;

GRANT EXECUTE ON FUNCTION complete_production_order TO authenticated;

-- ============================================================
-- 9) Vista de resumen de producciones
-- ============================================================

CREATE OR REPLACE VIEW v_production_summary AS
SELECT
  po.id,
  po.name,
  po.status,
  po.parent_order_id,
  po.template_id,
  po.chef_id,
  po.notes,
  po.started_at,
  po.completed_at,
  po.created_at,
  po.updated_at,
  -- Chef name
  (p.first_name || ' ' || p.last_name)                AS chef_name,
  p.role                                               AS chef_role,
  -- Template name
  pt.name                                              AS template_name,
  -- Input totals (all inputs to this order, in their native units)
  COALESCE((
    SELECT SUM(qty_used)
    FROM production_inputs
    WHERE production_order_id = po.id
  ), 0)                                                AS total_input_qty,
  -- Output totals (non-waste)
  COALESCE((
    SELECT SUM(qty_produced)
    FROM production_outputs
    WHERE production_order_id = po.id AND NOT is_waste
  ), 0)                                                AS total_output_qty,
  -- Waste
  COALESCE((
    SELECT SUM(qty_produced)
    FROM production_outputs
    WHERE production_order_id = po.id AND is_waste
  ), 0)                                                AS total_waste_qty,
  -- Efficiency %
  CASE
    WHEN COALESCE((
      SELECT SUM(qty_used) FROM production_inputs WHERE production_order_id = po.id
    ), 0) > 0
    THEN round(
      (1 - COALESCE((
        SELECT SUM(qty_produced)
        FROM production_outputs
        WHERE production_order_id = po.id AND is_waste
      ), 0)
      / (SELECT SUM(qty_used) FROM production_inputs WHERE production_order_id = po.id)
      ) * 100,
      1
    )
    ELSE NULL
  END                                                  AS efficiency_pct,
  -- Child orders
  (SELECT COUNT(*) FROM production_orders WHERE parent_order_id = po.id)
                                                       AS child_orders_count
FROM production_orders po
LEFT JOIN profiles p  ON p.id  = po.chef_id
LEFT JOIN production_templates pt ON pt.id = po.template_id;

-- ============================================================
-- 10) RPC: production_dashboard
-- ============================================================
-- Retorna métricas agregadas para el dashboard de control.
-- Parámetros opcionales: p_days (rango en días, default 30)
-- ============================================================

CREATE OR REPLACE FUNCTION production_dashboard(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_since   timestamptz := now() - (p_days || ' days')::interval;
  v_result  jsonb;
BEGIN
  WITH completed AS (
    SELECT po.*,
      COALESCE((SELECT SUM(qty_used) FROM production_inputs WHERE production_order_id = po.id), 0)   AS input_qty,
      COALESCE((SELECT SUM(qty_produced) FROM production_outputs WHERE production_order_id = po.id AND is_waste), 0) AS waste_qty
    FROM production_orders po
    WHERE po.status = 'completed'
      AND po.completed_at >= v_since
  ),
  chef_stats AS (
    SELECT
      c.chef_id,
      (p.first_name || ' ' || p.last_name) AS chef_name,
      COUNT(*)                               AS total_orders,
      ROUND(AVG(CASE WHEN c.input_qty > 0 THEN (1 - c.waste_qty / c.input_qty) * 100 ELSE NULL END)::numeric, 1) AS avg_efficiency,
      ROUND(SUM(c.waste_qty)::numeric, 3)   AS total_waste
    FROM completed c
    LEFT JOIN profiles p ON p.id = c.chef_id
    GROUP BY c.chef_id, p.first_name, p.last_name
    ORDER BY avg_efficiency DESC NULLS LAST
  ),
  daily AS (
    SELECT
      date_trunc('day', completed_at)::date AS day,
      COUNT(*)                               AS orders,
      ROUND(AVG(CASE WHEN input_qty > 0 THEN (1 - waste_qty / input_qty) * 100 ELSE NULL END)::numeric, 1) AS avg_efficiency
    FROM completed
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 14
  )
  SELECT jsonb_build_object(
    'period_days',       p_days,
    'total_completed',   (SELECT COUNT(*) FROM completed),
    'total_input_kg',    (SELECT ROUND(SUM(input_qty)::numeric, 2) FROM completed),
    'total_waste_kg',    (SELECT ROUND(SUM(waste_qty)::numeric, 3) FROM completed),
    'avg_efficiency_pct',(SELECT ROUND(AVG(CASE WHEN input_qty > 0 THEN (1 - waste_qty / input_qty) * 100 ELSE NULL END)::numeric, 1) FROM completed),
    'pending_orders',    (SELECT COUNT(*) FROM production_orders WHERE status IN ('draft','in_progress')),
    'by_chef',           (SELECT COALESCE(jsonb_agg(row_to_json(cs)), '[]') FROM chef_stats cs),
    'daily',             (SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]') FROM daily d)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION production_dashboard TO authenticated;
