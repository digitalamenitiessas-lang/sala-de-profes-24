-- ============================================================================
-- MIGRACIÓN: Sistema operativo de Barra / Cafetería
-- Fecha: 2026-03-19
-- ============================================================================

CREATE TABLE bar_stock_items (
  id              bigserial    PRIMARY KEY,
  name            text         NOT NULL,
  category        text         NOT NULL DEFAULT 'general'
                               CHECK (category IN ('lacteos', 'cafe', 'packaging', 'suministros', 'insumos_oyambre', 'libreria', 'general')),
  unit            text         NOT NULL DEFAULT 'unidades',
  current_qty     numeric      NOT NULL DEFAULT 0,
  current_detail  text,
  min_level       numeric      NOT NULL DEFAULT 0,
  is_urgent       boolean      NOT NULL DEFAULT false,
  is_active       boolean      NOT NULL DEFAULT true,
  sort_order      integer      NOT NULL DEFAULT 0,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE bar_orders (
  id              bigserial    PRIMARY KEY,
  bar_stock_item_id bigint     REFERENCES bar_stock_items(id) ON DELETE CASCADE,
  product_name    text         NOT NULL,
  category        text         NOT NULL DEFAULT 'general',
  quantity        text         NOT NULL,
  urgency         text         NOT NULL DEFAULT 'normal'
                               CHECK (urgency IN ('normal', 'alta', 'urgente')),
  status          text         NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'ordered', 'received', 'cancelled')),
  note            text,
  created_by      uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_bar_stock_active ON bar_stock_items (category) WHERE is_active = true;
CREATE INDEX idx_bar_orders_status ON bar_orders (status) WHERE status = 'pending';

CREATE TRIGGER trg_bar_stock_items_updated_at BEFORE UPDATE ON bar_stock_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_bar_orders_updated_at BEFORE UPDATE ON bar_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE bar_stock_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bar_stock_select" ON bar_stock_items FOR SELECT USING (true);
CREATE POLICY "bar_stock_insert" ON bar_stock_items FOR INSERT WITH CHECK (auth_role() IN ('encargado', 'chef', 'barista'));
CREATE POLICY "bar_stock_update" ON bar_stock_items FOR UPDATE USING (auth_role() IN ('encargado', 'chef', 'barista'));

ALTER TABLE bar_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bar_orders_select" ON bar_orders FOR SELECT USING (true);
CREATE POLICY "bar_orders_insert" ON bar_orders FOR INSERT WITH CHECK (auth_role() IN ('encargado', 'chef', 'barista'));
CREATE POLICY "bar_orders_update" ON bar_orders FOR UPDATE USING (auth_role() IN ('encargado', 'chef', 'barista'));
