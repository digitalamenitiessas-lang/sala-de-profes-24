-- Registro de avisos operativos ya mandados (uno por clave): "¿llegó el
-- pedido?", "producción sin validar"… evita mandar el mismo aviso dos veces.
-- Sin políticas: solo desde el servidor.
create table if not exists public.avisos_enviados (
  clave text primary key,
  enviado_at timestamptz not null default now()
);
alter table public.avisos_enviados enable row level security;
