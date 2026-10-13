-- ---------------------------------------------------------------------------
-- Feriados (se pagan 50% más) y tarifas por hora actualizadas
-- ---------------------------------------------------------------------------
-- Feriados nacionales 2026 (inamovibles y trasladables) según
-- api.argentinadatos.com. Los "puentes turísticos" no se cargan: son días no
-- laborables, no feriados. Se agregan o quitan desde la liquidación.
-- Sin políticas: solo desde el servidor.
-- ---------------------------------------------------------------------------

create table if not exists public.feriados (
  fecha date primary key,
  nombre text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.feriados enable row level security;
comment on table public.feriados is 'Feriados: las horas trabajadas ese día (fecha operativa) se pagan 50% más';

insert into public.feriados (fecha, nombre) values
  ('2026-01-01', 'Año nuevo'),
  ('2026-02-16', 'Carnaval'),
  ('2026-02-17', 'Carnaval'),
  ('2026-03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia'),
  ('2026-04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-05-01', 'Día del Trabajador'),
  ('2026-05-25', 'Día de la Revolución de Mayo'),
  ('2026-06-15', 'Paso a la Inmortalidad del General Martín Güemes'),
  ('2026-06-20', 'Paso a la Inmortalidad del General Manuel Belgrano'),
  ('2026-07-09', 'Día de la Independencia'),
  ('2026-08-17', 'Paso a la Inmortalidad del Gral. José de San Martín'),
  ('2026-10-12', 'Día del Respeto a la Diversidad Cultural'),
  ('2026-11-09', 'Visita del papa León XIV'),
  ('2026-11-23', 'Día de la Soberanía Nacional'),
  ('2026-12-08', 'Día de la Inmaculada Concepción de María'),
  ('2026-12-25', 'Navidad')
on conflict (fecha) do nothing;

-- Tarifas (pedido de Marco, 10/10/2026): no hay cocineros, todos cobran como
-- ayudante de cocina ($4.200); barista $4.200.
update public.payroll_rates set hourly_rate = 4200, updated_at = now() where role in ('cocina', 'chef', 'barista');
update public.payroll_rates set label = 'Ayudante de cocina (chef)' where role = 'chef';
