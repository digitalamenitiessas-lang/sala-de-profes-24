-- ============================================================================
-- 20261012 — Producción: estado "rechazada"
-- ============================================================================
-- Hasta ahora el encargado solo podía validar una producción. Ahora también
-- puede rechazarla con un motivo. Una producción rechazada:
--   * nunca movió stock (solo se rechaza lo que todavía no se validó),
--   * no se puede editar ni validar después (estado final),
--   * guarda quién y cuándo en reviewed_by / reviewed_at, y el motivo en
--     review_notes (las mismas columnas que usa la validación).
--
-- Si esta migración no está aplicada, la API cae a 'cancelled' con el motivo
-- en review_notes ("Rechazada: …"), así el botón funciona igual.
-- ============================================================================

alter table public.production_orders
  drop constraint if exists production_orders_status_check;

alter table public.production_orders
  add constraint production_orders_status_check
  check (status in ('draft', 'in_progress', 'pending_review', 'completed', 'cancelled', 'rejected'));

comment on column public.production_orders.reviewed_by is
  'Socio/encargado que validó o rechazó la producción.';
comment on column public.production_orders.reviewed_at is
  'Cuándo se validó o rechazó la producción.';
comment on column public.production_orders.review_notes is
  'Notas de la revisión. Si la producción fue rechazada, el motivo.';

-- Rechazada = estado final. Cierra la carrera "uno valida mientras otro
-- rechaza": si el rechazo entra primero, el UPDATE a 'completed' que hace
-- complete_production_order() falla y toda la transacción (descuentos de
-- insumos, sumas del elaborado, lotes) se deshace sola.
create or replace function public.production_orders_rechazada_es_final()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'rejected' and new.status is distinct from old.status then
    raise exception 'La producción #% fue rechazada y no se puede reabrir ni validar', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_production_orders_rechazada_es_final on public.production_orders;
create trigger trg_production_orders_rechazada_es_final
  before update of status on public.production_orders
  for each row
  execute function public.production_orders_rechazada_es_final();
