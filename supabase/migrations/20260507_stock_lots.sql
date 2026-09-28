-- ============================================================
-- Stock lots for finished goods with shelf life
-- ============================================================

ALTER TABLE public.production_outputs
  ADD COLUMN IF NOT EXISTS lot_code text,
  ADD COLUMN IF NOT EXISTS produced_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE TABLE IF NOT EXISTS public.stock_lots (
  id bigserial PRIMARY KEY,
  stock_item_id bigint NOT NULL REFERENCES public.stock_items(id) ON DELETE CASCADE,
  production_order_id bigint REFERENCES public.production_orders(id) ON DELETE SET NULL,
  production_output_id bigint REFERENCES public.production_outputs(id) ON DELETE SET NULL,
  lot_code text NOT NULL,
  qty_original numeric NOT NULL DEFAULT 0,
  qty_remaining numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'unidad',
  produced_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'depleted', 'discarded')),
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_lots_output_unique
  ON public.stock_lots (production_output_id)
  WHERE production_output_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_lots_item
  ON public.stock_lots (stock_item_id);

CREATE INDEX IF NOT EXISTS idx_stock_lots_expires
  ON public.stock_lots (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_lots_status
  ON public.stock_lots (status);

ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_stock_lots" ON public.stock_lots;
CREATE POLICY "read_stock_lots" ON public.stock_lots
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "manage_stock_lots" ON public.stock_lots;
CREATE POLICY "manage_stock_lots" ON public.stock_lots
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('socio', 'encargado', 'chef', 'cocina')
    )
  );

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
  v_movement_id      bigint;
  v_lot_id           bigint;
  v_total_input      numeric := 0;
  v_total_output_net numeric := 0;
  v_total_waste      numeric := 0;
  v_efficiency       numeric := 0;
  v_movements        jsonb   := '[]'::jsonb;
  v_input_count      int;
  v_output_count     int;
  v_shelf_life_days  integer;
  v_produced_at      timestamptz;
  v_expires_at       timestamptz;
  v_lot_code         text;
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

  FOR v_input IN
    SELECT pi.*, si.current_qty, si.name AS item_name
    FROM production_inputs pi
    JOIN stock_items si ON si.id = pi.stock_item_id
    WHERE pi.production_order_id = p_order_id
  LOOP
    IF v_input.current_qty < v_input.qty_used THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', format(
          'Stock insuficiente de "%s": disponible %.3f, requerido %.3f',
          v_input.item_name, v_input.current_qty, v_input.qty_used
        )
      );
    END IF;
  END LOOP;

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

    SELECT shelf_life_days
    INTO v_shelf_life_days
    FROM stock_items
    WHERE id = v_output.stock_item_id;

    v_produced_at := COALESCE(v_output.produced_at, v_order.completed_at, now());
    v_expires_at := v_output.expires_at;

    IF v_expires_at IS NULL AND v_shelf_life_days IS NOT NULL THEN
      v_expires_at := v_produced_at + make_interval(days => v_shelf_life_days);
    END IF;

    v_lot_code := COALESCE(
      NULLIF(v_output.lot_code, ''),
      format('LOT-%s-%s-%s', to_char(v_produced_at AT TIME ZONE 'America/Argentina/Tucuman', 'YYMMDD'), p_order_id, v_output.id)
    );

    UPDATE production_outputs
    SET stock_movement_id = v_movement_id,
        produced_at = COALESCE(production_outputs.produced_at, v_produced_at),
        expires_at = COALESCE(production_outputs.expires_at, v_expires_at),
        lot_code = COALESCE(NULLIF(production_outputs.lot_code, ''), v_lot_code)
    WHERE id = v_output.id;

    IF v_output.qty_produced > 0 THEN
      INSERT INTO stock_lots (
        stock_item_id,
        production_order_id,
        production_output_id,
        lot_code,
        qty_original,
        qty_remaining,
        unit,
        produced_at,
        expires_at,
        status,
        notes,
        created_by
      ) VALUES (
        v_output.stock_item_id,
        p_order_id,
        v_output.id,
        v_lot_code,
        v_output.qty_produced,
        v_output.qty_produced,
        v_output.unit,
        v_produced_at,
        v_expires_at,
        CASE
          WHEN v_expires_at IS NOT NULL AND v_expires_at < now() THEN 'expired'
          ELSE 'active'
        END,
        v_output.notes,
        p_user_id
      )
      ON CONFLICT (production_output_id) DO NOTHING
      RETURNING id INTO v_lot_id;
    ELSE
      v_lot_id := NULL;
    END IF;

    v_total_output_net := v_total_output_net + v_output.qty_produced;
    v_movements := v_movements || jsonb_build_object(
      'type', 'output',
      'stock_item_id', v_output.stock_item_id,
      'change', v_output.qty_produced,
      'movement_id', v_movement_id,
      'lot_id', v_lot_id,
      'lot_code', v_lot_code,
      'produced_at', v_produced_at,
      'expires_at', v_expires_at
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
