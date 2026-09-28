-- ============================================================================
-- 20260907 — Trazabilidad limpia: separar lo que hace la GENTE de lo que
-- hace el espejo de Fudo.
-- ============================================================================
-- Problema medido el 2026-09-06 en producción:
--   audit_trail últimos 30 días = 3.742 filas, de las cuales 3.522 (94%) son
--   'stock_update' SIN usuario, generadas por el trigger fn_audit_stock cada
--   vez que el sync nocturno espeja una cantidad de Fudo. Las acciones reales
--   (13 producciones, 48 conteos, 13 órdenes) quedaban enterradas.
--   Lo mismo en stock_logs: 3.522 filas 'update' anónimas vs 49 conteos reales.
--
-- Causa: los dos triggers de stock_items disparan ante CUALQUIER cambio de
-- current_qty, incluido el UPDATE masivo del espejo Fudo→LVE, que corre con
-- service-role (auth.uid() IS NULL) y ya queda registrado en fudo_sync_events
-- + la fila resumen 'fudo_cron_sync' de audit_trail.
--
-- Además, toda escritura de stock originada en la app (conteo, merma,
-- recepción, producción) ya inserta su propia fila en stock_logs /
-- stock_movements / audit_trail CON usuario, motivo y nota. El trigger sólo
-- duplicaba esas filas sin datos.
--
-- Solución:
--   - audit_trail: el trigger deja de escribir cuando no hay usuario. Pasa a
--     ser un registro de acciones de personas.
--   - stock_logs: se sigue registrando el movimiento del espejo (es la huella
--     de las ventas descontando stock en Fudo), pero con action 'fudo_mirror'
--     para poder separarlo del conteo humano en el kardex.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) audit_trail = acciones de personas
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  uname text;
BEGIN
  -- Sin usuario = escritura del backend (espejo de Fudo, RPC de producción,
  -- sync tras recepción). Esos caminos ya auditan por su cuenta, con el
  -- usuario real y el motivo. Registrarlos acá sólo genera ruido anónimo.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.current_qty IS DISTINCT FROM NEW.current_qty THEN
    SELECT first_name || ' ' || last_name INTO uname FROM profiles WHERE id = auth.uid();
    INSERT INTO audit_trail(user_id, user_name, action, module, entity_type, entity_id, description, metadata)
    VALUES (
      auth.uid(), uname, 'stock_update', 'stock', 'stock_item', NEW.id::text,
      'Stock ' || NEW.name || ': ' || OLD.current_qty || ' → ' || NEW.current_qty,
      jsonb_build_object('item', NEW.name, 'old_qty', OLD.current_qty, 'new_qty', NEW.current_qty, 'category', NEW.category)
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2) stock_logs: el espejo queda etiquetado, no confundido con un conteo
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stock_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF OLD.current_qty IS DISTINCT FROM NEW.current_qty THEN
    INSERT INTO stock_logs(stock_item_id, user_id, action, old_qty, new_qty)
    VALUES (
      NEW.id,
      auth.uid(),
      CASE WHEN auth.uid() IS NULL THEN 'fudo_mirror' ELSE 'update' END,
      OLD.current_qty,
      NEW.current_qty
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Historial: las filas 'update' sin usuario son, todas, espejo de Fudo.
-- Se re-etiquetan para que el kardex de la ficha lea igual el pasado y el futuro.
UPDATE public.stock_logs
SET action = 'fudo_mirror'
WHERE action = 'update' AND user_id IS NULL;

-- ----------------------------------------------------------------------------
-- 3) Vínculos Fudo rotos: Fudo borró el ingrediente, el item local sobra.
--    "Americano Pre Producto" (#442) y "Aerocano Pre Producto" (#451), ambos
--    en 0. Regla de Marco: no queremos items que no están en Fudo.
-- ----------------------------------------------------------------------------
UPDATE public.stock_items
SET is_active = false, updated_at = now()
WHERE fudo_ingredient_id IN ('442', '451')
  AND current_qty = 0
  AND is_active;

UPDATE public.fudo_sync_incidents
SET status = 'resolved', resolved_at = now(), updated_at = now()
WHERE status = 'open'
  AND code = 'fudo_ingredient_not_found'
  AND fudo_id IN ('442', '451');
