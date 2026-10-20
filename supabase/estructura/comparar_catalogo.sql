-- ---------------------------------------------------------------------------
-- Catálogo normalizado de la base (solo lectura): columnas, funciones, políticas,
-- triggers, índices, restricciones, vistas, RLS, permisos por rol, enums, buckets,
-- realtime y relojes. Sirve para comparar LVE contra la 24 con diff:
--   psql "$LVE_DB_URL"      -X -A -t -f comparar_catalogo.sql > lve.txt
--   psql "$SUPABASE_DB_URL" -X -A -t -f comparar_catalogo.sql > 24.txt
--   diff lve.txt 24.txt
-- ---------------------------------------------------------------------------
set session characteristics as transaction read only;
select 'COL '||c.relname||'.'||a.attname||' '||format_type(a.atttypid,a.atttypmod)||case when a.attnotnull then ' NN' else '' end||coalesce(' D='||pg_get_expr(d.adbin,d.adrelid),'')
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and c.relkind in ('r','v','p') and a.attnum>0 and not a.attisdropped
union all select 'FUN '||p.oid::regprocedure::text||' secdef='||p.prosecdef||' cfg='||coalesce(array_to_string(p.proconfig,','),'-')||' md5='||md5(p.prosrc)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
union all select 'POL '||tablename||'.'||policyname||' '||cmd||' '||array_to_string(roles,',')||' U='||coalesce(qual,'-')||' C='||coalesce(with_check,'-') from pg_policies where schemaname='public'
union all select 'TRG '||c.relname||'.'||t.tgname||' '||md5(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
union all select 'IDX '||indexname||' '||md5(indexdef) from pg_indexes where schemaname='public'
union all select 'CON '||conrelid::regclass::text||'.'||conname||' '||md5(pg_get_constraintdef(oid)) from pg_constraint where connamespace='public'::regnamespace
union all select 'VIEW '||c.relname||' opts='||coalesce(array_to_string(c.reloptions,','),'-')||' '||md5(pg_get_viewdef(c.oid)) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='v'
union all select 'RLS '||relname||' '||relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'
union all select 'ACL-T '||c.relname||' '||r.rol||' '||array_to_string(array(select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege(r.rol, c.oid, p)),',')
  from pg_class c cross join (values ('anon'),('authenticated'),('service_role')) r(rol) where c.relnamespace='public'::regnamespace and c.relkind in ('r','v')
union all select 'ACL-F '||p.oid::regprocedure::text||' '||r.rol||' '||has_function_privilege(r.rol, p.oid, 'EXECUTE')
  from pg_proc p cross join (values ('anon'),('authenticated'),('service_role')) r(rol) where p.pronamespace='public'::regnamespace and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
union all select 'ACL-S '||c.relname||' '||r.rol||' '||has_sequence_privilege(r.rol, c.oid, 'USAGE') from pg_class c cross join (values ('anon'),('authenticated'),('service_role')) r(rol) where c.relnamespace='public'::regnamespace and c.relkind='S'
union all select 'ENUM '||t.typname||' '||string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by t.typname
union all select 'AUTH-TRG '||tgname||' '||tgfoid::regproc::text from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal
union all select 'BUCKET '||id||' public='||public||' limit='||coalesce(file_size_limit::text,'-')||' mime='||coalesce(array_to_string(allowed_mime_types,','),'-') from storage.buckets
union all select 'STORAGE-POL '||policyname||' '||cmd||' '||array_to_string(roles,',')||' U='||coalesce(qual,'-')||' C='||coalesce(with_check,'-') from pg_policies where schemaname='storage'
union all select 'RT '||schemaname||'.'||tablename from pg_publication_tables where pubname='supabase_realtime'
union all select 'CRON '||jobname||' ['||schedule||'] '||regexp_replace(regexp_replace(command, 'https://([a-z0-9.-]+\.vercel\.app|lve24\.com\.ar)', 'https://<APP>', 'g'), '\s+', ' ', 'g') from cron.job
order by 1;
