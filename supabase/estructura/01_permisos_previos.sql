-- Paso previo: apagar los permisos automáticos de Supabase en public para que
-- los GRANT explícitos del dump dejen la 24 con los MISMOS permisos que LVE.
-- El final del dump (ALTER DEFAULT PRIVILEGES FOR ROLE postgres ...) los vuelve a prender.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
