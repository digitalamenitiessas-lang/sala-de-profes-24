-- SOLO se aplicó la sección A (feriados). B y C quedaron reemplazadas por 06_datos_copiados_de_lve_2026-10-13.sql (copia exacta de LVE).
-- =============================================================================
-- Sucursal 24 y Maipú — DATOS que sembraron las migraciones nuevas de LVE
-- =============================================================================
-- Correr DESPUÉS de db_24_estructura.sql, en otra transacción (necesita las
-- tablas/columnas nuevas ya confirmadas). Cada bloque es independiente y dice
-- de dónde sale: son decisiones de LVE (tarifas y protocolos "pedido de Marco"),
-- así que el dueño de la 24 decide cuáles corre. Todos se pueden volver a correr.
--
-- Lo que NO está acá a propósito:
--   * Ningún dato propio de LVE que no venga de las migraciones (usuarios, ids,
--     descartables por producto, ventas, ausencias, redes WiFi del local).
--   * Tarifas de encargado, runner, bacha: las migraciones nuevas no las tocan
--     (en LVE la tabla se cargó a mano). Siguen pendientes
--     (PENDIENTES-SUCURSAL-24.md §4: "Sin esto la liquidación da $0").
--   * El protocolo "Limpieza del baño" (migración vieja 20260929_protocolos).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A. Feriados nacionales 2026
--    Origen: supabase/migrations/20261010_feriados_y_tarifas.sql:19-37
--    Son nacionales (no dependen del local). Los "puentes turísticos" no van.
--    Ojo: 2026-11-09 "Visita del papa León XIV" lo cargó LVE como feriado.
--    Los provinciales de Tucumán (si corresponden) se agregan desde la
--    liquidación (/api/admin/feriados), igual que en LVE.
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- B. Tarifas por hora (payroll_rates) — montos de LVE del 10/10/2026
--    Origen:
--      20261010_cajero_b.sql:35-36         cajero  $4.200 'Cajero' (insert/upsert)
--      20261010_feriados_y_tarifas.sql:41-42  cocina/chef/barista $4.200 (update)
--      20261010_tarifas_cocina.sql:3-4     corrige: cocina $4.000 'Ayudante de
--                                          cocina'; chef $4.200 'Chef' (update)
--    En LVE las tres últimas eran UPDATE sobre filas que ya existían. En la 24
--    payroll_rates estaba vacía al 29/09 (pendiente), y un UPDATE no haría
--    nada: van como upsert con el valor FINAL (después de la corrección).
--    La liquidación paga por el rol del turno (shift_role) y, sin turno, por
--    "puesto ?? role" (src/lib/liquidacion/calcular.ts:77 y :206): el cajero
--    necesita su fila o cobra $0.
--    Correr solo si la 24 paga lo mismo que LVE; si no, cambiar los montos.
-- -----------------------------------------------------------------------------
insert into public.payroll_rates (role, hourly_rate, label) values ('cajero', 4200, 'Cajero')
on conflict (role) do update set hourly_rate = excluded.hourly_rate, label = excluded.label, updated_at = now();

insert into public.payroll_rates (role, hourly_rate, label) values
  ('cocina', 4000, 'Ayudante de cocina'),
  ('chef',   4200, 'Chef')
on conflict (role) do update set hourly_rate = excluded.hourly_rate, label = excluded.label, updated_at = now();

-- barista: la migración solo cambia el monto (no el nombre); 'Barista' se usa
-- únicamente si la fila no existía.
insert into public.payroll_rates (role, hourly_rate, label) values ('barista', 4200, 'Barista')
on conflict (role) do update set hourly_rate = excluded.hourly_rate, updated_at = now();


-- -----------------------------------------------------------------------------
-- C. Protocolos nuevos (circuito de aviso/asignación/recordatorio de los
--    protocolos; los horarios se editan después desde la app)
--    Se insertan ya en su versión FINAL de LVE (insert + updates posteriores).
--    Si ya hay uno con el mismo nombre en la 24, no se duplica: se lo lleva al
--    mismo estado que en LVE sin tocar sus horarios ni si está activo.
--    Ojo con las migraciones originales: 20261011_protocolos_medicion.sql
--    (update de la tolva) va ANTES por nombre que
--    20261011_protocolos_tolva_descartables.sql (insert): corridas en orden de
--    archivo, el update no encuentra la fila y la tolva queda sin peso
--    obligatorio. Por eso acá van combinadas.
--    Horarios de LVE: ajustar a los de la 24.
-- -----------------------------------------------------------------------------

