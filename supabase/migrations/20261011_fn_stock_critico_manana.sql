-- ---------------------------------------------------------------------------
-- fn_stock_critico_manana — insumos que no alcanzan para el día/turno siguiente
-- ---------------------------------------------------------------------------
-- Calcula la tasa de consumo diaria de cada insumo activo mirando los últimos
-- 21 días de stock_logs. Un item es "crítico" si:
--   a) su qty es negativa (ya hay quiebre), o
--   b) le quedan menos de 1.5 días de stock según el ritmo histórico, o
--   c) está por debajo de su min_qty configurado
--
-- Usada por /api/cron/stock-preclose (corre 7hs, 15hs y 23hs AR).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_stock_critico_manana()
RETURNS TABLE(
  stock_item_id  uuid,
  name           text,
  unit           text,
  current_qty    numeric,
  min_qty        numeric,
  consumed_21d   numeric,
  daily_rate     numeric,
  days_of_stock  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH consumo AS (
    SELECT
      sl.stock_item_id,
      SUM(
        CASE WHEN sl.new_qty < sl.old_qty
             THEN sl.old_qty - sl.new_qty
             ELSE 0
        END
      ) AS consumed_21d
    FROM public.stock_logs sl
    WHERE sl.created_at >= NOW() - INTERVAL '21 days'
      AND sl.old_qty IS NOT NULL
      AND sl.new_qty IS NOT NULL
    GROUP BY sl.stock_item_id
    HAVING SUM(
      CASE WHEN sl.new_qty < sl.old_qty
           THEN sl.old_qty - sl.new_qty
           ELSE 0
      END
    ) > 0
  )
  SELECT
    si.id                                                 AS stock_item_id,
    si.name,
    si.unit,
    si.current_qty,
    si.min_qty,
    ROUND(c.consumed_21d::numeric, 3)                     AS consumed_21d,
    ROUND((c.consumed_21d / 21.0)::numeric, 3)            AS daily_rate,
    CASE
      WHEN c.consumed_21d > 0
        THEN ROUND((si.current_qty / (c.consumed_21d / 21.0))::numeric, 1)
      ELSE NULL
    END                                                   AS days_of_stock
  FROM public.stock_items si
  JOIN consumo c ON c.stock_item_id = si.id
  WHERE si.is_active = true
    AND (
      si.current_qty < 0
      OR (c.consumed_21d > 0
          AND si.current_qty / (c.consumed_21d / 21.0) < 1.5)
      OR (si.min_qty > 0
          AND si.current_qty <= si.min_qty)
    )
  ORDER BY
    CASE
      WHEN si.current_qty < 0 THEN si.current_qty - 9999
      WHEN c.consumed_21d > 0 THEN si.current_qty / (c.consumed_21d / 21.0)
      ELSE 99
    END ASC;
$$;

COMMENT ON FUNCTION public.fn_stock_critico_manana IS
  'Devuelve los insumos activos con riesgo de quiebre: negativos, '
  'menos de 1.5 días de stock según historial de 21d, o bajo su min_qty. '
  'Usada por el cron stock-preclose (7hs, 15hs, 23hs AR).';

GRANT EXECUTE ON FUNCTION public.fn_stock_critico_manana() TO service_role;
