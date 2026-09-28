-- ============================================================
-- Production Module — tables and RPCs
-- ============================================================

-- Production templates (e.g. "Bollitos", "Milanesas")
CREATE TABLE IF NOT EXISTS public.production_templates (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  description text,
  recipe_id uuid REFERENCES public.recipes(id),
  default_input_stock_item_id uuid REFERENCES public.stock_items(id),
  default_input_unit text DEFAULT 'kg',
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Template outputs (what a production creates)
CREATE TABLE IF NOT EXISTS public.production_template_outputs (
  id bigserial PRIMARY KEY,
  template_id bigint NOT NULL REFERENCES public.production_templates(id) ON DELETE CASCADE,
  stock_item_id uuid REFERENCES public.stock_items(id),
  output_name text NOT NULL,
  output_unit text NOT NULL DEFAULT 'unidad',
  theoretical_yield_pct numeric NOT NULL DEFAULT 100,
  is_waste boolean DEFAULT false,
  notes text,
  sort_order int DEFAULT 0
);

-- Production orders (a specific batch)
CREATE TABLE IF NOT EXISTS public.production_orders (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  template_id bigint REFERENCES public.production_templates(id),
  parent_order_id bigint REFERENCES public.production_orders(id),
  chef_id uuid REFERENCES public.profiles(id),
  notes text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Production inputs (raw materials used)
CREATE TABLE IF NOT EXISTS public.production_inputs (
  id bigserial PRIMARY KEY,
  production_order_id bigint NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  stock_item_id uuid REFERENCES public.stock_items(id),
  qty_used numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'kg',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Production outputs (finished goods + waste)
CREATE TABLE IF NOT EXISTS public.production_outputs (
  id bigserial PRIMARY KEY,
  production_order_id bigint NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  stock_item_id uuid REFERENCES public.stock_items(id),
  output_name text NOT NULL,
  qty_produced numeric NOT NULL DEFAULT 0,
  theoretical_qty numeric,
  unit text NOT NULL DEFAULT 'unidad',
  is_waste boolean DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.production_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_template_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_outputs ENABLE ROW LEVEL SECURITY;

-- Read: all authenticated
CREATE POLICY "read_production_templates" ON public.production_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_production_template_outputs" ON public.production_template_outputs FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_production_orders" ON public.production_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_production_inputs" ON public.production_inputs FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_production_outputs" ON public.production_outputs FOR SELECT TO authenticated USING (true);

-- Write: chef+ roles
CREATE POLICY "manage_production_templates" ON public.production_templates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('socio','encargado','chef')));
CREATE POLICY "manage_production_template_outputs" ON public.production_template_outputs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('socio','encargado','chef')));
CREATE POLICY "manage_production_orders" ON public.production_orders FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('socio','encargado','chef','cocina')));
CREATE POLICY "manage_production_inputs" ON public.production_inputs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('socio','encargado','chef','cocina')));
CREATE POLICY "manage_production_outputs" ON public.production_outputs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('socio','encargado','chef','cocina')));

-- ============================================================
-- production_dashboard RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.production_dashboard(p_days integer DEFAULT 30)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result json;
  since timestamptz := now() - (p_days || ' days')::interval;
BEGIN
  SELECT json_build_object(
    'period_days', p_days,
    'total_completed', COALESCE((
      SELECT count(*) FROM production_orders
      WHERE status = 'completed' AND completed_at >= since
    ), 0),
    'total_input_kg', (
      SELECT COALESCE(sum(qty_used), 0) FROM production_inputs pi
      JOIN production_orders o ON o.id = pi.production_order_id
      WHERE o.status = 'completed' AND o.completed_at >= since
    ),
    'total_waste_kg', (
      SELECT COALESCE(sum(qty_produced), 0) FROM production_outputs po
      JOIN production_orders o ON o.id = po.production_order_id
      WHERE o.status = 'completed' AND o.completed_at >= since AND po.is_waste = true
    ),
    'avg_efficiency_pct', (
      SELECT CASE
        WHEN sum(pi_sub.total_input) > 0 THEN
          round((1 - sum(po_sub.total_waste) / sum(pi_sub.total_input)) * 100, 1)
        ELSE null
      END
      FROM production_orders o
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(qty_used), 0) as total_input
        FROM production_inputs WHERE production_order_id = o.id
      ) pi_sub ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(qty_produced), 0) as total_waste
        FROM production_outputs WHERE production_order_id = o.id AND is_waste = true
      ) po_sub ON true
      WHERE o.status = 'completed' AND o.completed_at >= since
    ),
    'pending_orders', COALESCE((
      SELECT count(*) FROM production_orders
      WHERE status IN ('draft', 'in_progress')
    ), 0),
    'by_chef', COALESCE((
      SELECT json_agg(row_to_json(t)) FROM (
        SELECT
          o.chef_id,
          COALESCE(p.first_name || ' ' || p.last_name, 'Sin asignar') as chef_name,
          count(*) as total_orders,
          round(avg(
            CASE WHEN pi_sub.total_input > 0
              THEN (1 - po_sub.total_waste / pi_sub.total_input) * 100
              ELSE null
            END
          ), 1) as avg_efficiency,
          COALESCE(sum(po_sub.total_waste), 0) as total_waste
        FROM production_orders o
        LEFT JOIN profiles p ON p.id = o.chef_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(sum(qty_used), 0) as total_input
          FROM production_inputs WHERE production_order_id = o.id
        ) pi_sub ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(sum(qty_produced), 0) as total_waste
          FROM production_outputs WHERE production_order_id = o.id AND is_waste = true
        ) po_sub ON true
        WHERE o.status = 'completed' AND o.completed_at >= since
        GROUP BY o.chef_id, p.first_name, p.last_name
        ORDER BY count(*) DESC
      ) t
    ), '[]'::json),
    'daily', COALESCE((
      SELECT json_agg(row_to_json(t)) FROM (
        SELECT
          o.completed_at::date as day,
          count(*) as orders,
          null::numeric as avg_efficiency
        FROM production_orders o
        WHERE o.status = 'completed' AND o.completed_at >= since
        GROUP BY o.completed_at::date
        ORDER BY day DESC
        LIMIT 30
      ) t
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;
