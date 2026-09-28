-- Fix: complete_production_order usaba columnas inexistentes en stock_movements.
-- Schema real: qty, movement_type ('entrada'/'uso'), previous_qty, new_qty.
-- También: stock_movements.id es uuid pero production_inputs.stock_movement_id
-- es bigint (tipos incompatibles), así que omitimos esa linkage.

CREATE OR REPLACE FUNCTION complete_production_order(
  p_order_id bigint,
  p_user_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order            production_orders%ROWTYPE;
  v_input            RECORD;
  v_output           RECORD;
  v_prev_qty         numeric;
  v_new_qty          numeric;
  v_total_input      numeric := 0;
  v_total_output_net numeric := 0;
  v_total_waste      numeric := 0;
  v_efficiency       numeric := 0;
  v_movements        jsonb   := '[]'::jsonb;
  v_input_count      int;
  v_output_count     int;
BEGIN
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

  SELECT COUNT(*) INTO v_input_count
  FROM production_inputs
  WHERE production_order_id = p_order_id;

  IF v_input_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden no tiene insumos registrados');
  END IF;

  SELECT COUNT(*) INTO v_output_count
  FROM production_outputs
  WHERE production_order_id = p_order_id;

  IF v_output_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La orden no tiene productos registrados');
  END IF;

  -- Verificar stock suficiente antes de hacer cualquier cambio
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

  -- Descontar insumos del stock
  FOR v_input IN
    SELECT pi.*, si.current_qty AS prev_qty
    FROM production_inputs pi
    JOIN stock_items si ON si.id = pi.stock_item_id
    WHERE pi.production_order_id = p_order_id
  LOOP
    v_prev_qty := v_input.prev_qty;
    v_new_qty  := v_prev_qty - v_input.qty_used;

    UPDATE stock_items
    SET current_qty = v_new_qty,
        updated_at  = now()
    WHERE id = v_input.stock_item_id;

    INSERT INTO stock_movements
      (stock_item_id, qty, movement_type, reason, previous_qty, new_qty, created_by)
    VALUES
      (v_input.stock_item_id, v_input.qty_used,
       'uso', 'produccion_input', v_prev_qty, v_new_qty, p_user_id);

    v_total_input := v_total_input + v_input.qty_used;
    v_movements := v_movements || jsonb_build_object(
      'type', 'input',
      'stock_item_id', v_input.stock_item_id,
      'change', -v_input.qty_used
    );
  END LOOP;

  -- Sumar producción al stock
  FOR v_output IN
    SELECT po.*, si.current_qty AS prev_qty
    FROM production_outputs po
    LEFT JOIN stock_items si ON si.id = po.stock_item_id
    WHERE po.production_order_id = p_order_id
  LOOP
    IF v_output.is_waste THEN
      v_total_waste := v_total_waste + v_output.qty_produced;
      CONTINUE;
    END IF;

    IF v_output.stock_item_id IS NULL THEN
      v_total_output_net := v_total_output_net + v_output.qty_produced;
      CONTINUE;
    END IF;

    v_prev_qty := COALESCE(v_output.prev_qty, 0);
    v_new_qty  := v_prev_qty + v_output.qty_produced;

    UPDATE stock_items
    SET current_qty = v_new_qty,
        updated_at  = now()
    WHERE id = v_output.stock_item_id;

    INSERT INTO stock_movements
      (stock_item_id, qty, movement_type, reason, previous_qty, new_qty, created_by)
    VALUES
      (v_output.stock_item_id, v_output.qty_produced,
       'entrada', 'produccion_output', v_prev_qty, v_new_qty, p_user_id);

    v_total_output_net := v_total_output_net + v_output.qty_produced;
    v_movements := v_movements || jsonb_build_object(
      'type', 'output',
      'stock_item_id', v_output.stock_item_id,
      'change', v_output.qty_produced
    );
  END LOOP;

  IF v_total_input > 0 THEN
    v_efficiency := round(
      ((v_total_input - v_total_waste) / v_total_input) * 100,
      1
    );
  END IF;

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
