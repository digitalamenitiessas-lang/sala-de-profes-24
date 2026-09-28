-- ============================================================================
-- MIGRACIÓN: Sistema operativo de cocina — Turnos, Checklists, Mise en Place
-- Fecha: 2026-03-18
-- ============================================================================
-- 5 tablas: kitchen_shifts, checklist_templates, checklist_items,
--           mise_en_place_items, mise_en_place_records
-- ============================================================================

-- ============================================================================
-- 1) kitchen_shifts — Turnos de cocina (mañana / noche)
-- ============================================================================

CREATE TABLE kitchen_shifts (
  id              bigserial    PRIMARY KEY,
  date            date         NOT NULL,
  shift_type      text         NOT NULL CHECK (shift_type IN ('morning', 'night')),
  status          text         NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'in_progress', 'completed')),
  opened_by       uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  closed_by       uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  handover_note   text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (date, shift_type)
);

COMMENT ON TABLE  kitchen_shifts IS 'Turnos de cocina: mañana (9-15) y noche (17-23)';
COMMENT ON COLUMN kitchen_shifts.shift_type IS 'morning = turno mañana, night = turno noche';
COMMENT ON COLUMN kitchen_shifts.handover_note IS 'Nota para el turno siguiente (producción cruzada)';

-- ============================================================================
-- 2) checklist_templates — Plantillas editables por encargados
-- ============================================================================

CREATE TABLE checklist_templates (
  id              bigserial    PRIMARY KEY,
  title           text         NOT NULL,
  description     text,
  type            text         NOT NULL CHECK (type IN ('opening', 'production', 'service', 'closing')),
  shift           text         NOT NULL CHECK (shift IN ('morning', 'night', 'both')),
  timing          text         NOT NULL CHECK (timing IN ('on_arrival', 'pre_service', 'during_service', 'closing', 'scheduled')),
  scheduled_time  text,        -- HH:MM, solo si timing = 'scheduled'
  family          text         NOT NULL DEFAULT 'general'
                               CHECK (family IN (
                                 'equipment', 'proteins', 'vegetables', 'pastry',
                                 'bread', 'dairy', 'cold_storage', 'mise_en_place', 'general'
                               )),
  is_critical     boolean      NOT NULL DEFAULT false,
  sort_order      integer      NOT NULL DEFAULT 0,
  is_active       boolean      NOT NULL DEFAULT true,
  created_by      uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  checklist_templates IS 'Plantillas de tareas de cocina, editables por encargados';
COMMENT ON COLUMN checklist_templates.timing IS 'Cuándo se debe ejecutar: on_arrival, pre_service, scheduled, etc.';
COMMENT ON COLUMN checklist_templates.family IS 'Familia/categoría: proteínas, verduras, equipos, mise_en_place, etc.';
COMMENT ON COLUMN checklist_templates.is_critical IS 'Si true, genera alerta cuando está overdue';

-- ============================================================================
-- 3) checklist_items — Instancias de tareas en un turno real
-- ============================================================================

CREATE TABLE checklist_items (
  id              bigserial    PRIMARY KEY,
  kitchen_shift_id bigint      NOT NULL REFERENCES kitchen_shifts(id) ON DELETE CASCADE,
  template_id     bigint       REFERENCES checklist_templates(id) ON DELETE SET NULL,
  title           text         NOT NULL,
  type            text         NOT NULL CHECK (type IN ('opening', 'production', 'service', 'closing')),
  timing          text         NOT NULL CHECK (timing IN ('on_arrival', 'pre_service', 'during_service', 'closing', 'scheduled')),
  scheduled_time  text,
  family          text         NOT NULL DEFAULT 'general',
  is_critical     boolean      NOT NULL DEFAULT false,
  sort_order      integer      NOT NULL DEFAULT 0,
  status          text         NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'done', 'skipped', 'overdue')),
  completed_by    uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at    timestamptz,
  note            text,
  is_alert_sent   boolean      NOT NULL DEFAULT false,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  checklist_items IS 'Instancia de tarea en un turno real (copiado de template)';
COMMENT ON COLUMN checklist_items.title IS 'Copiado del template al crear el turno, para historial';
COMMENT ON COLUMN checklist_items.is_alert_sent IS 'Flag para evitar alertas duplicadas';

-- ============================================================================
-- 4) mise_en_place_items — Producción esperada por turno (catálogo)
-- ============================================================================

CREATE TABLE mise_en_place_items (
  id              bigserial    PRIMARY KEY,
  name            text         NOT NULL,
  family          text         NOT NULL DEFAULT 'mise_en_place'
                               CHECK (family IN (
                                 'equipment', 'proteins', 'vegetables', 'pastry',
                                 'bread', 'dairy', 'cold_storage', 'mise_en_place', 'general'
                               )),
  unit            text         NOT NULL DEFAULT 'unidades',
  target_quantity numeric      NOT NULL DEFAULT 0,
  alert_threshold numeric      NOT NULL DEFAULT 0,
  shift           text         NOT NULL CHECK (shift IN ('morning', 'night', 'both')),
  recipe_id       bigint       REFERENCES recipes(id) ON DELETE SET NULL,
  is_active       boolean      NOT NULL DEFAULT true,
  sort_order      integer      NOT NULL DEFAULT 0,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  mise_en_place_items IS 'Catálogo de producciones (mise en place) esperadas por turno';
COMMENT ON COLUMN mise_en_place_items.target_quantity IS 'Cantidad objetivo a producir cada turno';
COMMENT ON COLUMN mise_en_place_items.alert_threshold IS 'Por debajo de este valor se genera alerta';

-- ============================================================================
-- 5) mise_en_place_records — Registro real de producción en un turno
-- ============================================================================

