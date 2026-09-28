-- ============================================================
-- Add missing columns to production tables + complete_production_order RPC
-- ============================================================

-- Missing columns
ALTER TABLE public.production_inputs
  ADD COLUMN IF NOT EXISTS cost_per_unit numeric,
  ADD COLUMN IF NOT EXISTS stock_movement_id bigint;

ALTER TABLE public.production_outputs
  ADD COLUMN IF NOT EXISTS stock_movement_id bigint;

-- ============================================================
-- RPC: complete_production_order
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
  v_input       RECORD;
  v_output      RECORD;
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

  -- Process outputs: add to stock (skip waste)
  FOR v_output IN
    SELECT * FROM production_outputs WHERE production_order_id = p_order_id
  LOOP
    IF v_output.is_waste THEN
      v_total_waste := v_total_waste + v_output.qty_produced;
      CONTINUE;
    END IF;

    IF v_output.stock_item_id IS NULL THEN
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
