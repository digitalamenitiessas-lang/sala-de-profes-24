-- Add unique constraint on recipe_id + normalized_name for upsert
ALTER TABLE public.recipe_ingredient_pending_links
  DROP CONSTRAINT IF EXISTS recipe_ingredient_pending_links_recipe_slug_normalized_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_links_recipe_ingredient
  ON public.recipe_ingredient_pending_links(recipe_id, normalized_name)
  WHERE recipe_id IS NOT NULL;
