-- Rol de turno "cajero" (paso 1: el valor nuevo tiene que existir antes de usarse)
alter type public.app_role add value if not exists 'cajero';
