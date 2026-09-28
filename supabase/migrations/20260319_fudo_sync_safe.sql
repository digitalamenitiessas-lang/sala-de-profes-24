-- ============================================================================
-- MIGRACIÓN SEGURA: Preparar tablas para sync con Fudo
-- Fecha: 2026-03-19
-- ============================================================================
-- ✅ NO borra datos existentes
-- ✅ Agrega columnas Fudo a menu_items existente
-- ✅ Crea menu_categories y fudo_sales si no existen
-- ✅ Crea stock_movements si no existe
-- ✅ Crea recipe_ingredients si no existe
-- ✅ Agrega columnas faltantes a suppliers y stock_items
-- ============================================================================

-- ============================================================================
-- 1) menu_categories — Categorías sincronizadas con Fudo
-- ============================================================================
CREATE TABLE IF NOT EXISTS menu_categories (
  id               bigserial    PRIMARY KEY,
  name             text         NOT NULL,
  fudo_category_id text,
  sort_order       integer      DEFAULT 0,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  menu_categories IS 'Categorías de la carta, sincronizables con Fudo';
CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_categories_fudo_unique
  ON menu_categories (fudo_category_id) WHERE fudo_category_id IS NOT NULL;

-- ============================================================================
-- 2) Agregar columnas Fudo a menu_items existente (uuid PKs)
-- ============================================================================
-- fudo_product_id: link al producto en Fudo
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'menu_items' AND column_name = 'fudo_product_id'
  ) THEN
    ALTER TABLE menu_items ADD COLUMN fudo_product_id text;
    CREATE UNIQUE INDEX idx_menu_items_fudo_unique
      ON menu_items (fudo_product_id) WHERE fudo_product_id IS NOT NULL;
  END IF;
END $$;

-- sale_price: precio de venta (viene de Fudo)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'menu_items' AND column_name = 'sale_price'
  ) THEN
    ALTER TABLE menu_items ADD COLUMN sale_price numeric DEFAULT 0;
  END IF;
END $$;

-- menu_category_id: FK a menu_categories
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'menu_items' AND column_name = 'menu_category_id'
  ) THEN
    ALTER TABLE menu_items ADD COLUMN menu_category_id bigint
      REFERENCES menu_categories(id) ON UPDATE CASCADE ON DELETE SET NULL;
    CREATE INDEX idx_menu_items_menu_category ON menu_items (menu_category_id);
  END IF;
END $$;

-- ============================================================================
-- 3) fudo_sales — Ventas importadas desde Fudo
-- ============================================================================
CREATE TABLE IF NOT EXISTS fudo_sales (
  id              bigserial    PRIMARY KEY,
  fudo_ticket_id  text         NOT NULL,
  fudo_product_id text         NOT NULL,
  quantity        numeric      NOT NULL DEFAULT 0,
  sold_at         timestamptz  NOT NULL,
  raw_payload     jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (fudo_ticket_id, fudo_product_id)
);

COMMENT ON TABLE fudo_sales IS 'Ventas importadas desde Fudo (una fila por producto por ticket)';
CREATE INDEX IF NOT EXISTS idx_fudo_sales_product  ON fudo_sales (fudo_product_id);
CREATE INDEX IF NOT EXISTS idx_fudo_sales_sold_at  ON fudo_sales (sold_at);

-- ============================================================================
-- 4) Asegurar columnas en suppliers
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'suppliers' AND column_name = 'contact_name'
  ) THEN
    ALTER TABLE suppliers ADD COLUMN contact_name text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'suppliers' AND column_name = 'phone'
  ) THEN
    ALTER TABLE suppliers ADD COLUMN phone text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'suppliers' AND column_name = 'email'
  ) THEN
    ALTER TABLE suppliers ADD COLUMN email text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'suppliers' AND column_name = 'notes'
  ) THEN
    ALTER TABLE suppliers ADD COLUMN notes text;
  END IF;
END $$;

-- ============================================================================
-- 5) Asegurar columnas en stock_items
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_items' AND column_name = 'fudo_product_id'
  ) THEN
    ALTER TABLE stock_items ADD COLUMN fudo_product_id text;
    CREATE INDEX idx_stock_items_fudo ON stock_items (fudo_product_id)
      WHERE fudo_product_id IS NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_items' AND column_name = 'cost_per_unit'
  ) THEN
    ALTER TABLE stock_items ADD COLUMN cost_per_unit numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_items' AND column_name = 'shelf_life_days'
  ) THEN
    ALTER TABLE stock_items ADD COLUMN shelf_life_days integer;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_items' AND column_name = 'supplier_id'
  ) THEN
    ALTER TABLE stock_items ADD COLUMN supplier_id bigint
      REFERENCES suppliers(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- 6) recipe_ingredients (si no existe)
-- ============================================================================
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id             bigserial    PRIMARY KEY,
  recipe_id      bigint       NOT NULL,
  stock_item_id  bigint       NOT NULL,
  qty_per_portion numeric     NOT NULL DEFAULT 0,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, stock_item_id)
);

