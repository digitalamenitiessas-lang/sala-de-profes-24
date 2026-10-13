-- Conteo diario de elaborados (pedido de Marco, 12/10/2026): para que no se
-- repita lo de la Masa de wrap (16 elaborados sin cantidad en Fudo que nunca
-- descontaban). Mismo circuito que baño/tolva; horario editable en la app.
insert into public.protocolos (nombre, descripcion, horarios, pasos, fotos, requiere_foto, activo)
select 'Conteo de elaborados (cocina)',
  'Cocina cuenta los elaborados al cerrar el turno mañana y lo carga en la app.',
  array['15:30'],
  array['Contar los elaborados de heladeras y cámara',
        'Cargar cada conteo en Cocina → Elaborados (o Stock → tocar el insumo → Contar)',
        'Si algo no alcanza para mañana: tocar "Falta insumo"'],
  array['Foto de la heladera de elaborados'],
  false, true
where not exists (select 1 from public.protocolos where nombre = 'Conteo de elaborados (cocina)');