-- C.1 Control de tolva — peso obligatorio que pasa solo al registro de Tolva
--     Origen: 20261011_protocolos_tolva_descartables.sql:4-13 (alta, horarios)
--           + 20261011_protocolos_medicion.sql:16-23 (peso, pasos, foto, texto)
insert into public.protocolos (nombre, descripcion, horarios, pasos, fotos, requiere_foto, activo,
                               medicion_etiqueta, medicion_unidad, registro)
select 'Control de tolva',
  'Peso y foto de la tolva al abrir, en el cambio de turno y al cerrar. El peso pasa solo al registro de Tolva.',
  array['08:00', '16:00', '23:30'],
  array['Pesar el café que hay en la tolva', 'Tolva tapada y molino limpio'],
  array['Foto de la tolva (que se vea el nivel)'],
  true, true,
  'Peso del café en la tolva', 'gr', 'tolva'
where not exists (select 1 from public.protocolos where nombre = 'Control de tolva');

update public.protocolos set
  medicion_etiqueta = 'Peso del café en la tolva',
  medicion_unidad = 'gr',
  registro = 'tolva',
  pasos = array['Pesar el café que hay en la tolva', 'Tolva tapada y molino limpio'],
  fotos = array['Foto de la tolva (que se vea el nivel)'],
  descripcion = 'Peso y foto de la tolva al abrir, en el cambio de turno y al cerrar. El peso pasa solo al registro de Tolva.',
  updated_at = now()
where nombre = 'Control de tolva'
  and registro is distinct from 'tolva';

-- C.2 Control de descartables (barra) — conteo de vasos conectado con Stock
--     Origen: 20261011_protocolos_tolva_descartables.sql:15-24 (alta, horarios)
--           + 20261012b_protocolos_roles_descartables.sql:9-15 (conteo en Stock)
insert into public.protocolos (nombre, descripcion, horarios, pasos, fotos, requiere_foto, activo,
                               registro, enlace_url, enlace_texto)
select 'Control de descartables (barra)',
  'El barista cuenta los vasos y los carga en Stock. En la nota, lo que haga falta pedir (les llega a los encargados).',
  array['08:30', '16:30'],
  array['Contar los vasos de 6, 8, 12 y 18 oz y las tapas', 'Cargarlos con el botón "Contar los vasos" y guardar'],
  array['Foto del estante de descartables'],
  false, true,
  'conteo_descartables', '/stock/conteo?area=descartables', 'Contar los vasos'
where not exists (select 1 from public.protocolos where nombre = 'Control de descartables (barra)');

update public.protocolos set
  registro = 'conteo_descartables',
  enlace_url = '/stock/conteo?area=descartables',
  enlace_texto = 'Contar los vasos',
  pasos = array['Contar los vasos de 6, 8, 12 y 18 oz y las tapas', 'Cargarlos con el botón "Contar los vasos" y guardar'],
  descripcion = 'El barista cuenta los vasos y los carga en Stock. En la nota, lo que haga falta pedir (les llega a los encargados).',
  updated_at = now()
where nombre = 'Control de descartables (barra)'
  and registro is distinct from 'conteo_descartables';

-- C.3 Conteo de elaborados (cocina) — no se cierra sin cargar el conteo; solo cocina/chef
--     Origen: 20261012_protocolo_conteo_elaborados.sql:4-13 (alta, horario)
--           + 20261012_protocolos_enlace.sql:9-16 (botón y registro)
--           + 20261012b_protocolos_roles_descartables.sql:6-7 (roles)
insert into public.protocolos (nombre, descripcion, horarios, pasos, fotos, requiere_foto, activo,
                               registro, enlace_url, enlace_texto, roles)
select 'Conteo de elaborados (cocina)',
  'Cocina cuenta los elaborados y carga las cantidades en la app. En la nota, lo que falta para mañana (le llega al encargado).',
  array['15:30'],
  array['Contar los elaborados de heladeras y cámara', 'Cargar cuánto hay de cada uno con el botón "Cargar el conteo"'],
  array['Foto de la heladera de elaborados'],
  false, true,
  'conteo_elaborados', '/cocina/elaborados?tab=contar', 'Cargar el conteo', array['cocina', 'chef']
where not exists (select 1 from public.protocolos where nombre = 'Conteo de elaborados (cocina)');

update public.protocolos set
  registro = 'conteo_elaborados',
  enlace_url = '/cocina/elaborados?tab=contar',
  enlace_texto = 'Cargar el conteo',
  roles = array['cocina', 'chef'],
  pasos = array['Contar los elaborados de heladeras y cámara', 'Cargar cuánto hay de cada uno con el botón "Cargar el conteo"'],
  descripcion = 'Cocina cuenta los elaborados y carga las cantidades en la app. En la nota, lo que falta para mañana (le llega al encargado).',
  updated_at = now()
where nombre = 'Conteo de elaborados (cocina)'
  and registro is distinct from 'conteo_elaborados';
