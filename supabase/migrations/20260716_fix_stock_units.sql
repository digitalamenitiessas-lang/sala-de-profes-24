-- Corregir unidades incorrectas en stock_items
-- Aceite: kg → ml (×1000), Sal: kg → g (×1000), Especias: kg → g (×1000)
-- Las cantidades también se convierten proporcionalmente.

-- 1. ACEITE — siempre ml
UPDATE stock_items
SET
  unit      = 'ml',
  current_qty = current_qty * 1000,
  min_qty   = COALESCE(min_qty, 0) * 1000
WHERE
  unit = 'kg'
  AND name ILIKE '%aceite%';

-- 2. SAL — siempre gramos
UPDATE stock_items
SET
  unit      = 'g',
  current_qty = current_qty * 1000,
  min_qty   = COALESCE(min_qty, 0) * 1000
WHERE
  unit = 'kg'
  AND name ILIKE '%sal%';

-- 3. PIMIENTA — siempre gramos
UPDATE stock_items
SET
  unit      = 'g',
  current_qty = current_qty * 1000,
  min_qty   = COALESCE(min_qty, 0) * 1000
WHERE
  unit = 'kg'
  AND (
    name ILIKE '%pimienta%'
    OR name ILIKE '%pepper%'
  );

-- 4. ORÉGANO
UPDATE stock_items
SET
  unit      = 'g',
  current_qty = current_qty * 1000,
  min_qty   = COALESCE(min_qty, 0) * 1000
WHERE
  unit = 'kg'
  AND (
    name ILIKE '%orégano%'
    OR name ILIKE '%oregano%'
  );

-- 5. AJÍ MOLIDO / AJÍ ROJO
UPDATE stock_items
SET
  unit      = 'g',
  current_qty = current_qty * 1000,
  min_qty   = COALESCE(min_qty, 0) * 1000
WHERE
  unit = 'kg'
  AND (
    name ILIKE '%ají molido%'
    OR name ILIKE '%aji molido%'
    OR name ILIKE '%ají rojo%'
    OR name ILIKE '%aji rojo%'
  );

-- 6. ESPECIAS GENERALES (comino, pimentón, nuez moscada, cúrcuma, curry, canela, paprika)
UPDATE stock_items
SET
  unit      = 'g',
  current_qty = current_qty * 1000,
  min_qty   = COALESCE(min_qty, 0) * 1000
WHERE
  unit = 'kg'
  AND (
    name ILIKE '%comino%'
    OR name ILIKE '%pimentón%'
    OR name ILIKE '%pimenton%'
    OR name ILIKE '%nuez moscada%'
    OR name ILIKE '%cúrcuma%'
    OR name ILIKE '%curcuma%'
    OR name ILIKE '%curry%'
    OR name ILIKE '%canela%'
    OR name ILIKE '%paprika%'
    OR name ILIKE '%cayena%'
    OR name ILIKE '%tomillo%'
    OR name ILIKE '%romero%'
    OR name ILIKE '%albahaca%'
    OR name ILIKE '%perejil seco%'
    OR name ILIKE '%ajo en polvo%'
    OR name ILIKE '%cebolla en polvo%'
    OR name ILIKE '%apio%'
    OR name ILIKE '%laurel%'
    OR name ILIKE '%azafrán%'
    OR name ILIKE '%azafran%'
    OR name ILIKE '%anís%'
    OR name ILIKE '%anis%'
    OR name ILIKE '%cilantro%'
    OR name ILIKE '%fenogreco%'
    OR name ILIKE '%clavo%'
  );
