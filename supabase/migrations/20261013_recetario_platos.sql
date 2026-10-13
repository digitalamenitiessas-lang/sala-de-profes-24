-- Recetario de platos editable en Sala de Profes.
-- Las recetas editadas acá no se pisan al volver a importar el Excel de Fudo.
alter table public.recipes add column if not exists editada_en_app_at timestamptz;
alter table public.recipes add column if not exists editada_por uuid references public.profiles(id) on delete set null;
comment on column public.recipes.editada_en_app_at is 'Última edición desde el Recetario de platos: la importación de Fudo no reemplaza sus ingredientes';
