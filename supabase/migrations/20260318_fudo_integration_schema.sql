-- ============================================================================
-- MIGRACIÓN: Esquema completo Sala de Profes + preparación Fudo
-- Fecha: 2026-03-18
-- ============================================================================
-- ⚠️  IMPORTANTE: Este script RECREA las tablas stock_items, suppliers,
--     recipes y menu_items con PKs bigserial (antes eran uuid).
--     Las tablas existentes se dropean con CASCADE.
--     Ejecutar en el SQL Editor de Supabase Dashboard.
-- ============================================================================

-- ============================================================================
-- 0) LIMPIEZA: Drop tablas que se van a recrear
-- ============================================================================
-- Tablas nuevas que podrían existir de intentos anteriores
DROP TABLE IF EXISTS stock_movements CASCADE;
DROP TABLE IF EXISTS fudo_sales CASCADE;
DROP TABLE IF EXISTS recipe_ingredients CASCADE;
DROP TABLE IF EXISTS menu_categories CASCADE;

-- Tablas existentes que se recrean con bigserial
DROP TABLE IF EXISTS stock_alerts CASCADE;
DROP TABLE IF EXISTS menu_items CASCADE;
DROP TABLE IF EXISTS stock_items CASCADE;
DROP TABLE IF EXISTS recipes CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;

-- ============================================================================
-- 1) suppliers
-- ============================================================================
CREATE TABLE suppliers (
  id         bigserial    PRIMARY KEY,
  name       text         NOT NULL,
  contact_name text,
  phone      text,
  email      text,
  notes      text,
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE suppliers IS 'Proveedores de insumos';

-- ============================================================================
-- 2) stock_items
-- ============================================================================
CREATE TABLE stock_items (
  id              bigserial    PRIMARY KEY,
  name            text         NOT NULL,
  unit            text         NOT NULL,
  min_level       numeric      NOT NULL DEFAULT 0,
  current_qty     numeric      NOT NULL DEFAULT 0,
  cost_per_unit   numeric      DEFAULT 0,
  shelf_life_days integer,
  supplier_id     bigint       REFERENCES suppliers(id)
                                 ON UPDATE CASCADE ON DELETE SET NULL,
  fudo_product_id text,
  is_active       boolean      NOT NULL DEFAULT true,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  stock_items IS 'Insumos e ingredientes del restaurante';
COMMENT ON COLUMN stock_items.min_level IS 'Nivel mínimo para semáforo rojo/amarillo';
COMMENT ON COLUMN stock_items.cost_per_unit IS 'Costo por unidad en pesos (para calcular costo de receta)';
COMMENT ON COLUMN stock_items.shelf_life_days IS 'Vida útil en días (lácteos, verduras, etc.)';
COMMENT ON COLUMN stock_items.fudo_product_id IS 'ID en Fudo si el insumo está linkeado a un producto';

-- ============================================================================
-- 3) recipes
-- ============================================================================
CREATE TABLE recipes (
  id            bigserial    PRIMARY KEY,
  name          text         NOT NULL,
  description   text,
  portion_yield numeric      NOT NULL DEFAULT 1,
  is_active     boolean      NOT NULL DEFAULT true,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  recipes IS 'Recetas del restaurante';
COMMENT ON COLUMN recipes.portion_yield IS 'Cuántas porciones produce la receta base';

-- ============================================================================
-- 4) recipe_ingredients
-- ============================================================================
CREATE TABLE recipe_ingredients (
  id             bigserial    PRIMARY KEY,
  recipe_id      bigint       NOT NULL REFERENCES recipes(id)
                                ON UPDATE CASCADE ON DELETE CASCADE,
  stock_item_id  bigint       NOT NULL REFERENCES stock_items(id)
                                ON UPDATE CASCADE ON DELETE RESTRICT,
  qty_per_portion numeric     NOT NULL DEFAULT 0,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, stock_item_id)
);

COMMENT ON TABLE  recipe_ingredients IS 'Ingredientes de cada receta, vinculados a stock_items';
COMMENT ON COLUMN recipe_ingredients.qty_per_portion IS 'Cantidad de insumo necesaria por porción';

