-- ---------------------------------------------------------------------------
-- Protocolos: varias fotos obligatorias por tarea (baño: general + basura)
-- ---------------------------------------------------------------------------
-- protocolos.fotos       → qué fotos se piden (una por etiqueta, en orden)
-- protocolo_tareas.fotos → rutas en el bucket, en el mismo orden
-- foto_path queda como la primera foto (compatibilidad).
-- ---------------------------------------------------------------------------

alter table public.protocolos add column if not exists fotos text[] not null default array['Foto general'];
alter table public.protocolo_tareas add column if not exists fotos text[];

update public.protocolos
set fotos = array['Foto general del baño', 'Foto de la basura (cesto con bolsa nueva)'], updated_at = now()
where nombre = 'Limpieza del baño';

update public.protocolo_tareas set fotos = array[foto_path] where foto_path is not null and fotos is null;
