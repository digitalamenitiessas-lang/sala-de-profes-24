-- APLICADO en la 24 el 2026-10-13 (sync con LVE c87cd48..2cb4da4). Ver supabase/estructura/README.md.
-- =============================================================================
-- Sucursal 24 y Maipú — ESTRUCTURA para quedar igual a LVE (sync del 13/10/2026)
-- =============================================================================
-- Origen: las 20 migraciones nuevas de LVE (git diff c87cd48 lve/main --
-- supabase/migrations, del 01/10 al 13/10) y los 3 relojes nuevos de
-- supabase/manual/ (fichajes, resumen semanal, resumen de turno).
--
-- Verificado contra el catálogo de LVE (cat_lve.txt / cat_diff.txt):
--   * Las 20 migraciones están aplicadas en LVE: los 7 cuerpos de función, las
--     restricciones, los índices y los 2 triggers de abajo dan el MISMO md5 que
--     en la base de LVE.
--   * No hay nada en la base de LVE que falte en las migraciones (nada hecho a
--     mano en el panel), salvo lo que la 24 sacó a propósito y NO se repone:
--     tablas _backup_*_20260728, vistas v_today_attendance/v_active_alerts sin
--     security_invoker y abiertas a anon, handle_new_user() que toma el rol de
--     los metadatos, políticas audit_trail/bar_stock_items/profiles_insert de
--     LVE, cube/earthdistance en public y el bucket attendance-selfies (el
--     código nuevo no lo usa: "un celular por persona" va por
--     attendance_logs.device_fingerprint y el WiFi del local por
--     attendance_config 'redes_local'; SelfieCapture.tsx no se usa y apunta a
--     otro bucket).
--
-- Cómo correrlo:
--   * Todo este archivo en UNA transacción (no tiene BEGIN/COMMIT adentro).
--   * db_24_datos.sql DESPUÉS, en otra transacción. El valor 'cajero' del enum
--     app_role que se agrega en §1 no se puede USAR hasta que esta transacción
--     haga COMMIT ("unsafe use of new value"). Este archivo no lo usa como
--     valor; no agregar acá updates/inserts a profiles ni a shifts.
--   * Idempotente: se puede volver a correr (if not exists / create or replace /
--     drop ... if exists + create).
--   * Todo va con schema explícito (public., cron.).
--
-- Desvíos A PROPÓSITO respecto de LVE (van a seguir apareciendo en el diff de
-- comparar_catalogo.sql, además de los que ya había):
--   1. §5b: _deduct_stock_item() y fn_stock_critico_manana() cerradas a anon y
--      authenticated (en LVE quedaron abiertas por los permisos automáticos).
--   2. §7: profiles_proteger_rol() (solo existe en la 24) contempla el puesto
--      y el cajero; profiles_insert (ya distinta de LVE) exige puesto null.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- §1. Rol cajero en el enum
--     Origen: 20261010_cajero_a.sql:2
-- -----------------------------------------------------------------------------
alter type public.app_role add value if not exists 'cajero';


-- -----------------------------------------------------------------------------
-- §2. Columnas nuevas en tablas que ya existen
-- -----------------------------------------------------------------------------

-- 20261001_avisos_ingreso.sql:3-6 — avisos de "marcá tu entrada" (una vez a la
-- persona y una vez al encargado). Los usa /api/cron/auto-clockout.
alter table public.shifts add column if not exists aviso_ingreso_at timestamptz;
alter table public.shifts add column if not exists aviso_encargado_at timestamptz;
comment on column public.shifts.aviso_ingreso_at is 'Cuándo se le avisó a la persona que marque la entrada (null = no hizo falta)';
comment on column public.shifts.aviso_encargado_at is 'Cuándo se le avisó al encargado que la persona no fichó';

