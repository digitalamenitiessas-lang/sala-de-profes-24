-- ============================================================================
-- 20260906 — Workflows Fudo-first: stock por área, kardex único, producción
-- con costo real persistido y pedidos conciliados con los gastos de Fudo.
-- ============================================================================
-- Principio: "Fudo opera, LVE piensa". Fudo es la fuente de verdad de catálogo,
-- cantidades, costos y compras (gastos). LVE agrega control, trazabilidad y
-- números económicos sin duplicar ninguna carga.
--
-- Todo es aditivo e idempotente (IF NOT EXISTS / OR REPLACE): se puede correr
-- más de una vez. El código de la app tolera que esta migración todavía no
-- esté aplicada (degrada sin romper), pero sin ella no hay áreas, ni costo de
-- producción persistido, ni conciliación de pedidos.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) STOCK: área operativa + categoría real de Fudo
-- ----------------------------------------------------------------------------
ALTER TABLE public.stock_items
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS fudo_category text,
  ADD COLUMN IF NOT EXISTS area_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stock_items.area IS
  'Área operativa: cocina | pasteleria | barra | descartables | limpieza | otros. La setea el sync desde la categoría de Fudo salvo area_locked.';
COMMENT ON COLUMN public.stock_items.fudo_category IS
  'Nombre de la categoría del ingrediente/producto en Fudo (solo lectura, espejo).';
COMMENT ON COLUMN public.stock_items.area_locked IS
  'true cuando un encargado fijó el área a mano: el sync no la pisa.';

ALTER TABLE public.stock_items DROP CONSTRAINT IF EXISTS stock_items_area_check;
ALTER TABLE public.stock_items
  ADD CONSTRAINT stock_items_area_check
  CHECK (area IS NULL OR area IN ('cocina', 'pasteleria', 'barra', 'descartables', 'limpieza', 'otros'));

CREATE INDEX IF NOT EXISTS idx_stock_items_area
  ON public.stock_items (area)
  WHERE is_active;

-- Backfill inicial por categoría LVE (el sync nocturno refina con Fudo).
UPDATE public.stock_items
SET area = CASE category
  WHEN 'carnes'      THEN 'cocina'
  WHEN 'verduras'    THEN 'cocina'
  WHEN 'frutas'      THEN 'cocina'
  WHEN 'lacteos'     THEN 'cocina'
  WHEN 'condimentos' THEN 'cocina'
  WHEN 'elaborados'  THEN 'cocina'
  WHEN 'proteinas'   THEN 'cocina'
  WHEN 'pastas'      THEN 'cocina'
  WHEN 'panaderia'   THEN 'pasteleria'
  WHEN 'bebidas'     THEN 'barra'
  WHEN 'desechables' THEN 'descartables'
  WHEN 'limpieza'    THEN 'limpieza'
  ELSE NULL
END
WHERE area IS NULL;

-- last_counted_at nunca se escribía: reconstruirlo desde los conteos reales.
UPDATE public.stock_items si
SET last_counted_at = l.max_at
FROM (
  SELECT stock_item_id, max(created_at) AS max_at
  FROM public.stock_logs
  WHERE action = 'physical_count'
  GROUP BY stock_item_id
) l
WHERE l.stock_item_id = si.id
  AND (si.last_counted_at IS NULL OR si.last_counted_at < l.max_at);

-- ----------------------------------------------------------------------------
-- 2) KARDEX ÚNICO: stock_movements recibe conteos, mermas, recepciones y
--    producción, con costo del movimiento y vínculo a la orden.
-- ----------------------------------------------------------------------------
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS production_order_id bigint
    REFERENCES public.production_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fudo_synced boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cost_per_unit numeric;

COMMENT ON COLUMN public.stock_movements.movement_type IS
  'entrada (compra/producción) | uso (consumo en producción) | ajuste (conteo físico) | merma (desperdicio)';
COMMENT ON COLUMN public.stock_movements.reason IS
  'physical_count | manual_adjustment | waste | reception | produccion_input | produccion_output';

-- Un solo vocabulario de movement_type (se conservan los legacy in/out por si
-- quedó alguna fila vieja).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.stock_movements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%movement_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.stock_movements DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN ('entrada', 'uso', 'ajuste', 'merma', 'in', 'out'));

CREATE INDEX IF NOT EXISTS idx_stock_movements_item_created
  ON public.stock_movements (stock_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_production_order
  ON public.stock_movements (production_order_id)
  WHERE production_order_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3) PRODUCCIÓN: eficiencia y costo persistidos, vínculo con movimientos (uuid)
-- ----------------------------------------------------------------------------
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS efficiency_pct numeric,
  ADD COLUMN IF NOT EXISTS total_cost numeric,
  ADD COLUMN IF NOT EXISTS cost_per_output_unit numeric,
  ADD COLUMN IF NOT EXISTS main_output_stock_item_id uuid
    REFERENCES public.stock_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.production_orders.efficiency_pct IS
  'Rendimiento en masa/volumen: (entradas − merma) / entradas, solo unidades convertibles (kg/g/l/ml). NULL si no aplica.';
COMMENT ON COLUMN public.production_orders.total_cost IS
  'Σ qty_used × cost_per_unit de los insumos, congelado al completar.';