-- ============================================================================
-- 5) menu_categories
-- ============================================================================
CREATE TABLE menu_categories (
  id               bigserial    PRIMARY KEY,
  name             text         NOT NULL,
  fudo_category_id text,
  sort_order       integer      DEFAULT 0,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  menu_categories IS 'Categorías de la carta, sincronizables con Fudo';
COMMENT ON COLUMN menu_categories.fudo_category_id IS 'ID de categoría en Fudo (null si es solo local)';

-- ============================================================================
-- 6) menu_items
-- ============================================================================
CREATE TABLE menu_items (
  id               bigserial    PRIMARY KEY,
  name             text         NOT NULL,
  description      text,
  menu_category_id bigint       REFERENCES menu_categories(id)
                                  ON UPDATE CASCADE ON DELETE SET NULL,
  fudo_product_id  text,
  recipe_id        bigint       REFERENCES recipes(id)
                                  ON UPDATE CASCADE ON DELETE SET NULL,
  sale_price       numeric      DEFAULT 0,
  is_active        boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

-- Unique parcial: un producto Fudo solo mapea a un menu_item
CREATE UNIQUE INDEX idx_menu_items_fudo_unique
  ON menu_items (fudo_product_id) WHERE fudo_product_id IS NOT NULL;

COMMENT ON TABLE  menu_items IS 'Items de la carta (lo que se vende)';
COMMENT ON COLUMN menu_items.fudo_product_id IS 'ID del producto en Fudo (source of truth para nombre/precio)';
COMMENT ON COLUMN menu_items.recipe_id IS 'Receta vinculada (se asigna manualmente)';
COMMENT ON COLUMN menu_items.sale_price IS 'Precio de venta (viene de Fudo o se carga manual)';

-- ============================================================================
-- 7) fudo_sales
-- ============================================================================
CREATE TABLE fudo_sales (
  id              bigserial    PRIMARY KEY,
  fudo_ticket_id  text         NOT NULL,
  fudo_product_id text         NOT NULL,
  quantity        numeric      NOT NULL DEFAULT 0,
  sold_at         timestamptz  NOT NULL,
  raw_payload     jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (fudo_ticket_id, fudo_product_id)
);

COMMENT ON TABLE  fudo_sales IS 'Ventas importadas desde Fudo (una fila por producto por ticket)';
COMMENT ON COLUMN fudo_sales.raw_payload IS 'Payload crudo de Fudo para debugging';

-- ============================================================================
-- 8) stock_movements
-- ============================================================================
CREATE TABLE stock_movements (
  id              bigserial    PRIMARY KEY,
  stock_item_id   bigint       NOT NULL REFERENCES stock_items(id)
                                 ON UPDATE CASCADE ON DELETE RESTRICT,
  change          numeric      NOT NULL,
  reason          text         NOT NULL,
  reference_type  text,
  reference_id    text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  created_by      uuid
);

COMMENT ON TABLE  stock_movements IS 'Registro de todos los movimientos de stock';
COMMENT ON COLUMN stock_movements.change IS 'Positivo = entrada, negativo = salida';
COMMENT ON COLUMN stock_movements.reason IS 'production, sale, manual_adjustment, waste, expired, received';
COMMENT ON COLUMN stock_movements.reference_type IS 'daily_kitchen, fudo_sale, manual';
COMMENT ON COLUMN stock_movements.created_by IS 'UUID del usuario que generó el movimiento';

-- ============================================================================
-- 9) ÍNDICES
-- ============================================================================
CREATE INDEX idx_stock_items_supplier     ON stock_items (supplier_id);
CREATE INDEX idx_stock_items_fudo         ON stock_items (fudo_product_id)
                                          WHERE fudo_product_id IS NOT NULL;
CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients (recipe_id);
CREATE INDEX idx_recipe_ingredients_stock  ON recipe_ingredients (stock_item_id);
CREATE INDEX idx_menu_items_category      ON menu_items (menu_category_id);
CREATE INDEX idx_menu_items_recipe        ON menu_items (recipe_id)
                                          WHERE recipe_id IS NOT NULL;
CREATE INDEX idx_menu_items_fudo          ON menu_items (fudo_product_id)
                                          WHERE fudo_product_id IS NOT NULL;
CREATE INDEX idx_fudo_sales_product       ON fudo_sales (fudo_product_id);
CREATE INDEX idx_fudo_sales_sold_at       ON fudo_sales (sold_at);
CREATE INDEX idx_stock_movements_item     ON stock_movements (stock_item_id);
CREATE INDEX idx_stock_movements_date     ON stock_movements (created_at);

-- ============================================================================
-- 10) ROW LEVEL SECURITY
-- ============================================================================

