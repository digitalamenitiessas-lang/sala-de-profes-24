-- ---------------------------------------------------------------------------
-- Ventas por día operativo (copia de Fudo) para el costo laboral vs ventas
-- ---------------------------------------------------------------------------
-- total = Σ total de las ventas CERRADAS de Fudo (con descuentos aplicados),
-- por día operativo (corte 06:00) y hora en que se abrió la venta (createdAt).
-- por_hora = { "0".."23": total }.
-- La suma de precio × cantidad de fudo_sales da ~10% más porque no descuenta
-- descuentos (9/10/2026: 2.001.380 vs 1.820.729 de Fudo).
-- Se llena sola desde lib/fudo/ventas-diarias.ts. Sin políticas: solo servidor.
-- ---------------------------------------------------------------------------
create table if not exists public.ventas_diarias (
  fecha date primary key,
  total numeric not null default 0,
  tickets integer not null default 0,
  por_hora jsonb not null default '{}'::jsonb,
  actualizado_at timestamptz not null default now()
);
alter table public.ventas_diarias enable row level security;
comment on table public.ventas_diarias is 'Total vendido por día operativo según Fudo (ventas cerradas, con descuentos)';
