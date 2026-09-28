-- ============================================================================
-- MIGRACIÓN: Corpus ingestion infrastructure + Stock RPCs
-- Fecha: 2026-04-04
-- Fases:
--   1) Schema: slug en recipes, ingredient_unit en recipe_ingredients
--   2) Tabla: recipe_ingredient_pending_links (cola de revisión manual)
--   3) RPCs: stock_availability, stock_duration, recipes_at_risk
--   4) Vista: v_recipe_stock_status (dashboard rápido)
-- ============================================================================

-- ============================================================================
-- 1) Agregar slug a recipes (clave de idempotencia para corpus)
-- ============================================================================
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_slug
  ON recipes (slug) WHERE slug IS NOT NULL;

COMMENT ON COLUMN recipes.slug IS 'Slug del corpus (ej: milanesa, la-bondiola). Clave de idempotencia para ingesta.';

-- ============================================================================
-- 2) Agregar ingredient_unit a recipe_ingredients
-- ============================================================================
-- Almacena la unidad en que qty_per_portion está expresada.
-- DEBE coincidir con stock_items.unit para que los cálculos sean correctos.
ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS ingredient_unit text DEFAULT 'kg';
ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN recipe_ingredients.ingredient_unit IS
  'Unidad de qty_per_portion (ej: kg, lt, unidad). Debe coincidir con stock_items.unit.';
COMMENT ON COLUMN recipe_ingredients.notes IS
  'Notas de conversión u observaciones del chef (ej: "convertido de gr a kg").';

-- ============================================================================
-- 3) Tabla: recipe_ingredient_pending_links
-- Cola de vinculaciones ambiguas o sin match para revisión manual del chef/encargado.
-- ============================================================================
CREATE TABLE IF NOT EXISTS recipe_ingredient_pending_links (
  id                      bigserial    PRIMARY KEY,
  recipe_id               bigint       REFERENCES recipes(id) ON DELETE CASCADE,
  recipe_name             text         NOT NULL,
  recipe_slug             text         NOT NULL,
  ingredient_name         text         NOT NULL,
  normalized_name         text         NOT NULL,
  cantidad                numeric,
  unidad                  text,
  match_confidence        text         NOT NULL CHECK (match_confidence IN ('ambiguo', 'sin_match')),
  match_score             integer      NOT NULL DEFAULT 0,
  suggested_stock_item_id bigint       REFERENCES stock_items(id) ON DELETE SET NULL,
  suggested_stock_item_name text,
  match_reasons           text[]       DEFAULT '{}',
  status                  text         NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected', 'manual')),
  resolved_stock_item_id  bigint       REFERENCES stock_items(id) ON DELETE SET NULL,
  resolved_qty_per_portion numeric,
  resolved_unit           text,
  resolved_by             uuid,
  resolved_at             timestamptz,
  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now()
);

-- Índice único: evita duplicados por receta+ingrediente
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_links_recipe_ingredient
  ON recipe_ingredient_pending_links (recipe_id, normalized_name)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_links_status
  ON recipe_ingredient_pending_links (status);

CREATE INDEX IF NOT EXISTS idx_pending_links_recipe
  ON recipe_ingredient_pending_links (recipe_id);

-- RLS
ALTER TABLE recipe_ingredient_pending_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_links_select" ON recipe_ingredient_pending_links;
CREATE POLICY "pending_links_select" ON recipe_ingredient_pending_links
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "pending_links_insert" ON recipe_ingredient_pending_links;
CREATE POLICY "pending_links_insert" ON recipe_ingredient_pending_links
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "pending_links_update" ON recipe_ingredient_pending_links;
CREATE POLICY "pending_links_update" ON recipe_ingredient_pending_links
  FOR UPDATE USING (auth_role() IN ('encargado', 'chef', 'socio'));

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_pending_links_updated_at ON recipe_ingredient_pending_links;
CREATE TRIGGER trg_pending_links_updated_at
  BEFORE UPDATE ON recipe_ingredient_pending_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE recipe_ingredient_pending_links IS
  'Cola de vinculaciones ingrediente→stock pendientes de revisión manual. '
  'Generada durante la ingesta del corpus cuando el match es ambiguo o inexistente.';

