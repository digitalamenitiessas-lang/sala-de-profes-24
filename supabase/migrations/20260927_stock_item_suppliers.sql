-- ---------------------------------------------------------------------------
-- Vínculos producto ↔ proveedor (muchos a muchos, con evidencia de Fudo)
-- ---------------------------------------------------------------------------
-- Un insumo puede comprarse a varios proveedores (en Fudo, 121 ingredientes
-- tienen compras a más de uno). Cada vínculo guarda:
--   · is_primary     → el proveedor al que se le pide por defecto. Hay como
--                      mucho uno por insumo y se refleja en
--                      stock_items.supplier_id, que es lo que leen pedidos,
--                      sugerencias y el copiloto (no cambian).
--   · fudo_purchases / last_purchase_at → evidencia real del módulo de
--                      gastos de Fudo (la API de Fudo no tiene un vínculo
--                      ingrediente→proveedor; lo que sí tiene son compras).
--   · confirmed_*    → un encargado/socio lo revisó.
--   · dismissed_*    → un encargado/socio lo descartó: el sync de Fudo no lo
--                      revive salvo que haya compras NUEVAS a ese proveedor.
--
-- Escrituras: solo por set_supplier_links() (encargado/socio, atómico, con
-- auditoría) o por service role (sync de Fudo). No hay policies de escritura.
-- ---------------------------------------------------------------------------

create table if not exists public.stock_item_suppliers (
  stock_item_id    uuid        not null references public.stock_items(id) on delete cascade,
  supplier_id      uuid        not null references public.suppliers(id)   on delete cascade,
  is_primary       boolean     not null default false,
  source           text        not null default 'manual' check (source in ('manual', 'fudo', 'legacy')),
  fudo_purchases   integer     not null default 0 check (fudo_purchases >= 0),
  last_purchase_at timestamptz,
  confirmed_by     uuid        references public.profiles(id) on delete set null,
  confirmed_at     timestamptz,
  dismissed_by     uuid        references public.profiles(id) on delete set null,
  dismissed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (stock_item_id, supplier_id),
  constraint stock_item_suppliers_primary_not_dismissed check (not (is_primary and dismissed_at is not null))
);

create unique index if not exists stock_item_suppliers_one_primary
  on public.stock_item_suppliers (stock_item_id) where is_primary;
create index if not exists stock_item_suppliers_supplier
  on public.stock_item_suppliers (supplier_id);

comment on table public.stock_item_suppliers is
  'Vínculos insumo↔proveedor. is_primary se refleja en stock_items.supplier_id. Evidencia desde gastos de Fudo.';

alter table public.stock_item_suppliers enable row level security;

drop policy if exists stock_item_suppliers_select on public.stock_item_suppliers;
create policy stock_item_suppliers_select on public.stock_item_suppliers
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Backfill: lo que ya estaba vinculado pasa a ser el primario.
-- ---------------------------------------------------------------------------
insert into public.stock_item_suppliers (stock_item_id, supplier_id, is_primary, source)
select si.id, si.supplier_id, true, 'legacy'
from public.stock_items si
join public.suppliers s on s.id = si.supplier_id
where si.supplier_id is not null
on conflict (stock_item_id, supplier_id) do nothing;

-- ---------------------------------------------------------------------------
-- Sincronía en ambos sentidos con stock_items.supplier_id.
-- pg_trigger_depth() corta el rebote entre los dos triggers.
-- ---------------------------------------------------------------------------

-- vínculos → stock_items.supplier_id
create or replace function public.sync_primary_supplier_to_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_item uuid := coalesce(new.stock_item_id, old.stock_item_id);
  v_primary uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  select supplier_id into v_primary
  from stock_item_suppliers
  where stock_item_id = v_item and is_primary
  limit 1;
  update stock_items
     set supplier_id = v_primary, updated_at = now()
   where id = v_item and supplier_id is distinct from v_primary;
  return null;
end $$;

drop trigger if exists trg_sis_sync_item on public.stock_item_suppliers;
create trigger trg_sis_sync_item
  after insert or update of is_primary or delete on public.stock_item_suppliers
  for each row execute function public.sync_primary_supplier_to_item();

-- stock_items.supplier_id (escritores viejos: pedidos, chatbot, alta desde Fudo) → vínculos
create or replace function public.sync_item_supplier_to_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id then return null; end if;

  update stock_item_suppliers
     set is_primary = false, updated_at = now()
   where stock_item_id = new.id and is_primary
     and supplier_id is distinct from new.supplier_id;

  if new.supplier_id is not null then
    insert into stock_item_suppliers (stock_item_id, supplier_id, is_primary, source)
    values (new.id, new.supplier_id, true, 'manual')
    on conflict (stock_item_id, supplier_id) do update
      set is_primary = true, dismissed_at = null, dismissed_by = null, updated_at = now();
  end if;
  return null;
end $$;

drop trigger if exists trg_item_supplier_links on public.stock_items;
create trigger trg_item_supplier_links
  after insert or update of supplier_id on public.stock_items
  for each row execute function public.sync_item_supplier_to_links();