-- 20261001_receipt_fudo_expense_id.sql:11 y 20261005_stock_receipts_gasto_columns.sql:10-40
-- Gasto de Fudo propio de cada recibo + categoría/comprobante/impuestos del gasto.
alter table public.stock_receipts
  add column if not exists fudo_expense_id       text,
  add column if not exists expense_category_id   text,
  add column if not exists expense_category_name text,
  add column if not exists comprobante_tipo      text,
  add column if not exists comprobante_numero    text,
  add column if not exists iva                   numeric(14,2),
  add column if not exists iibb                  numeric(14,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stock_receipts_comprobante_tipo_check'
      and conrelid = 'public.stock_receipts'::regclass
  ) then
    alter table public.stock_receipts
      add constraint stock_receipts_comprobante_tipo_check
      check (comprobante_tipo is null or comprobante_tipo in (
        'sin_comprobante', 'ticket', 'factura_a', 'factura_b', 'factura_c'
      ));
  end if;
end $$;

comment on column public.stock_receipts.expense_category_id   is 'Id de la categoría de gasto en Fudo (ExpenseCategory)';
comment on column public.stock_receipts.expense_category_name is 'Nombre de la categoría de gasto (para mostrar sin llamar a Fudo)';
comment on column public.stock_receipts.comprobante_tipo      is 'Tipo de comprobante: sin_comprobante | ticket | factura_a | factura_b | factura_c';
comment on column public.stock_receipts.comprobante_numero    is 'Número del comprobante (ej: 0001-00012345)';
comment on column public.stock_receipts.iva                   is 'IVA de la factura A. En compras de varios productos va solo en el primer recibo del lote.';
comment on column public.stock_receipts.iibb                  is 'IIBB de la factura A. En compras de varios productos va solo en el primer recibo del lote.';

-- Para "última categoría usada con este proveedor"
create index if not exists stock_receipts_supplier_categoria
  on public.stock_receipts (supplier_id, id desc)
  where expense_category_id is not null;

-- 20261011_descartables_para_llevar.sql:32 — último aviso "quedan pocos" (uno cada 12 h)
alter table public.stock_items add column if not exists aviso_minimo_at timestamptz;

-- 20261010_cajero_b.sql:11-12 — el cajero ES encargado en profiles.role y su
-- puesto queda en profiles.puesto = 'cajero' (lo pone el trigger de §6).
alter table public.profiles add column if not exists puesto public.app_role;
comment on column public.profiles.puesto is 'Puesto visible cuando difiere del rol de permisos (cajero = permisos de encargado)';

-- 20261011_protocolos_medicion.sql:11-14, 20261012_protocolos_enlace.sql:6-7,
-- 20261012b_protocolos_roles_descartables.sql:3-4 — protocolos con número a
-- registrar (tolva), botón a la pantalla de la tarea y roles asignables.
alter table public.protocolos add column if not exists medicion_etiqueta text;
alter table public.protocolos add column if not exists medicion_unidad text;
alter table public.protocolos add column if not exists registro text;
alter table public.protocolos add column if not exists enlace_url text;
alter table public.protocolos add column if not exists enlace_texto text;
alter table public.protocolos add column if not exists roles text[];
comment on column public.protocolos.roles is 'Roles del turno a los que se puede asignar (null = cualquiera)';
alter table public.protocolo_tareas add column if not exists medicion numeric;

-- 20261013_recetario_platos.sql:3-5 — recetas editadas en el Recetario de platos
-- (la importación del Excel de Fudo no las pisa).
alter table public.recipes add column if not exists editada_en_app_at timestamptz;
alter table public.recipes add column if not exists editada_por uuid references public.profiles(id) on delete set null;
comment on column public.recipes.editada_en_app_at is 'Última edición desde el Recetario de platos: la importación de Fudo no reemplaza sus ingredientes';


-- -----------------------------------------------------------------------------
-- §3. Restricciones que cambian (los valores nuevos son un superconjunto de los
--     viejos: las filas que ya hay en la 24 siguen valiendo)
-- -----------------------------------------------------------------------------

-- 20261001_receipt_fudo_expense_id.sql:15-31 — cola de reintentos de Fudo con
-- el tipo 'crear_gasto'. (LVE borra cualquier CHECK con "tipo"; en la 24 hay uno
-- solo y se llama así, ver cat_24.txt.)
alter table public.fudo_reintentos drop constraint if exists fudo_reintentos_tipo_check;
alter table public.fudo_reintentos
  add constraint fudo_reintentos_tipo_check
  check (tipo in ('stock_delta', 'pago_gasto', 'crear_gasto'));