-- ============================================================================
-- 4) RPC: stock_availability
-- ============================================================================
-- Calcula cuántas porciones de una receta se pueden preparar con el stock actual.
-- El insumo más limitante (menos porciones disponibles) determina el total.
--
-- Parámetros:
--   p_recipe_id — ID de la receta
--
-- Retorna: JSONB con available_portions, limiting_ingredient, y detalle por ingrediente.
-- ============================================================================
CREATE OR REPLACE FUNCTION stock_availability(p_recipe_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recipe_name       text;
  v_ingredients       jsonb := '[]'::jsonb;
  v_min_portions      numeric := NULL;
  v_limiting_item     text := NULL;
  v_limiting_item_id  bigint := NULL;
  v_ingredient        record;
  v_available         numeric;
  v_count             int := 0;
BEGIN
  -- Validar receta
  SELECT name INTO v_recipe_name
  FROM recipes
  WHERE id = p_recipe_id AND is_active = true;

  IF v_recipe_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Receta %s no encontrada o inactiva', p_recipe_id)
    );
  END IF;

  -- Recorrer ingredientes con stock actual
  FOR v_ingredient IN
    SELECT
      ri.id              AS ri_id,
      ri.stock_item_id,
      ri.qty_per_portion,
      ri.ingredient_unit,
      si.name            AS item_name,
      si.current_qty,
      si.unit            AS stock_unit,
      si.min_level
    FROM recipe_ingredients ri
    JOIN stock_items si ON si.id = ri.stock_item_id
    WHERE ri.recipe_id = p_recipe_id
      AND ri.qty_per_portion > 0
      AND si.is_active = true
  LOOP
    -- Porciones disponibles para este ingrediente
    v_available := CASE
      WHEN v_ingredient.qty_per_portion > 0
        THEN v_ingredient.current_qty / v_ingredient.qty_per_portion
      ELSE NULL
    END;

    v_ingredients := v_ingredients || jsonb_build_object(
      'stock_item_id',   v_ingredient.stock_item_id,
      'name',            v_ingredient.item_name,
      'current_qty',     v_ingredient.current_qty,
      'qty_per_portion', v_ingredient.qty_per_portion,
      'unit',            v_ingredient.stock_unit,
      'available_portions', COALESCE(ROUND(v_available, 1), 0),
      'is_limiting',     false
    );

    IF v_available IS NOT NULL AND (v_min_portions IS NULL OR v_available < v_min_portions) THEN
      v_min_portions      := v_available;
      v_limiting_item     := v_ingredient.item_name;
      v_limiting_item_id  := v_ingredient.stock_item_id;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  -- Marcar el ingrediente limitante en el array
  IF v_limiting_item_id IS NOT NULL THEN
    SELECT jsonb_agg(
      CASE WHEN (elem->>'stock_item_id')::bigint = v_limiting_item_id
        THEN jsonb_set(elem, '{is_limiting}', 'true')
        ELSE elem
      END
    )
    INTO v_ingredients
    FROM jsonb_array_elements(v_ingredients) AS elem;
  END IF;

  -- Sin ingredientes vinculados
  IF v_count = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'recipe_id', p_recipe_id,
      'recipe_name', v_recipe_name,
      'available_portions', 0,
      'limiting_ingredient', NULL,
      'limiting_ingredient_id', NULL,
      'ingredients_count', 0,
      'ingredients', v_ingredients,
      'warning', 'Esta receta no tiene ingredientes vinculados en recipe_ingredients'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'recipe_id', p_recipe_id,
    'recipe_name', v_recipe_name,
    'available_portions', ROUND(COALESCE(v_min_portions, 0), 1),
    'limiting_ingredient', v_limiting_item,
    'limiting_ingredient_id', v_limiting_item_id,
    'ingredients_count', v_count,
    'ingredients', v_ingredients
  );
END;
$$;

COMMENT ON FUNCTION stock_availability IS
  'Calcula cuántas porciones de una receta se pueden preparar con el stock actual. '
  'El ingrediente más escaso determina el máximo.';

-- ============================================================================
-- 5) RPC: stock_duration
-- ============================================================================
-- Calcula cuántos días durará el stock de un insumo según su consumo histórico.
--
-- Parámetros:
--   p_stock_item_id  — ID del item de stock
--   p_days_lookback  — Ventana de historial en días (default 30)
--
-- Retorna: JSONB con days_remaining, daily_avg_consumption, etc.
-- ============================================================================
CREATE OR REPLACE FUNCTION stock_duration(
  p_stock_item_id bigint,
  p_days_lookback int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item           record;
  v_total_consumed numeric;
  v_daily_avg      numeric;
  v_days_remaining numeric;
  v_semaphore      text;
BEGIN
  -- Validar item
  SELECT id, name, current_qty, unit, min_level
  INTO v_item
  FROM stock_items
  WHERE id = p_stock_item_id AND is_active = true;

  IF v_item IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Stock item %s no encontrado o inactivo', p_stock_item_id)
    );
  END IF;

  -- Consumo total en el período (solo salidas: change < 0)
  SELECT COALESCE(ABS(SUM(change)), 0)
  INTO v_total_consumed
  FROM stock_movements
  WHERE stock_item_id = p_stock_item_id
    AND change < 0
    AND created_at >= NOW() - (p_days_lookback || ' days')::interval;

  -- Promedio diario
  v_daily_avg := CASE
    WHEN p_days_lookback > 0 AND v_total_consumed > 0
      THEN v_total_consumed / p_days_lookback
    ELSE 0
  END;

  -- Días restantes
  v_days_remaining := CASE
    WHEN v_daily_avg > 0 THEN v_item.current_qty / v_daily_avg
    ELSE NULL
  END;

  -- Semáforo de duración
  v_semaphore := CASE
    WHEN v_days_remaining IS NULL              THEN 'sin_historial'
    WHEN v_days_remaining <= 1                 THEN 'critico'
    WHEN v_days_remaining <= 3                 THEN 'bajo'
    WHEN v_days_remaining <= 7                 THEN 'atención'
    ELSE                                            'ok'
  END;

  RETURN jsonb_build_object(
    'success',              true,
    'stock_item_id',        p_stock_item_id,
    'name',                 v_item.name,
    'current_qty',          v_item.current_qty,
    'unit',                 v_item.unit,
    'days_lookback',        p_days_lookback,
    'total_consumed',       ROUND(v_total_consumed, 3),
    'daily_avg_consumption',ROUND(v_daily_avg, 4),
    'days_remaining',       CASE WHEN v_days_remaining IS NOT NULL THEN ROUND(v_days_remaining, 1) ELSE NULL END,
    'semaphore',            v_semaphore,
    'note', CASE
      WHEN v_daily_avg = 0
        THEN 'Sin historial de consumo en los últimos ' || p_days_lookback || ' días'
      ELSE NULL
    END
  );
