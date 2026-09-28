-- ============================================================================
-- MIGRACIÓN: RPCs de rendimiento y riesgo de stock
-- Fecha: 2026-04-06
-- Depende de: tablas recipes (uuid PK), recipe_ingredients, stock_items
-- ============================================================================

-- ============================================================================
-- 1) RPC: stock_yield
-- ============================================================================

CREATE OR REPLACE FUNCTION stock_yield()
RETURNS TABLE (
  recipe_id     uuid,
  recipe_name   text,
  yield_portions numeric,
  max_portions  numeric,
  limiting_item text,
  limiting_qty  numeric,
  limiting_need numeric,
  ingredients   jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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

COMMENT ON FUNCTION stock_yield IS
  'Calcula cuántas porciones de cada receta se pueden hacer con el stock actual.';

-- ============================================================================
-- 2) RPC: recipes_at_risk
-- ============================================================================

CREATE OR REPLACE FUNCTION recipes_at_risk(
  p_min_portions numeric DEFAULT 5
)
RETURNS TABLE (
  recipe_id      uuid,
  recipe_name    text,
  max_portions   numeric,
  missing_items  jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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

COMMENT ON FUNCTION recipes_at_risk IS
  'Devuelve recetas que no pueden cubrir p_min_portions porciones con el stock actual.';

-- ============================================================================
-- FIN
-- ============================================================================