-- 20261012_produccion_rechazo.sql:15-27 — producción "rechazada"
alter table public.production_orders drop constraint if exists production_orders_status_check;
alter table public.production_orders
  add constraint production_orders_status_check
  check (status in ('draft', 'in_progress', 'pending_review', 'completed', 'cancelled', 'rejected'));

comment on column public.production_orders.reviewed_by is
  'Socio/encargado que validó o rechazó la producción.';
comment on column public.production_orders.reviewed_at is
  'Cuándo se validó o rechazó la producción.';
comment on column public.production_orders.review_notes is
  'Notas de la revisión. Si la producción fue rechazada, el motivo.';


-- -----------------------------------------------------------------------------
-- §4. Tablas nuevas. Todas con RLS y SIN políticas: solo las usa el servidor
--     (service_role). Permisos iguales a LVE (ALL a anon/authenticated/
--     service_role, que con RLS sin políticas no deja leer ni escribir filas).
-- -----------------------------------------------------------------------------

-- 20261010_ausencias.sql:10-26 — por qué alguien con turno no fichó
create table if not exists public.ausencias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  fecha date not null,
  motivo text not null check (motivo in ('licencia', 'enfermedad', 'franco', 'cambio_turno', 'falto', 'otro')),
  nota text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fecha)
);
create index if not exists ausencias_fecha_idx on public.ausencias (fecha);
alter table public.ausencias enable row level security;
grant all on table public.ausencias to anon, authenticated, service_role;
comment on table public.ausencias is 'Motivo por el que alguien con turno no fichó (licencia, enfermedad, franco, cambio de turno, faltó, otro)';

