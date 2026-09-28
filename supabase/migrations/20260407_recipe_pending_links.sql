-- Add slug column to recipes
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS slug text UNIQUE;

-- Create index on slug
CREATE INDEX IF NOT EXISTS idx_recipes_slug ON public.recipes(slug) WHERE slug IS NOT NULL;

-- Create pending links table for ingredient resolution workflow
CREATE TABLE IF NOT EXISTS public.recipe_ingredient_pending_links (
  id bigserial PRIMARY KEY,
  recipe_id uuid REFERENCES public.recipes(id) ON DELETE CASCADE,
  recipe_name text NOT NULL,
  recipe_slug text NOT NULL,
  ingredient_name text NOT NULL,
  normalized_name text NOT NULL,
  cantidad numeric,
  unidad text,
  match_confidence text NOT NULL DEFAULT 'sin_match',
  match_score integer DEFAULT 0,
  suggested_stock_item_id uuid REFERENCES public.stock_items(id),
  suggested_stock_item_name text,
  match_reasons text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  resolved_stock_item_id uuid REFERENCES public.stock_items(id),
  resolved_qty_per_portion numeric,
  resolved_unit text,
  resolved_by uuid REFERENCES public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(recipe_slug, normalized_name)
);

-- Enable RLS
ALTER TABLE public.recipe_ingredient_pending_links ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Authenticated can read pending links"
  ON public.recipe_ingredient_pending_links
  FOR SELECT TO authenticated USING (true);

-- Allow encargado/socio to insert/update
CREATE POLICY "Admins can manage pending links"
  ON public.recipe_ingredient_pending_links
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('socio', 'encargado')
    )
  );

-- Add ingredient_unit to recipe_ingredients if missing
ALTER TABLE public.recipe_ingredients ADD COLUMN IF NOT EXISTS ingredient_unit text;
ALTER TABLE public.recipe_ingredients ADD COLUMN IF NOT EXISTS notes text;
