-- Protocolos nuevos (pedido de Marco, 11/10/2026), con el mismo circuito que
-- la limpieza del baño: aviso a la hora, asignación a alguien en turno,
-- recordatorios y registro. Horarios editables desde la app.
insert into public.protocolos (nombre, descripcion, horarios, pasos, fotos, requiere_foto, activo)
select 'Control de tolva',
  'Registro del café en la tolva al empezar, en el cambio de turno y al cerrar.',
  array['08:00', '16:00', '23:30'],
  array['Revisar el nivel de café en la tolva',
        'Cargar el registro en la pantalla Tolva (inicio, agregado o final del turno)',
        'Tolva tapada y molino limpio'],
  array['Foto de la tolva (que se vea el nivel)'],
  true, true
where not exists (select 1 from public.protocolos where nombre = 'Control de tolva');

insert into public.protocolos (nombre, descripcion, horarios, pasos, fotos, requiere_foto, activo)
select 'Control de descartables (barra)',
  'Los baristas cuentan los descartables y avisan al encargado antes de que falten.',
  array['08:30', '16:30'],
  array['Contar vasos 12oz, 18oz, vasos de frío, tapas y porta vasos',
        'Cargar el conteo en Stock (tocar el insumo → Contar)',
        'Si algo está por terminarse: tocar "Avisar faltante" para que le llegue al encargado'],
  array['Foto del estante de descartables'],
  false, true
where not exists (select 1 from public.protocolos where nombre = 'Control de descartables (barra)');