-- 20261010_feriados_y_tarifas.sql:10-17 — feriados (+50% en la liquidación).
-- Los feriados 2026 que siembra esa migración están en db_24_datos.sql.
create table if not exists public.feriados (
  fecha date primary key,
  nombre text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.feriados enable row level security;
grant all on table public.feriados to anon, authenticated, service_role;
comment on table public.feriados is 'Feriados: las horas trabajadas ese día (fecha operativa) se pagan 50% más';

-- 20261010_ventas_diarias.sql:11-19 — ventas por día operativo (copia de Fudo)
create table if not exists public.ventas_diarias (
  fecha date primary key,
  total numeric not null default 0,
  tickets integer not null default 0,
  por_hora jsonb not null default '{}'::jsonb,
  actualizado_at timestamptz not null default now()
);
alter table public.ventas_diarias enable row level security;
grant all on table public.ventas_diarias to anon, authenticated, service_role;
comment on table public.ventas_diarias is 'Total vendido por día operativo según Fudo (ventas cerradas, con descuentos)';

-- 20261011_descartables_para_llevar.sql:12-30 — descartables que se descuentan
-- solos en las ventas para llevar (los configura el encargado en Stock).
create table if not exists public.descartables_producto (
  fudo_product_id text not null,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  cantidad numeric not null default 1 check (cantidad > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (fudo_product_id, stock_item_id)
);
alter table public.descartables_producto enable row level security;
grant all on table public.descartables_producto to anon, authenticated, service_role;

create table if not exists public.descartables_consumidos (
  fudo_sale_item_id text primary key,
  fudo_product_id text not null,
  vendido_at timestamptz not null,
  detalle jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.descartables_consumidos enable row level security;
create index if not exists descartables_consumidos_vendido_idx on public.descartables_consumidos (vendido_at);
grant all on table public.descartables_consumidos to anon, authenticated, service_role;

-- 20261012_avisos_enviados.sql:4-8 — avisos operativos ya mandados (uno por clave)
create table if not exists public.avisos_enviados (
  clave text primary key,
  enviado_at timestamptz not null default now()
);
alter table public.avisos_enviados enable row level security;
grant all on table public.avisos_enviados to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- §5. Funciones (cuerpos copiados TAL CUAL de las migraciones: dan el mismo md5
--     que en la base de LVE; no reformatear)
-- -----------------------------------------------------------------------------

-- 20261004_deduct_con_modificadores.sql:29-45 — helper: descuenta un insumo
CREATE OR REPLACE FUNCTION public._deduct_stock_item(
  p_stock_item_id  uuid,
  p_qty            numeric,       -- positivo: cuánto descontar
  p_sale_id        bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- El trigger fn_stock_log captura el cambio en stock_logs automáticamente.
  UPDATE public.stock_items
     SET current_qty = current_qty - p_qty,
         updated_at  = now()
   WHERE id = p_stock_item_id;
END;
$$;

-- 20261004_deduct_con_modificadores.sql:52-172 — descuento por venta con
-- consumo_modo y grupos modificadores (reemplaza la versión del 28/09).
-- CREATE OR REPLACE conserva los permisos actuales (cerrada a anon/authenticated,
-- igual que en LVE).
CREATE OR REPLACE FUNCTION public.deduct_stock_on_sale(p_sale_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale     record;
  v_item     record;
  v_ing      record;
  v_sub      record;
  v_sub_item record;
  v_qty      numeric;
  v_count    int := 0;
BEGIN
  -- 1. Obtener la venta
  SELECT id, fudo_sale_item_id, fudo_product_id, quantity
    INTO v_sale
    FROM public.fudo_sales WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Venta %s no encontrada', p_sale_id));
  END IF;

  -- 2. Buscar el menu_item correspondiente
  SELECT id, name, consumo_modo, recipe_id,
         consumo_stock_item_id, consumo_qty
    INTO v_item
    FROM public.menu_items
   WHERE fudo_product_id = v_sale.fudo_product_id
   ORDER BY is_active DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id,
      'message', 'Producto Fudo no mapeado', 'ingredients_affected', 0);
  END IF;

  -- 3. Descontar el ítem principal según consumo_modo
  IF v_item.consumo_modo = 'receta'
     OR (v_item.consumo_modo IS NULL AND v_item.recipe_id IS NOT NULL) THEN

    FOR v_ing IN
      SELECT ri.stock_item_id, ri.qty_per_portion
        FROM public.recipe_ingredients ri
       WHERE ri.recipe_id = v_item.recipe_id
    LOOP
      v_qty := v_ing.qty_per_portion * v_sale.quantity;
      PERFORM public._deduct_stock_item(v_ing.stock_item_id, v_qty, p_sale_id);
      v_count := v_count + 1;
    END LOOP;

  ELSIF v_item.consumo_modo = 'insumo'
        AND v_item.consumo_stock_item_id IS NOT NULL
        AND v_item.consumo_qty > 0 THEN

    v_qty := v_item.consumo_qty * v_sale.quantity;
    PERFORM public._deduct_stock_item(v_item.consumo_stock_item_id, v_qty, p_sale_id);
    v_count := v_count + 1;

  END IF;
  -- 'combo' y 'sin_consumo': el ítem principal no descuenta nada propio.

  -- 4. Procesar sub-ítems (grupos modificadores de Fudo).
  --    Para receta, combo e insumo; requiere fudo_sale_item_id para el join.
  IF v_item.consumo_modo IN ('receta', 'combo', 'insumo')
     AND v_sale.fudo_sale_item_id IS NOT NULL THEN

    FOR v_sub IN
      SELECT ss.fudo_product_id, ss.quantity
        FROM public.fudo_sale_subitems ss
       WHERE ss.fudo_sale_item_id = v_sale.fudo_sale_item_id
    LOOP
      SELECT id, consumo_modo, recipe_id,
             consumo_stock_item_id, consumo_qty
        INTO v_sub_item
        FROM public.menu_items
       WHERE fudo_product_id = v_sub.fudo_product_id
       ORDER BY is_active DESC LIMIT 1;

      IF NOT FOUND
         OR v_sub_item.consumo_modo IS NULL
         OR v_sub_item.consumo_modo IN ('sin_consumo', 'combo') THEN
        CONTINUE;
      END IF;

      IF v_sub_item.consumo_modo = 'receta'
         AND v_sub_item.recipe_id IS NOT NULL THEN
        FOR v_ing IN
          SELECT ri.stock_item_id, ri.qty_per_portion
            FROM public.recipe_ingredients ri
           WHERE ri.recipe_id = v_sub_item.recipe_id
        LOOP
          v_qty := v_ing.qty_per_portion * v_sub.quantity;
          PERFORM public._deduct_stock_item(v_ing.stock_item_id, v_qty, p_sale_id);
          v_count := v_count + 1;
        END LOOP;

      ELSIF v_sub_item.consumo_modo = 'insumo'
            AND v_sub_item.consumo_stock_item_id IS NOT NULL
            AND v_sub_item.consumo_qty > 0 THEN
        v_qty := v_sub_item.consumo_qty * v_sub.quantity;
        PERFORM public._deduct_stock_item(v_sub_item.consumo_stock_item_id, v_qty, p_sale_id);
        v_count := v_count + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', p_sale_id,
    'menu_item', v_item.name,
    'consumo_modo', v_item.consumo_modo,
    'ingredients_affected', v_count
  );
END;
$$;

COMMENT ON FUNCTION public.deduct_stock_on_sale(bigint) IS
  'Descuenta stock al registrar una venta de Fudo. '
  'Respeta consumo_modo (receta/combo/insumo/sin_consumo) y procesa '
  'sub-ítems de grupos modificadores usando su propio consumo_modo.';

-- 20261004_deduct_con_modificadores.sql:179-223 — costo de 1 unidad de un producto Fudo
CREATE OR REPLACE FUNCTION public.fn_menu_item_unit_cost(p_fudo_product_id text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_item record;
  v_cost numeric;
BEGIN
  SELECT consumo_modo, recipe_id, consumo_stock_item_id, consumo_qty
    INTO v_item
    FROM public.menu_items
   WHERE fudo_product_id = p_fudo_product_id
   ORDER BY is_active DESC LIMIT 1;

  IF NOT FOUND THEN RETURN 0; END IF;

  IF v_item.consumo_modo = 'receta' AND v_item.recipe_id IS NOT NULL THEN
    SELECT COALESCE(SUM(ri.qty_per_portion * si.cost_per_unit), 0)
      INTO v_cost
      FROM public.recipe_ingredients ri
      JOIN public.stock_items si ON si.id = ri.stock_item_id
     WHERE ri.recipe_id = v_item.recipe_id
       AND si.cost_per_unit IS NOT NULL
       AND si.cost_per_unit > 0;
    RETURN COALESCE(v_cost, 0);

  ELSIF v_item.consumo_modo = 'insumo'
        AND v_item.consumo_stock_item_id IS NOT NULL
        AND v_item.consumo_qty > 0 THEN
    SELECT COALESCE(v_item.consumo_qty * si.cost_per_unit, 0)
      INTO v_cost
      FROM public.stock_items si
     WHERE si.id = v_item.consumo_stock_item_id
       AND si.cost_per_unit IS NOT NULL;
    RETURN COALESCE(v_cost, 0);
  END IF;

  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.fn_menu_item_unit_cost(text) IS
  'Costo unitario de un producto Fudo calculado desde sus ingredientes. '
  'No incluye modificadores; para el costo real por venta usar fn_sale_real_cost.';

-- 20261004_deduct_con_modificadores.sql:230-266 — costo real de una venta, con modificadores
CREATE OR REPLACE FUNCTION public.fn_sale_real_cost(p_sale_id bigint)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_sale record;
  v_cost numeric := 0;
  v_sub  record;
BEGIN
  SELECT id, fudo_sale_item_id, fudo_product_id, quantity
    INTO v_sale
    FROM public.fudo_sales WHERE id = p_sale_id;

  IF NOT FOUND THEN RETURN 0; END IF;

  v_cost := public.fn_menu_item_unit_cost(v_sale.fudo_product_id::text) * v_sale.quantity;

  IF v_sale.fudo_sale_item_id IS NOT NULL THEN
    FOR v_sub IN
      SELECT ss.fudo_product_id, ss.quantity
        FROM public.fudo_sale_subitems ss
       WHERE ss.fudo_sale_item_id = v_sale.fudo_sale_item_id
    LOOP
      v_cost := v_cost
        + public.fn_menu_item_unit_cost(v_sub.fudo_product_id::text) * v_sub.quantity;
    END LOOP;
  END IF;

  RETURN v_cost;
END;
$$;

COMMENT ON FUNCTION public.fn_sale_real_cost(bigint) IS
  'Costo real de una venta incluyendo los grupos modificadores elegidos. '
  'Clásico con medialuna + latte = costo gramos café + costo medialuna + costo leche. '
  'Fudo no computa este costo; esta función lo resuelve desde recipe_ingredients × cost_per_unit.';

-- 20261011_fn_stock_critico_manana.sql:13-85 — insumos que no alcanzan para el
-- día/turno siguiente (la usan /api/cron/stock-preclose y /api/cocina/faltante,
-- las dos con la clave de servidor).
CREATE OR REPLACE FUNCTION public.fn_stock_critico_manana()
RETURNS TABLE(
  stock_item_id  uuid,
  name           text,
  unit           text,
  current_qty    numeric,
  min_qty        numeric,
  consumed_21d   numeric,
  daily_rate     numeric,
  days_of_stock  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH consumo AS (
    SELECT
      sl.stock_item_id,
      SUM(
        CASE WHEN sl.new_qty < sl.old_qty
             THEN sl.old_qty - sl.new_qty
             ELSE 0
        END
      ) AS consumed_21d
    FROM public.stock_logs sl
    WHERE sl.created_at >= NOW() - INTERVAL '21 days'
      AND sl.old_qty IS NOT NULL
      AND sl.new_qty IS NOT NULL
    GROUP BY sl.stock_item_id
    HAVING SUM(
      CASE WHEN sl.new_qty < sl.old_qty
           THEN sl.old_qty - sl.new_qty
           ELSE 0
      END
    ) > 0
  )
  SELECT
    si.id                                                 AS stock_item_id,
    si.name,
    si.unit,
    si.current_qty,
    si.min_qty,
    ROUND(c.consumed_21d::numeric, 3)                     AS consumed_21d,
    ROUND((c.consumed_21d / 21.0)::numeric, 3)            AS daily_rate,
    CASE
      WHEN c.consumed_21d > 0
        THEN ROUND((si.current_qty / (c.consumed_21d / 21.0))::numeric, 1)
      ELSE NULL
    END                                                   AS days_of_stock
  FROM public.stock_items si
  JOIN consumo c ON c.stock_item_id = si.id
  WHERE si.is_active = true
    AND (
      si.current_qty < 0
      OR (c.consumed_21d > 0
          AND si.current_qty / (c.consumed_21d / 21.0) < 1.5)
      OR (si.min_qty > 0
          AND si.current_qty <= si.min_qty)
    )
  ORDER BY
    CASE
      WHEN si.current_qty < 0 THEN si.current_qty - 9999
      WHEN c.consumed_21d > 0 THEN si.current_qty / (c.consumed_21d / 21.0)
      ELSE 99
    END ASC;
$$;

COMMENT ON FUNCTION public.fn_stock_critico_manana() IS
  'Devuelve los insumos activos con riesgo de quiebre: negativos, '
  'menos de 1.5 días de stock según historial de 21d, o bajo su min_qty. '
  'Usada por el cron stock-preclose (7hs, 15hs, 23hs AR).';

-- 20261012_produccion_rechazo.sql:33-44 — "rechazada" es un estado final
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

-- 20261010_cajero_b.sql:14-28 — elegir "cajero" guarda role = encargado y
-- puesto = cajero; cambiar a otro rol a mano le saca el puesto.
create or replace function public.tg_profiles_cajero()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'cajero' then
    new.role := 'encargado';
    new.puesto := 'cajero';
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    -- Otro rol elegido a mano: deja de ser cajero
    new.puesto := null;
  end if;
  return new;
end
$$;

-- Permisos iguales a LVE (cat_lve.txt ACL-F: anon/authenticated/service_role = true).
-- Se dan explícitos para no depender de los permisos automáticos del rol que corre esto.
grant execute on function public.fn_menu_item_unit_cost(text) to anon, authenticated, service_role;
grant execute on function public.fn_sale_real_cost(bigint) to anon, authenticated, service_role;
grant execute on function public.production_orders_rechazada_es_final() to anon, authenticated, service_role;
grant execute on function public.tg_profiles_cajero() to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- §5b. DESVÍO A PROPÓSITO: dos funciones SECURITY DEFINER cerradas al público
-- -----------------------------------------------------------------------------
-- En LVE quedaron ejecutables por anon (la clave pública que viaja en la web)
-- solo porque los permisos automáticos de Supabase se las dieron; las
-- migraciones no las abren a propósito (fn_stock_critico_manana solo hace
-- GRANT a service_role). Es el mismo criterio de LVE en
-- 20260927_cerrar_accesos_publicos.sql (deduct_stock_on_sale, update_stock_qty,
-- tableros de admin):
--   * _deduct_stock_item: cualquiera sin sesión podría cambiar el stock de
--     cualquier insumo con POST /rest/v1/rpc/_deduct_stock_item.
--   * fn_stock_critico_manana: saltea RLS y devuelve insumos y cantidades.
-- Ningún código las llama con la sesión del usuario: _deduct_stock_item solo la
-- llama deduct_stock_on_sale (que corre como dueño) y fn_stock_critico_manana
-- solo admin.rpc() en /api/cron/stock-preclose y /api/cocina/faltante.
-- Para quedar EXACTAMENTE como LVE, borrar este bloque y descomentar:
--   grant execute on function public._deduct_stock_item(uuid, numeric, bigint) to anon, authenticated, service_role;
--   grant execute on function public.fn_stock_critico_manana() to anon, authenticated, service_role;
revoke all on function public._deduct_stock_item(uuid, numeric, bigint) from public, anon, authenticated;
grant execute on function public._deduct_stock_item(uuid, numeric, bigint) to service_role;
revoke all on function public.fn_stock_critico_manana() from public, anon, authenticated;
grant execute on function public.fn_stock_critico_manana() to service_role;


-- -----------------------------------------------------------------------------
-- §6. Triggers nuevos
-- -----------------------------------------------------------------------------

-- 20261012_produccion_rechazo.sql:46-50 — cierra la carrera "uno valida
-- mientras otro rechaza".
drop trigger if exists trg_production_orders_rechazada_es_final on public.production_orders;
create trigger trg_production_orders_rechazada_es_final
  before update of status on public.production_orders
  for each row
  execute function public.production_orders_rechazada_es_final();

-- 20261010_cajero_b.sql:30-33. Orden en profiles (alfabético, todos BEFORE):
-- trg_profiles_cajero → trg_profiles_proteger_rol → trg_profiles_updated_at.
-- O sea, proteger_rol ya ve el rol normalizado (cajero → encargado + puesto).
drop trigger if exists trg_profiles_cajero on public.profiles;
create trigger trg_profiles_cajero
  before insert or update of role on public.profiles
  for each row execute function public.tg_profiles_cajero();


-- -----------------------------------------------------------------------------
-- §7. AJUSTE DE LA 24 (se conserva y se adapta al cajero)
-- -----------------------------------------------------------------------------
-- profiles_proteger_rol (supabase/estructura/03_ajustes_sucursal_24.sql §8)
-- sigue igual en lo esencial: rol y estado solo los cambia un encargado o un
-- socio, y lo que toca al rol socio solo un socio. Cambios:
--   * El cajero puede lo mismo que el encargado. En la base el cajero ES
--     encargado (tg_profiles_cajero corre antes y guarda role = 'encargado'),
--     así que ya podía; 'cajero' se agrega a la lista por las dudas.
--   * profiles.puesto queda protegido igual que el rol. La liquidación paga la
--     tarifa de "puesto ?? role" cuando no hay turno (src/lib/liquidacion/
--     calcular.ts:77 y :206) y la política profiles_update_own deja a cada uno
--     editar su propio perfil: sin esto un barista podía ponerse puesto
--     'cajero' o 'chef' desde la API y cobrar otra tarifa.
--   * puesto 'socio' cuenta como rol socio.
-- El servidor (service_role, sin auth.uid()) sigue pudiendo todo, y la app no
-- manda puesto desde el navegador (solo role; el puesto lo pone el trigger).
create or replace function public.profiles_proteger_rol() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  v_rol text;
begin
  if (new.role is distinct from old.role
      or new.puesto is distinct from old.puesto
      or new.is_active is distinct from old.is_active)
     and auth.uid() is not null
  then
    select role::text into v_rol from public.profiles where id = auth.uid();
    if v_rol is null or v_rol not in ('encargado', 'cajero', 'socio') then
      raise exception 'Solo un encargado o socio puede cambiar el rol, el puesto o el estado de un perfil';
    end if;
    if v_rol <> 'socio' and (new.role = 'socio' or old.role = 'socio'
                             or new.puesto = 'socio' or old.puesto = 'socio') then
      raise exception 'Solo un socio puede dar o quitar el rol de socio, o desactivar a un socio';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_proteger_rol() from public, anon, authenticated;
grant execute on function public.profiles_proteger_rol() to service_role;
drop trigger if exists trg_profiles_proteger_rol on public.profiles;
create trigger trg_profiles_proteger_rol
  before update on public.profiles
  for each row execute function public.profiles_proteger_rol();

-- profiles_insert (03_ajustes_sucursal_24.sql §7): el perfil propio solo como
-- barista y sin puesto. (Con 'cajero' como rol ya falla: el trigger lo pasa a
-- encargado antes de que se evalúe la política.)
alter policy "profiles_insert" on public.profiles
  with check (id = auth.uid() and role = 'barista' and puesto is null);


-- -----------------------------------------------------------------------------
-- §8. Relojes (pg_cron + pg_net), apuntando a la app de la 24
-- -----------------------------------------------------------------------------
-- Mismo secreto de Vault que los relojes que ya están ('cron_secret_protocolos').
-- fudo_reloj.sql y protocolos_reloj.sql no cambiaron en LVE: fudo-pulso,
-- fudo-sync-reintento y protocolos-avisos ya están iguales en la 24.
-- Se pueden correr aparte de lo anterior si se prefiere (no dependen de §1-§7).

-- supabase/manual/fichajes_reloj.sql — cierre de salidas olvidadas y avisos de
-- entrada cada 15 minutos. Reemplaza al 'auto-clockout' horario que se había
-- armado en la 24 (supabase/manual/auto_clockout_reloj.sql): llaman a la misma
-- ruta y con los dos se llamaría de más.
select cron.unschedule('auto-clockout') where exists (select 1 from cron.job where jobname = 'auto-clockout');
select cron.unschedule('fichajes-cierre') where exists (select 1 from cron.job where jobname = 'fichajes-cierre');
select cron.schedule(
  'fichajes-cierre',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://sala-de-profes-24.vercel.app/api/cron/auto-clockout',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- supabase/manual/resumen_semanal_reloj.sql — lunes 8:00 AR (11:00 UTC): mail
-- a los socios con el resumen de la semana y la liquidación en PDF.
select cron.unschedule('resumen-semanal') where exists (select 1 from cron.job where jobname = 'resumen-semanal');
select cron.schedule(
  'resumen-semanal',
  '0 11 * * 1',
  $$
  select net.http_get(
    url := 'https://sala-de-profes-24.vercel.app/api/cron/resumen-semanal',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')
    ),
    timeout_milliseconds := 120000
  );
  $$
);

-- supabase/manual/resumen_turno_reloj.sql — resumen de cada turno por Telegram:
-- 16:30 AR (19:30 UTC) turno mañana, 01:30 AR (04:30 UTC) turno tarde/noche.
-- Horarios de LVE: si los turnos de la 24 cierran a otra hora, cambiar acá.
select cron.unschedule('resumen-turno-tm') where exists (select 1 from cron.job where jobname = 'resumen-turno-tm');
select cron.unschedule('resumen-turno-tt') where exists (select 1 from cron.job where jobname = 'resumen-turno-tt');
select cron.schedule('resumen-turno-tm', '30 19 * * *', $$
  select net.http_get(
    url := 'https://sala-de-profes-24.vercel.app/api/cron/resumen-turno?turno=TM',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')),
    timeout_milliseconds := 60000
  );
$$);
select cron.schedule('resumen-turno-tt', '30 4 * * *', $$
  select net.http_get(
    url := 'https://sala-de-profes-24.vercel.app/api/cron/resumen-turno?turno=TT',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')),
    timeout_milliseconds := 60000
  );
$$);

-- Comprobar (a los 15-30 minutos):
--   select jobname, schedule from cron.job order by jobname;
--   select status_code, created from net._http_response order by created desc limit 5;


-- -----------------------------------------------------------------------------
-- §9. Que la API (PostgREST) vea las tablas y columnas nuevas (sale al COMMIT)
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';
