-- ---------------------------------------------------------------------------
-- Sucursal 24 y Maipú: las migraciones 20260715_venue_location y
-- 20260718_venue_75m cargan la geocerca de LVE (Santa Fe 746). En esta base esa
-- fila haría fichar contra el otro local, así que se borra y la app usa las
-- variables NEXT_PUBLIC_VENUE_* (ver src/lib/attendance/venue.ts).
-- Para fijar la ubicación desde la base en vez de las variables:
--   insert into public.attendance_config (key, value) values ('location',
--     jsonb_build_object('lat', <lat>, 'lng', <lng>, 'radius_meters', 75,
--                        'name', 'La Vieja Escuela — 24 y Maipú'))
--   on conflict (key) do update set value = excluded.value, updated_at = now();
-- ---------------------------------------------------------------------------

delete from public.attendance_config
where key = 'location'
  and value->>'name' = 'La Vieja Escuela'
  and round((value->>'lat')::numeric, 3) = -26.819
  and round((value->>'lng')::numeric, 3) = -65.206;