-- Helper: función que chequea rol del usuario autenticado
CREATE OR REPLACE FUNCTION auth_role() RETURNS text AS $$
  SELECT role::text FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- --- suppliers ---
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppliers_select"  ON suppliers FOR SELECT USING (true);
CREATE POLICY "suppliers_insert"  ON suppliers FOR INSERT
  WITH CHECK (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "suppliers_update"  ON suppliers FOR UPDATE
  USING (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "suppliers_delete"  ON suppliers FOR DELETE
  USING (auth_role() = 'encargado');

-- --- stock_items ---
ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_items_select" ON stock_items FOR SELECT USING (true);
CREATE POLICY "stock_items_insert" ON stock_items FOR INSERT
  WITH CHECK (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "stock_items_update" ON stock_items FOR UPDATE
  USING (auth_role() IN ('encargado', 'chef', 'cocina'));
CREATE POLICY "stock_items_delete" ON stock_items FOR DELETE
  USING (auth_role() = 'encargado');

-- --- recipes ---
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recipes_select" ON recipes FOR SELECT USING (true);
CREATE POLICY "recipes_insert" ON recipes FOR INSERT
  WITH CHECK (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "recipes_update" ON recipes FOR UPDATE
  USING (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "recipes_delete" ON recipes FOR DELETE
  USING (auth_role() = 'encargado');

-- --- recipe_ingredients ---
ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recipe_ingredients_select" ON recipe_ingredients FOR SELECT USING (true);
CREATE POLICY "recipe_ingredients_insert" ON recipe_ingredients FOR INSERT
  WITH CHECK (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "recipe_ingredients_update" ON recipe_ingredients FOR UPDATE
  USING (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "recipe_ingredients_delete" ON recipe_ingredients FOR DELETE
  USING (auth_role() IN ('encargado', 'chef'));

-- --- menu_categories ---
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "menu_categories_select" ON menu_categories FOR SELECT USING (true);
CREATE POLICY "menu_categories_insert" ON menu_categories FOR INSERT
  WITH CHECK (auth_role() = 'encargado');
CREATE POLICY "menu_categories_update" ON menu_categories FOR UPDATE
  USING (auth_role() = 'encargado');
CREATE POLICY "menu_categories_delete" ON menu_categories FOR DELETE
  USING (auth_role() = 'encargado');

-- --- menu_items ---
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "menu_items_select" ON menu_items FOR SELECT USING (true);
CREATE POLICY "menu_items_insert" ON menu_items FOR INSERT
  WITH CHECK (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "menu_items_update" ON menu_items FOR UPDATE
  USING (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "menu_items_delete" ON menu_items FOR DELETE
  USING (auth_role() = 'encargado');

-- --- fudo_sales ---
ALTER TABLE fudo_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fudo_sales_select" ON fudo_sales FOR SELECT
  USING (auth_role() IN ('encargado', 'chef'));
-- Inserts vienen del backend con service_role key, no necesita policy de insert para users
CREATE POLICY "fudo_sales_insert_service" ON fudo_sales FOR INSERT
  WITH CHECK (true);

-- --- stock_movements ---
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_movements_select" ON stock_movements FOR SELECT USING (true);
CREATE POLICY "stock_movements_insert" ON stock_movements FOR INSERT
  WITH CHECK (auth_role() IN ('encargado', 'chef', 'cocina'));

-- ============================================================================
-- 11) TRIGGER: updated_at automático
-- ============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_stock_items_updated_at
  BEFORE UPDATE ON stock_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_recipes_updated_at
  BEFORE UPDATE ON recipes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_recipe_ingredients_updated_at
  BEFORE UPDATE ON recipe_ingredients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_menu_categories_updated_at
  BEFORE UPDATE ON menu_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_menu_items_updated_at
  BEFORE UPDATE ON menu_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 12) VIEW: recipe_costs — costo por porción y por batch de cada receta
-- ============================================================================
CREATE OR REPLACE VIEW recipe_costs AS
SELECT
  r.id                       AS recipe_id,
  r.name                     AS recipe_name,
  r.portion_yield,
  COALESCE(
    SUM(ri.qty_per_portion * COALESCE(si.cost_per_unit, 0)),
    0
  )                          AS cost_per_portion,
  COALESCE(
    SUM(ri.qty_per_portion * COALESCE(si.cost_per_unit, 0)),
    0
  ) * r.portion_yield        AS cost_per_batch
FROM recipes r
LEFT JOIN recipe_ingredients ri ON ri.recipe_id = r.id
LEFT JOIN stock_items si        ON si.id = ri.stock_item_id
GROUP BY r.id, r.name, r.portion_yield;

COMMENT ON VIEW recipe_costs IS 'Costo calculado por porción y por batch de cada receta';

-- ============================================================================
-- 13) RPC: register_stock_movement
-- ============================================================================
CREATE OR REPLACE FUNCTION register_stock_movement(
  p_stock_item_id bigint,
  p_change        numeric,
  p_reason        text,
  p_reference_type text DEFAULT NULL,
  p_reference_id   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_movement_id bigint;
  v_new_qty     numeric;
BEGIN
  -- 1) Insertar el movimiento
  INSERT INTO stock_movements (stock_item_id, change, reason, reference_type, reference_id, created_by)
  VALUES (p_stock_item_id, p_change, p_reason, p_reference_type, p_reference_id, auth.uid())
  RETURNING id INTO v_movement_id;

  -- 2) Actualizar stock actual
  UPDATE stock_items
  SET current_qty = current_qty + p_change
  WHERE id = p_stock_item_id
  RETURNING current_qty INTO v_new_qty;

  -- 3) Devolver resumen
  RETURN jsonb_build_object(
    'movement_id', v_movement_id,
    'stock_item_id', p_stock_item_id,
    'change', p_change,
    'new_qty', v_new_qty,
    'reason', p_reason
  );
END;
$$;

COMMENT ON FUNCTION register_stock_movement IS 'Registra un movimiento de stock y actualiza current_qty en una transacción';

-- ============================================================================
-- FIN
-- ============================================================================
