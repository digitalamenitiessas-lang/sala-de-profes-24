-- ============================================================================
-- MIGRACIÓN: Sistema de reconciliación de stock
-- Fecha: 2026-04-06
-- Depende de: stock_items, stock_movements, menu_items, fudo_sales,
--             mise_en_place_items, mise_en_place_records, kitchen_shifts, recipes
-- ============================================================================

-- Índice para acelerar consultas por item + rango de fecha
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_date
ON stock_movements (stock_item_id, created_at);

-- ============================================================================
-- 1) RPC: stock_reconciliation
-- ============================================================================
-- stock_movements columns: stock_item_id(uuid), movement_type(text), qty(numeric),
--   previous_qty(numeric), new_qty(numeric), reason(text), created_at
-- movement_type values: 'entrada', 'uso', 'desperdicio', 'ajuste'

CREATE OR REPLACE FUNCTION stock_reconciliation(
  p_from timestamptz DEFAULT (CURRENT_DATE)::timestamptz,
  p_to   timestamptz DEFAULT now()
)
RETURNS TABLE (
  stock_item_id    uuid,
  name             text,
  unit             text,
  opening_qty      numeric,
  received         numeric,
  prod_in          numeric,
  prod_out         numeric,
  sales            numeric,
  waste            numeric,
  manual_adj       numeric,
  expected_closing numeric,
  actual_closing   numeric,
  variance         numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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

COMMENT ON FUNCTION stock_reconciliation IS
  'Reconciliación de stock por periodo: opening + entradas - salidas = expected vs actual.';

-- ============================================================================
-- 2) RPC: menu_item_reconciliation
-- ============================================================================

CREATE OR REPLACE FUNCTION menu_item_reconciliation(
  p_from timestamptz DEFAULT (CURRENT_DATE)::timestamptz,
  p_to   timestamptz DEFAULT now()
)
RETURNS TABLE (
  menu_item_id       uuid,
  menu_item_name     text,
  recipe_id          uuid,
  recipe_name        text,
  qty_produced       numeric,
  qty_sold           numeric,
  expected_remaining numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH
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
    AND (COALESCE(mp.qty, 0) + COALESCE(fs.qty, 0)) > 0
  ORDER BY
    COALESCE(mp.qty, 0) - COALESCE(fs.qty, 0) ASC;
$$;

COMMENT ON FUNCTION menu_item_reconciliation IS
  'Reconciliación por item de carta: producido (mise en place) vs vendido (Fudo) = restante esperado.';

-- ============================================================================
-- FIN
-- ============================================================================
