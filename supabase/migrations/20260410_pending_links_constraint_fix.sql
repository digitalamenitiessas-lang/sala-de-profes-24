-- Drop partial index (doesn't work with upsert)
DROP INDEX IF EXISTS uq_pending_links_recipe_ingredient;

-- Add proper unique constraint
ALTER TABLE public.recipe_ingredient_pending_links
  ADD CONSTRAINT uq_pending_recipe_ingredient UNIQUE (recipe_id, normalized_name);
