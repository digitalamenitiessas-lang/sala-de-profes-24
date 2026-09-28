-- ---------------------------------------------------------------------------
-- Plantillas de producción con MÚLTIPLES insumos (ensamblaje: 7 → 1).
-- El modelo original era 1 insumo → N salidas por % de rendimiento (despiece).
-- Marco necesita lo inverso: N insumos → 1 elaborado (milanesa cruda).
-- Solución simple y sin errores de carga: la plantilla guarda las cantidades
-- exactas de referencia; al elegirla, se precargan todos los renglones.
-- ---------------------------------------------------------------------------

create table if not exists public.production_template_inputs (
  id bigserial primary key,
  template_id bigint not null references public.production_templates(id) on delete cascade,
  stock_item_id uuid references public.stock_items(id) on delete set null,
  qty numeric,
  unit text,
  sort_order int not null default 0
);

alter table public.production_template_inputs enable row level security;

drop policy if exists "tpl_inputs_read" on public.production_template_inputs;
create policy "tpl_inputs_read" on public.production_template_inputs
  for select to authenticated using (true);

create index if not exists idx_tpl_inputs_template on public.production_template_inputs (template_id);

-- Cantidad absoluta de referencia por salida (además del % de rendimiento legacy)
alter table public.production_template_outputs
  add column if not exists default_qty numeric;