-- ---------------------------------------------------------------------------
-- set_supplier_links(p_changes) — única vía de escritura para usuarios.
-- p_changes: [{ item_id, supplier_id, op }] con op:
--   'primary' → pasa a ser el proveedor principal (crea el vínculo si falta)
--   'add'     → proveedor alternativo (principal si el insumo no tenía)
--   'confirm' → "está bien así": marca el vínculo como revisado
--   'remove'  → lo descarta; si era el principal, asciende la mejor alternativa
-- Todo o nada, con auditoría.
-- ---------------------------------------------------------------------------
create or replace function public.set_supplier_links(p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  c      jsonb;
  v_item uuid;
  v_sup  uuid;
  v_op   text;
  v_n    integer := 0;
begin
  if not is_encargado() then
    raise exception 'Solo encargados y socios pueden vincular proveedores' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array'
     or jsonb_array_length(p_changes) = 0 or jsonb_array_length(p_changes) > 500 then
    raise exception 'Cambios inválidos (entre 1 y 500)' using errcode = '22023';
  end if;

  select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    into v_name from profiles where id = v_uid;

  for c in select * from jsonb_array_elements(p_changes) loop
    v_item := (c ->> 'item_id')::uuid;
    v_sup  := (c ->> 'supplier_id')::uuid;
    v_op   := c ->> 'op';

    if v_item is null or v_sup is null then
      raise exception 'Falta item_id o supplier_id' using errcode = '22023';
    end if;
    if not exists (select 1 from stock_items where id = v_item and is_active) then
      raise exception 'El insumo % no existe o está inactivo', v_item using errcode = '22023';
    end if;
    if v_op in ('primary', 'add') and not exists (select 1 from suppliers where id = v_sup and is_active) then
      raise exception 'El proveedor % no existe o está inactivo', v_sup using errcode = '22023';
    end if;

    if v_op = 'primary' then
      update stock_item_suppliers set is_primary = false, updated_at = now()
       where stock_item_id = v_item and is_primary and supplier_id <> v_sup;
      insert into stock_item_suppliers (stock_item_id, supplier_id, is_primary, source, confirmed_by, confirmed_at)
      values (v_item, v_sup, true, 'manual', v_uid, now())
      on conflict (stock_item_id, supplier_id) do update
        set is_primary = true, dismissed_at = null, dismissed_by = null,
            confirmed_by = v_uid, confirmed_at = now(), updated_at = now();

    elsif v_op = 'add' then
      insert into stock_item_suppliers (stock_item_id, supplier_id, is_primary, source, confirmed_by, confirmed_at)
      values (
        v_item, v_sup,
        not exists (select 1 from stock_item_suppliers where stock_item_id = v_item and is_primary),
        'manual', v_uid, now()
      )
      on conflict (stock_item_id, supplier_id) do update
        set dismissed_at = null, dismissed_by = null,
            confirmed_by = v_uid, confirmed_at = now(), updated_at = now();

    elsif v_op = 'confirm' then
      update stock_item_suppliers
         set confirmed_by = v_uid, confirmed_at = now(), updated_at = now()
       where stock_item_id = v_item and supplier_id = v_sup and dismissed_at is null;
      if not found then
        raise exception 'No existe ese vínculo para confirmar' using errcode = '22023';
      end if;

    elsif v_op = 'remove' then
      update stock_item_suppliers
         set is_primary = false, dismissed_by = v_uid, dismissed_at = now(), updated_at = now()
       where stock_item_id = v_item and supplier_id = v_sup and dismissed_at is null;
      -- Si quedó sin principal, asciende la alternativa con más compras en Fudo.
      if not exists (select 1 from stock_item_suppliers where stock_item_id = v_item and is_primary) then
        update stock_item_suppliers set is_primary = true, updated_at = now()
         where (stock_item_id, supplier_id) = (
           select stock_item_id, supplier_id from stock_item_suppliers
            where stock_item_id = v_item and dismissed_at is null
            order by fudo_purchases desc, last_purchase_at desc nulls last, created_at
            limit 1
         );
      end if;

    else
      raise exception 'Operación inválida: %', v_op using errcode = '22023';
    end if;

    v_n := v_n + 1;
  end loop;

  insert into audit_trail (user_id, user_name, action, module, entity_type, entity_id, description, metadata)
  values (
    v_uid, v_name, 'set_supplier_links', 'proveedores', 'stock_item',
    case when v_n = 1 then v_item::text end,
    format('%s actualizó %s vínculo%s producto–proveedor', coalesce(v_name, 'Usuario'), v_n, case when v_n = 1 then '' else 's' end),
    jsonb_build_object('changes', p_changes)
  );

  return jsonb_build_object('applied', v_n);
end $$;

revoke all on function public.set_supplier_links(jsonb) from public, anon;
grant execute on function public.set_supplier_links(jsonb) to authenticated;
revoke all on function public.sync_primary_supplier_to_item() from public, anon, authenticated;
revoke all on function public.sync_item_supplier_to_links() from public, anon, authenticated;
