-- ============================================================================
-- MIGRACIÓN: Lógica de inventario — deducción automática por ventas y cocina
-- Fecha: 2026-03-18
-- Depende de: 20260318_fudo_integration_schema.sql
-- ============================================================================

-- ============================================================================
-- 1) RPC: produce_recipe
-- ============================================================================
-- Descuenta insumos del stock según una receta y la cantidad de porciones.
-- Uso principal: Cocina Diaria (planificación de producción).
--
-- Parámetros:
--   p_recipe_id    — ID de la receta
--   p_portions     — Cantidad de porciones a producir
--   p_reference_id — ID externo de referencia (ej: kitchen_daily_log.id)
--
-- Retorna: JSONB con detalle de movimientos generados.
-- ============================================================================

CREATE OR REPLACE FUNCTION produce_recipe(
  p_recipe_id    bigint,
  p_portions     numeric,
  p_reference_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER  -- para bypasear RLS en stock_movements/stock_items
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

COMMENT ON FUNCTION produce_recipe IS
  'Descuenta insumos del stock según receta. Usado por Cocina Diaria.';

-- ============================================================================
-- 2) RPC: deduct_stock_on_sale
-- ============================================================================
-- Descuenta stock basándose en una venta registrada en fudo_sales.
--
-- Flujo:
--   fudo_sales.fudo_product_id → menu_items.fudo_product_id → recipe_id
--   → recipe_ingredients → stock_items → register_stock_movement
--
-- Si el producto no tiene receta vinculada (recipe_id IS NULL), la función
-- no hace nada y retorna success=true con 0 ingredientes afectados.
-- Esto es esperado para productos sin receta (ej: bebidas embotelladas).
-- ============================================================================

CREATE OR REPLACE FUNCTION deduct_stock_on_sale(
  p_sale_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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

COMMENT ON FUNCTION deduct_stock_on_sale IS
  'Descuenta stock automáticamente al registrar una venta de Fudo. '
  'Si el producto no tiene receta vinculada, no hace nada.';

-- ============================================================================
-- 3) TRIGGER: auto-deducción de stock al insertar en fudo_sales
-- ============================================================================
-- Llama a deduct_stock_on_sale por cada fila insertada.
-- Si deduct_stock_on_sale retorna success=false, solo hace RAISE NOTICE
-- (no aborta la inserción).
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_fudo_sales_deduct_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

CREATE TRIGGER trg_fudo_sales_after_insert
  AFTER INSERT ON fudo_sales
  FOR EACH ROW
  EXECUTE FUNCTION trg_fudo_sales_deduct_stock();

COMMENT ON TRIGGER trg_fudo_sales_after_insert ON fudo_sales IS
  'Auto-descuenta stock al insertar ventas de Fudo (si el producto tiene receta).';

-- ============================================================================
-- FIN — Resumen:
--
-- Funciones RPC:
--   produce_recipe(p_recipe_id, p_portions, p_reference_id)
--     → Cocina Diaria: descuenta insumos por producción planificada
--
--   deduct_stock_on_sale(p_sale_id)
--     → Ventas Fudo: descuenta insumos por venta real
--
-- Trigger:
--   trg_fudo_sales_after_insert ON fudo_sales
--     → Llama deduct_stock_on_sale automáticamente al insertar ventas
--
-- Ambas funciones usan register_stock_movement (migración anterior)
-- y son SECURITY DEFINER para bypasear RLS.
-- ============================================================================