END;
$$;

COMMENT ON FUNCTION stock_duration IS
  'Calcula cuántos días durará el stock de un insumo según consumo histórico. '
  'Ejemplo: 5 kg de nalga con promedio 1.2 kg/día → 4.2 días restantes.';

-- ============================================================================
-- 6) RPC: recipes_at_risk
-- ============================================================================
-- Lista todas las recetas con stock insuficiente para producir.
-- Útil para planificación de compras y alertas al chef.
--
-- Parámetros:
--   p_min_portions_threshold — Umbral mínimo de porciones (default: 10)
--
-- Retorna: TABLE con recipe_id, recipe_name, available_portions, limiting_ingredient, status
-- ============================================================================
CREATE OR REPLACE FUNCTION recipes_at_risk(p_min_portions_threshold int DEFAULT 10)
RETURNS TABLE (
  recipe_id           bigint,
  recipe_name         text,
  available_portions  numeric,
  limiting_ingredient text,
  limiting_item_id    bigint,
  status              text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recipe      record;
  v_avail       jsonb;
BEGIN
  FOR v_recipe IN
    SELECT DISTINCT r.id, r.name
    FROM recipes r
    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    WHERE r.is_active = true
    ORDER BY r.name
  LOOP
    v_avail := stock_availability(v_recipe.id);

    IF (v_avail->>'success')::boolean THEN
      recipe_id           := v_recipe.id;
      recipe_name         := v_recipe.name;
      available_portions  := (v_avail->>'available_portions')::numeric;
      limiting_ingredient := v_avail->>'limiting_ingredient';
      limiting_item_id    := (v_avail->>'limiting_ingredient_id')::bigint;
      status              := CASE
        WHEN available_portions <= 0                      THEN 'sin_stock'
        WHEN available_portions < p_min_portions_threshold THEN 'bajo'
        ELSE                                                   'ok'
      END;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION recipes_at_risk IS
  'Lista recetas con stock insuficiente para producir. '
  'Útil para planificación de compras. Threshold default: 10 porciones.';

-- ============================================================================
-- 7) Vista: v_recipe_stock_status
-- Dashboard rápido: combina recipe_costs + stock_availability por receta.
-- ============================================================================
CREATE OR REPLACE VIEW v_recipe_stock_status AS
SELECT
  r.id                            AS recipe_id,
  r.name                          AS recipe_name,
  r.slug                          AS recipe_slug,
  r.portion_yield,
  -- Costo por porción (de la vista existente recipe_costs)
  COALESCE(rc.cost_per_portion, 0) AS cost_per_portion,
  COALESCE(rc.cost_per_batch, 0)   AS cost_per_batch,
  -- Conteo de ingredientes vinculados en recipe_ingredients
  COUNT(ri.id)                    AS linked_ingredients_count,
  -- Insumos sin stock (current_qty <= 0)
  COUNT(CASE WHEN si.current_qty <= 0 THEN 1 END) AS out_of_stock_count,
  -- Insumos en nivel crítico
  COUNT(CASE WHEN si.current_qty <= si.min_level AND si.current_qty > 0 THEN 1 END) AS critical_stock_count
FROM recipes r
LEFT JOIN recipe_costs rc       ON rc.recipe_id = r.id
LEFT JOIN recipe_ingredients ri ON ri.recipe_id = r.id
LEFT JOIN stock_items si        ON si.id = ri.stock_item_id
WHERE r.is_active = true
GROUP BY r.id, r.name, r.slug, r.portion_yield, rc.cost_per_portion, rc.cost_per_batch;

COMMENT ON VIEW v_recipe_stock_status IS
  'Vista de estado de stock por receta: costos, ingredientes vinculados, alertas.';

-- ============================================================================
-- FIN
-- ============================================================================
-- Resumen:
--   recipes.slug                      — idempotencia en corpus ingestion
--   recipe_ingredients.ingredient_unit — unidad de qty_per_portion
--   recipe_ingredient_pending_links    — cola de revisión manual
--   stock_availability(recipe_id)      — cuántas porciones puedo hacer
--   stock_duration(item_id, days)      — cuántos días dura el stock
--   recipes_at_risk(threshold)         — recetas con stock insuficiente
--   v_recipe_stock_status              — dashboard rápido por receta
-- ============================================================================
