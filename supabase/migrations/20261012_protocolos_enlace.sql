-- Protocolos con un botón que lleva a la pantalla donde se hace la tarea
-- (ej. "Cargar el conteo" → Cocina → Elaborados → Contar).
-- registro 'conteo_elaborados': no se puede cerrar la tarea sin haber cargado
-- el conteo del día (Sofía cerró la tarea sin cargar cantidades: la ventana
-- solo tenía pasos y nota, y la nota no le llegaba a nadie).
alter table public.protocolos add column if not exists enlace_url text;
alter table public.protocolos add column if not exists enlace_texto text;

update public.protocolos set
  registro = 'conteo_elaborados',
  enlace_url = '/cocina/elaborados?tab=contar',
  enlace_texto = 'Cargar el conteo',
  pasos = array['Contar los elaborados de heladeras y cámara',
                'Cargar cuánto hay de cada uno con el botón "Cargar el conteo"'],
  descripcion = 'Cocina cuenta los elaborados y carga las cantidades en la app. En la nota, lo que falta para mañana (le llega al encargado).'
where nombre = 'Conteo de elaborados (cocina)';