-- ============================================================================
-- 7) stock_movements (si no existe)
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id              bigserial    PRIMARY KEY,
  stock_item_id   bigint       NOT NULL,
  change          numeric      NOT NULL,
  reason          text         NOT NULL,
  reference_type  text,
  reference_id    text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  created_by      uuid
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements (stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements (created_at);

-- ============================================================================
-- 8) RLS para las nuevas tablas
-- ============================================================================

-- menu_categories
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "menu_categories_select" ON menu_categories;
CREATE POLICY "menu_categories_select" ON menu_categories FOR SELECT USING (true);
DROP POLICY IF EXISTS "menu_categories_insert" ON menu_categories;
CREATE POLICY "menu_categories_insert" ON menu_categories FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "menu_categories_update" ON menu_categories;
CREATE POLICY "menu_categories_update" ON menu_categories FOR UPDATE USING (true);

-- fudo_sales
ALTER TABLE fudo_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fudo_sales_select" ON fudo_sales;
CREATE POLICY "fudo_sales_select" ON fudo_sales FOR SELECT USING (true);
DROP POLICY IF EXISTS "fudo_sales_insert" ON fudo_sales;
CREATE POLICY "fudo_sales_insert" ON fudo_sales FOR INSERT WITH CHECK (true);

-- stock_movements
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_movements_select" ON stock_movements;
CREATE POLICY "stock_movements_select" ON stock_movements FOR SELECT USING (true);
DROP POLICY IF EXISTS "stock_movements_insert" ON stock_movements;
CREATE POLICY "stock_movements_insert" ON stock_movements FOR INSERT WITH CHECK (true);

-- recipe_ingredients
ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recipe_ingredients_select" ON recipe_ingredients;
CREATE POLICY "recipe_ingredients_select" ON recipe_ingredients FOR SELECT USING (true);
DROP POLICY IF EXISTS "recipe_ingredients_insert" ON recipe_ingredients;
CREATE POLICY "recipe_ingredients_insert" ON recipe_ingredients FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "recipe_ingredients_update" ON recipe_ingredients;
CREATE POLICY "recipe_ingredients_update" ON recipe_ingredients FOR UPDATE USING (true);

-- ============================================================================
-- 9) Triggers updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_menu_categories_updated_at ON menu_categories;
CREATE TRIGGER trg_menu_categories_updated_at
  BEFORE UPDATE ON menu_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 10) Bar operations tables (si no existen)
-- ============================================================================
CREATE TABLE IF NOT EXISTS bar_stock_items (
  id           bigserial    PRIMARY KEY,
  name         text         NOT NULL,
  category     text         NOT NULL DEFAULT 'other'
                            CHECK (category IN (
                              'coffee','tea','milk','sweetener','disposable',
                              'bakery','extra','cleaning','other'
                            )),
  unit         text         NOT NULL DEFAULT 'unidades',
  current_qty  numeric      NOT NULL DEFAULT 0,
  current_detail text,
  min_level    numeric      NOT NULL DEFAULT 0,
  is_urgent    boolean      NOT NULL DEFAULT false,
  is_active    boolean      NOT NULL DEFAULT true,
  sort_order   integer      NOT NULL DEFAULT 0,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_orders (
  id           bigserial    PRIMARY KEY,
  product_name text         NOT NULL,
  category     text         NOT NULL DEFAULT 'other',
  quantity     text         NOT NULL DEFAULT '1',
  urgency      text         NOT NULL DEFAULT 'normal'
                            CHECK (urgency IN ('low','normal','high','critical')),
  status       text         NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','ordered','received','cancelled')),
  note         text,
  requested_by uuid,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

-- RLS for bar tables
ALTER TABLE bar_stock_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bar_stock_items_select" ON bar_stock_items;
CREATE POLICY "bar_stock_items_select" ON bar_stock_items FOR SELECT USING (true);
DROP POLICY IF EXISTS "bar_stock_items_insert" ON bar_stock_items;
CREATE POLICY "bar_stock_items_insert" ON bar_stock_items FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "bar_stock_items_update" ON bar_stock_items;
CREATE POLICY "bar_stock_items_update" ON bar_stock_items FOR UPDATE USING (true);

ALTER TABLE bar_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bar_orders_select" ON bar_orders;
CREATE POLICY "bar_orders_select" ON bar_orders FOR SELECT USING (true);
DROP POLICY IF EXISTS "bar_orders_insert" ON bar_orders;
CREATE POLICY "bar_orders_insert" ON bar_orders FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "bar_orders_update" ON bar_orders;
CREATE POLICY "bar_orders_update" ON bar_orders FOR UPDATE USING (true);

-- ============================================================================
-- FIN — Ahora ejecutar POST /api/fudo/sync/products para importar
-- ============================================================================