COMMENT ON COLUMN public.production_orders.cost_per_output_unit IS
  'total_cost / cantidad de la salida principal (la de mayor cantidad no-merma con stock_item).';

-- production_inputs.stock_movement_id es bigint (legacy) y stock_movements.id es
-- uuid: se agrega el vínculo correcto sin tocar la columna vieja.
ALTER TABLE public.production_inputs  ADD COLUMN IF NOT EXISTS movement_uuid uuid;
ALTER TABLE public.production_outputs ADD COLUMN IF NOT EXISTS movement_uuid uuid;

-- ----------------------------------------------------------------------------
-- 4) PEDIDOS: fecha de envío al proveedor + conciliación con GASTOS de Fudo
-- ----------------------------------------------------------------------------
ALTER TABLE public.kitchen_orders
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS fudo_expense_id text,
  ADD COLUMN IF NOT EXISTS fudo_amount numeric,
  ADD COLUMN IF NOT EXISTS received_mode text,
  ADD COLUMN IF NOT EXISTS received_note text;

ALTER TABLE public.bar_orders
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS fudo_expense_id text,
  ADD COLUMN IF NOT EXISTS fudo_amount numeric,
  ADD COLUMN IF NOT EXISTS received_mode text,
  ADD COLUMN IF NOT EXISTS received_note text;

COMMENT ON COLUMN public.kitchen_orders.received_mode IS
  'fudo_expense (la compra se cargó en Fudo, LVE no toca stock) | lve_stock (LVE sumó el stock y lo empujó a Fudo) | sin_stock (solo se cerró el pedido)';

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_status ON public.kitchen_orders (status);
CREATE INDEX IF NOT EXISTS idx_bar_orders_status     ON public.bar_orders (status);

-- Pedidos ya marcados como enviados sin fecha: usar updated_at como aproximación.
UPDATE public.kitchen_orders SET ordered_at = updated_at WHERE ordered_at IS NULL AND status IN ('ordered', 'received');
UPDATE public.bar_orders     SET ordered_at = updated_at WHERE ordered_at IS NULL AND status IN ('ordered', 'received');

-- ----------------------------------------------------------------------------
-- 5) RPC complete_production_order v5
--    - descuenta insumos y suma salidas (igual que v4)
--    - vuelve a crear LOTES (la v4 del 20260817 los había perdido)
--    - congela el costo de cada insumo y calcula el costo de la tanda
--    - actualiza el costo del elaborado (promedio ponderado con el stock previo)
--    - persiste eficiencia y costo en production_orders
--    - vincula cada fila con su movimiento (movement_uuid) y el movimiento con
--      la orden (production_order_id)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_production_order(
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

  -- ── Insumos: descontar, congelar costo, kardex ──
  FOR v_input IN
    SELECT pi.*, si.current_qty AS prev_qty, si.cost_per_unit AS item_cost, si.unit AS item_unit
    FROM production_inputs pi
    JOIN stock_items si ON si.id = pi.stock_item_id
    WHERE pi.production_order_id = p_order_id
  LOOP
    v_prev_qty  := v_input.prev_qty;
    v_new_qty   := v_prev_qty - v_input.qty_used;
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
    SELECT po.*, si.current_qty AS prev_qty, si.shelf_life_days AS item_shelf_life,
           si.cost_per_unit AS item_cost, si.unit AS item_unit
    FROM production_outputs po
    LEFT JOIN stock_items si ON si.id = po.stock_item_id
    WHERE po.production_order_id = p_order_id
  LOOP
    IF v_output.is_waste THEN
      v_total_waste := v_total_waste + v_output.qty_produced;
      IF lower(COALESCE(v_output.unit, '')) IN ('kg', 'l', 'lt', 'litro') THEN
        v_mass_waste := v_mass_waste + v_output.qty_produced;
      ELSIF lower(COALESCE(v_output.unit, '')) IN ('g', 'ml') THEN
        v_mass_waste := v_mass_waste + (v_output.qty_produced / 1000);
      END IF;
      CONTINUE;
    END IF;

    IF v_output.stock_item_id IS NULL THEN
      v_total_output_net := v_total_output_net + v_output.qty_produced;
      CONTINUE;
    END IF;

    v_prev_qty := COALESCE(v_output.prev_qty, 0);
    v_new_qty  := v_prev_qty + v_output.qty_produced;

    -- Costo del elaborado: promedio ponderado entre lo que había y lo producido.
    -- Solo para la salida principal (las secundarias no tienen costo imputable).
    v_prev_cost := v_output.item_cost;
    IF v_output.stock_item_id = v_main_item AND v_cost_per_unit IS NOT NULL THEN
      IF v_prev_qty > 0 AND COALESCE(v_prev_cost, 0) > 0 THEN
        v_prev_cost := round((v_prev_qty * v_prev_cost + v_output.qty_produced * v_cost_per_unit) / v_new_qty, 2);
      ELSE
        v_prev_cost := v_cost_per_unit;
      END IF;
      UPDATE stock_items
      SET current_qty = v_new_qty, cost_per_unit = v_prev_cost, updated_at = now()
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

GRANT EXECUTE ON FUNCTION public.complete_production_order(bigint, uuid) TO authenticated;
