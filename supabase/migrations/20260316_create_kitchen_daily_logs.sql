-- ==========================================================================
-- Migration: kitchen_daily_logs
-- Registro diario de necesidades de cocina por servicio
-- ==========================================================================

CREATE TABLE public.kitchen_daily_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operative_date date NOT NULL,
  service        text NOT NULL CHECK (service IN ('desayuno_merienda', 'almuerzo_cena')),
  items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes          text,
  status         text NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'enviado')),
  created_by     uuid NOT NULL REFERENCES public.profiles(id),
  submitted_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operative_date, service)
);

CREATE INDEX idx_kitchen_daily_logs_date ON public.kitchen_daily_logs (operative_date DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_kitchen_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_kitchen_daily_logs_updated_at
  BEFORE UPDATE ON public.kitchen_daily_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_kitchen_logs_updated_at();

-- RLS
ALTER TABLE public.kitchen_daily_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kitchen_logs_select" ON public.kitchen_daily_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('cocina', 'chef', 'encargado')
    )
  );

CREATE POLICY "kitchen_logs_insert" ON public.kitchen_daily_logs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('cocina', 'chef')
    )
    AND created_by = auth.uid()
  );

CREATE POLICY "kitchen_logs_update" ON public.kitchen_daily_logs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('cocina', 'chef')
    )
  );