CREATE TABLE mise_en_place_records (
  id                        bigserial    PRIMARY KEY,
  kitchen_shift_id          bigint       NOT NULL REFERENCES kitchen_shifts(id) ON DELETE CASCADE,
  mise_en_place_item_id     bigint       NOT NULL REFERENCES mise_en_place_items(id) ON DELETE CASCADE,
  status                    text         NOT NULL DEFAULT 'pending'
                                         CHECK (status IN ('pending', 'in_progress', 'done', 'low', 'missing')),
  quantity_produced         numeric,
  produced_by               uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  note                      text,
  left_for_next_shift       boolean      NOT NULL DEFAULT false,
  quantity_left_for_next_shift numeric,
  created_at                timestamptz  NOT NULL DEFAULT now(),
  updated_at                timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (kitchen_shift_id, mise_en_place_item_id)
);

COMMENT ON TABLE  mise_en_place_records IS 'Registro real de producción en un turno de cocina';
COMMENT ON COLUMN mise_en_place_records.left_for_next_shift IS 'Indica si queda disponible para el turno siguiente';

-- ============================================================================
-- ÍNDICES
-- ============================================================================

CREATE INDEX idx_kitchen_shifts_date ON kitchen_shifts (date);
CREATE INDEX idx_kitchen_shifts_status ON kitchen_shifts (status) WHERE status != 'completed';
CREATE INDEX idx_checklist_items_shift ON checklist_items (kitchen_shift_id);
CREATE INDEX idx_checklist_items_status ON checklist_items (status) WHERE status = 'pending' OR status = 'overdue';
CREATE INDEX idx_checklist_templates_shift ON checklist_templates (shift) WHERE is_active = true;
CREATE INDEX idx_mise_records_shift ON mise_en_place_records (kitchen_shift_id);
CREATE INDEX idx_mise_items_active ON mise_en_place_items (shift) WHERE is_active = true;

-- ============================================================================
-- TRIGGERS — updated_at automático
-- ============================================================================

CREATE TRIGGER trg_kitchen_shifts_updated_at
  BEFORE UPDATE ON kitchen_shifts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_checklist_templates_updated_at
  BEFORE UPDATE ON checklist_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_checklist_items_updated_at
  BEFORE UPDATE ON checklist_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_mise_en_place_items_updated_at
  BEFORE UPDATE ON mise_en_place_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_mise_en_place_records_updated_at
  BEFORE UPDATE ON mise_en_place_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE kitchen_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kitchen_shifts_select" ON kitchen_shifts FOR SELECT USING (true);
CREATE POLICY "kitchen_shifts_insert" ON kitchen_shifts FOR INSERT
  WITH CHECK (auth_role() IN ('encargado', 'chef', 'cocina'));
CREATE POLICY "kitchen_shifts_update" ON kitchen_shifts FOR UPDATE
  USING (auth_role() IN ('encargado', 'chef', 'cocina'));

ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checklist_templates_select" ON checklist_templates FOR SELECT USING (true);
CREATE POLICY "checklist_templates_insert" ON checklist_templates FOR INSERT
  WITH CHECK (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "checklist_templates_update" ON checklist_templates FOR UPDATE
  USING (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "checklist_templates_delete" ON checklist_templates FOR DELETE
  USING (auth_role() = 'encargado');

ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checklist_items_select" ON checklist_items FOR SELECT USING (true);
CREATE POLICY "checklist_items_insert" ON checklist_items FOR INSERT
  WITH CHECK (auth_role() IN ('encargado', 'chef', 'cocina'));
CREATE POLICY "checklist_items_update" ON checklist_items FOR UPDATE
  USING (auth_role() IN ('encargado', 'chef', 'cocina'));

ALTER TABLE mise_en_place_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mise_en_place_items_select" ON mise_en_place_items FOR SELECT USING (true);
CREATE POLICY "mise_en_place_items_insert" ON mise_en_place_items FOR INSERT
  WITH CHECK (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "mise_en_place_items_update" ON mise_en_place_items FOR UPDATE
  USING (auth_role() IN ('encargado', 'chef'));
CREATE POLICY "mise_en_place_items_delete" ON mise_en_place_items FOR DELETE
  USING (auth_role() = 'encargado');

ALTER TABLE mise_en_place_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mise_en_place_records_select" ON mise_en_place_records FOR SELECT USING (true);
CREATE POLICY "mise_en_place_records_insert" ON mise_en_place_records FOR INSERT
  WITH CHECK (auth_role() IN ('encargado', 'chef', 'cocina'));
CREATE POLICY "mise_en_place_records_update" ON mise_en_place_records FOR UPDATE
  USING (auth_role() IN ('encargado', 'chef', 'cocina'));

-- ============================================================================
-- FIN DE MIGRACIÓN
-- ============================================================================
