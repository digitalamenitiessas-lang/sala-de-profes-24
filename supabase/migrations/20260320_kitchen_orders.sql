-- Kitchen Orders: pedidos de mercadería/verdulería desde cocina hacia encargados
CREATE TABLE IF NOT EXISTS kitchen_orders (
  id bigserial PRIMARY KEY,
  product_name text NOT NULL,
  category text NOT NULL DEFAULT 'verduleria',
  quantity text NOT NULL,
  urgency text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal', 'alta', 'urgente')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ordered', 'received', 'cancelled')),
  note text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_status ON kitchen_orders(status);
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_created_by ON kitchen_orders(created_by);

ALTER TABLE kitchen_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY kitchen_orders_select ON kitchen_orders FOR SELECT USING (true);

CREATE POLICY kitchen_orders_insert ON kitchen_orders FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('chef', 'cocina', 'encargado'))
);

CREATE POLICY kitchen_orders_update ON kitchen_orders FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'encargado')
);

CREATE OR REPLACE TRIGGER set_kitchen_orders_updated_at
  BEFORE UPDATE ON kitchen_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
