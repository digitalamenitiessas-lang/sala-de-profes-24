-- Seed bar stock items (skip if already populated)
INSERT INTO bar_stock_items (name, category, unit, current_qty, current_detail, min_level, is_urgent, sort_order)
SELECT * FROM (VALUES
  ('Leche entera',               'lacteos',          'lt',        27,   NULL::text,       20,  false, 10),
  ('Leche descremada',           'lacteos',          'lt',        33,   NULL::text,       20,  false, 20),
  ('Leche deslactosada',         'lacteos',          'unidades',   0,   NULL::text,        5,  true,  30),
  ('Café Oyambre Santos Finos',  'cafe',             'kg',          6,  '600g x 6 unid',  10,  true,  40),
  ('Té saquitos',                'insumos_oyambre',  'cajas',       1,  NULL::text,        2,  true,  50),
  ('Yerba mate',                 'insumos_oyambre',  'cajas',       1,  '26 unidades',     2,  false, 60),
  ('Nesquik',                    'insumos_oyambre',  'bolsas',      2,  NULL::text,        2,  false, 70),
  ('Cacao amargo',               'insumos_oyambre',  'gr',         70,  NULL::text,      200,  true,  80),
  ('Tableta cacao 70%',          'insumos_oyambre',  'unidades',    0,  NULL::text,        3,  true,  90),
  ('Edulcorante',                'insumos_oyambre',  'cajas',       0,  NULL::text,        2,  true,  100),
  ('Azúcar sobres',              'insumos_oyambre',  'cajas',       2,  '800 sobres/caja', 2,  false, 110),
  ('Submarino',                  'suministros',      'unidades',    0,  NULL::text,        5,  true,  120),
  ('Salsa chocolate',            'suministros',      'unidades',    0,  NULL::text,        2,  true,  130),
  ('Tónica',                     'suministros',      'unidades',    0,  NULL::text,        6,  true,  140),
  ('Tónica pomelo',              'suministros',      'unidades',    0,  NULL::text,        6,  true,  150),
  ('Vasos descartables 18oz',    'packaging',        'unidades',    0,  NULL::text,       50,  true,  160),
  ('Dispensador cinta adhesiva', 'libreria',         'unidades',    0,  NULL::text,        1,  true,  170),
  ('Marcador permanente negro',  'libreria',         'unidades',    0,  NULL::text,        2,  true,  180),
  ('Esponja XL',                 'libreria',         'unidades',    0,  NULL::text,        2,  true,  190),
  ('Papel fibra caña de azúcar', 'general',          'unidades',    0,  NULL::text,        1,  false, 200)
) AS t(name, category, unit, current_qty, current_detail, min_level, is_urgent, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM bar_stock_items LIMIT 1);
