-- ---------------------------------------------------------------------------
-- Cajero: mismos permisos que el encargado, cobra $4.200 (pedido de Marco, 10/10)
-- ---------------------------------------------------------------------------
-- Para no tocar los ~150 lugares que revisan permisos, el cajero ES encargado
-- en profiles.role, y su puesto queda en profiles.puesto = 'cajero' (lo que se
-- muestra en el equipo y el rol por defecto de sus turnos). Sus turnos se
-- cargan con shift_role 'cajero' y la liquidación los paga a la tarifa cajero.
-- Elegir "cajero" como rol por cualquier camino (alta, ficha) se normaliza acá.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists puesto app_role;
comment on column public.profiles.puesto is 'Puesto visible cuando difiere del rol de permisos (cajero = permisos de encargado)';

create or replace function public.tg_profiles_cajero()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'cajero' then
    new.role := 'encargado';
    new.puesto := 'cajero';
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    -- Otro rol elegido a mano: deja de ser cajero
    new.puesto := null;
  end if;
  return new;
end
$$;

drop trigger if exists trg_profiles_cajero on public.profiles;
create trigger trg_profiles_cajero
  before insert or update of role on public.profiles
  for each row execute function public.tg_profiles_cajero();

insert into public.payroll_rates (role, hourly_rate, label) values ('cajero', 4200, 'Cajero')
on conflict (role) do update set hourly_rate = excluded.hourly_rate, label = excluded.label, updated_at = now();
