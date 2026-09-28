-- ---------------------------------------------------------------------------
-- Conteo diario pegando el mensaje de WhatsApp
-- ---------------------------------------------------------------------------
-- El encargado cuenta los elaborados todos los días y lo manda por WhatsApp
-- ("Bifes de pollo 48 porciones"). La app interpreta ese mismo texto; cuando
-- un nombre no coincide solo, alguien lo confirma UNA vez y queda guardado acá.
-- stock_item_id null = "este renglón no se cuenta" (ej. algo sin stock).
-- Se escribe solo desde el servidor (/api/stock/conteo-texto).
-- ---------------------------------------------------------------------------

create table if not exists public.stock_count_aliases (
  alias         text        primary key,  -- nombre normalizado como lo escriben
  stock_item_id uuid        references public.stock_items(id) on delete cascade,
  created_by    uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.stock_count_aliases enable row level security;
drop policy if exists stock_count_aliases_select on public.stock_count_aliases;
create policy stock_count_aliases_select on public.stock_count_aliases for select to authenticated using (true);

comment on table public.stock_count_aliases is
  'Nombres con los que el equipo cuenta (ej. "bifes de pollo") → insumo del stock. Los guarda /api/stock/conteo-texto.';
