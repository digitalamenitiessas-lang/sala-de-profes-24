-- ---------------------------------------------------------------------------
-- Protocolos con un número a registrar (ej. peso de la tolva)
-- ---------------------------------------------------------------------------
-- protocolos.medicion_etiqueta / medicion_unidad: si está, al completar la
--   tarea hay que cargar ese número (además de los pasos y las fotos).
-- protocolos.registro: a dónde más va el número. 'tolva' → tolva_logs:
--   mañana (antes de las 12) = inicio TM; tarde (12 a 20) = fin TM + inicio TT;
--   noche (desde las 20) = fin TT.
-- protocolo_tareas.medicion: el número cargado.
-- ---------------------------------------------------------------------------
alter table public.protocolos add column if not exists medicion_etiqueta text;
alter table public.protocolos add column if not exists medicion_unidad text;
alter table public.protocolos add column if not exists registro text;
alter table public.protocolo_tareas add column if not exists medicion numeric;

update public.protocolos set
  medicion_etiqueta = 'Peso del café en la tolva',
  medicion_unidad = 'gr',
  registro = 'tolva',
  pasos = array['Pesar el café que hay en la tolva', 'Tolva tapada y molino limpio'],
  fotos = array['Foto de la tolva (que se vea el nivel)'],
  descripcion = 'Peso y foto de la tolva al abrir, en el cambio de turno y al cerrar. El peso pasa solo al registro de Tolva.'
where nombre = 'Control de tolva';
