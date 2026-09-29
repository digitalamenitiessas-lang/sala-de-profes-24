-- ---------------------------------------------------------------------------
-- Sucursal 24 y Maipú — pasos posteriores al dump de estructura de LVE.
-- Corre en una sesión aparte (el dump deja search_path vacío) y en una sola
-- transacción: si algo falla no queda nada a medias.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

-- 1. Extensiones que usa check_attendance_anomalies (en LVE están en public).
create extension if not exists cube with schema extensions;
create extension if not exists earthdistance with schema extensions;

-- 2. Respaldos puntuales de LVE (28/07): sin RLS y abiertos a anon. No van en la 24.
drop table if exists public._backup_menu_items_20260728,
                     public._backup_recipe_ingredients_20260728,
                     public._backup_recipes_20260728;

-- 3. Auditoría: la política tenía el UUID de un usuario de LVE. Queda solo por rol.
drop policy if exists "audit_trail_select" on public.audit_trail;
create policy "audit_trail_select" on public.audit_trail
  for select using (public.auth_role() = 'socio');

-- 4. Stock de barra: las políticas no tenían TO, así que anon (sin sesión) podía
--    leer y escribir. Para usuarios logueados no cambia nada.
alter policy "bar_stock_items_insert" on public.bar_stock_items to authenticated;
alter policy "bar_stock_items_select" on public.bar_stock_items to authenticated;
alter policy "bar_stock_items_update" on public.bar_stock_items to authenticated;

-- 5. Vistas: respetan RLS del que consulta y no se leen sin sesión.
alter view public.v_today_attendance set (security_invoker = on);
alter view public.v_active_alerts set (security_invoker = on);
revoke all on public.v_today_attendance, public.v_active_alerts from anon;

-- 6. Alta de usuarios: el rol ya no sale de los metadatos que manda el cliente
--    (cualquiera podía registrarse como socio). La app crea usuarios con
--    admin.createUser y después hace upsert del perfil con el rol elegido.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', 'Sin'),
    coalesce(new.raw_user_meta_data->>'last_name', 'Nombre'),
    'barista'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 7. Un usuario sin perfil solo puede crearse el suyo como barista.
alter policy "profiles_insert" on public.profiles
  with check (id = auth.uid() and role = 'barista');

-- 8. Rol y estado (activo/inactivo) solo los cambia un encargado o socio.
--    Antes cualquiera podía hacerse socio con un update de su propio perfil.
--    El servidor (service_role, sin auth.uid()) sigue pudiendo todo.
create or replace function public.profiles_proteger_rol() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and auth.uid() is not null
     and not exists (
       select 1 from public.profiles
       where id = auth.uid() and role in ('encargado', 'socio')
     )
  then
    raise exception 'Solo un encargado o socio puede cambiar el rol o el estado de un perfil';
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_proteger_rol() from public, anon, authenticated;
drop trigger if exists trg_profiles_proteger_rol on public.profiles;
create trigger trg_profiles_proteger_rol
  before update on public.profiles
  for each row execute function public.profiles_proteger_rol();

-- 9. Trigger que crea el perfil de cada usuario nuevo (vive en auth, el dump no lo trae).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 10. Perfil de socio para el usuario que ya existía antes del trigger.
insert into public.profiles (id, first_name, last_name, role, is_active)
select u.id,
       coalesce(nullif(u.raw_user_meta_data->>'first_name', ''), initcap(split_part(u.email, '@', 1))),
       coalesce(nullif(u.raw_user_meta_data->>'last_name', ''), 'Socio'),
       'socio', true
from auth.users u
on conflict (id) do update set role = 'socio', is_active = true, updated_at = now();

-- 11. Bucket de fotos de protocolos (privado, solo lo usa el servidor).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('protocolos', 'protocolos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- 12. Tiempo real, igual que LVE.
alter publication supabase_realtime add table public.announcements, public.stock_alerts;

-- 13. Que la API vea las tablas nuevas.
notify pgrst, 'reload schema';
