-- Protocolos: a quién se le puede asignar (roles del turno) y conteo de
-- descartables conectado con Stock (como el conteo de elaborados).
alter table public.protocolos add column if not exists roles text[];
comment on column public.protocolos.roles is 'Roles del turno a los que se puede asignar (null = cualquiera)';

update public.protocolos set roles = array['cocina','chef']
where nombre = 'Conteo de elaborados (cocina)';

update public.protocolos set
  registro = 'conteo_descartables',
  enlace_url = '/stock/conteo?area=descartables',
  enlace_texto = 'Contar los vasos',
  pasos = array['Contar los vasos de 6, 8, 12 y 18 oz y las tapas','Cargarlos con el botón "Contar los vasos" y guardar'],
  descripcion = 'El barista cuenta los vasos y los carga en Stock. En la nota, lo que haga falta pedir (les llega a los encargados).'
where nombre = 'Control de descartables (barra)';
