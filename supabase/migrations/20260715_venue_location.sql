-- Actualizar coordenadas del local en attendance_config
-- La Vieja Escuela — Sta. Fe 746, San Miguel de Tucumán
-- Coordenadas verificadas: OSM Nominatim -26.8194712, -65.2056626
-- Radio: 200m (contempla GPS drift en interiores)

INSERT INTO attendance_config (key, value, updated_at, updated_by)
VALUES (
  'location',
  jsonb_build_object(
    'lat',            -26.8194712,
    'lng',            -65.2056626,
    'radius_meters',  200,
    'name',           'La Vieja Escuela'
  ),
  NOW(),
  NULL
)
ON CONFLICT (key) DO UPDATE SET
  value      = EXCLUDED.value,
  updated_at = NOW();
