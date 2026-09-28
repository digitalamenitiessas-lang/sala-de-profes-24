-- ============================================================================
-- SEED: Datos reales de cocina de La Vieja Escuela
-- Basado en CHECK LIST COCINA (LVE) + STOCK.pdf
-- ============================================================================

-- Limpiar seeds anteriores
DELETE FROM mise_en_place_items;
DELETE FROM checklist_templates;

-- ============================================================================
-- CHECKLIST TEMPLATES — TURNO MAÑANA
-- ============================================================================

-- ── Al entrar (on_arrival) ──────────────────────────────────────────────────

INSERT INTO checklist_templates (title, description, type, shift, timing, family, is_critical, sort_order) VALUES
('Control de verdes / heladera', 'Revisar temperatura, orden y producciones del turno noche. Todo cubierto y etiquetado.', 'opening', 'morning', 'on_arrival', 'cold_storage', true, 1),
('Control de verdulería', 'Tomates redondos, cherry, pimientos, ajo, apio, perejil, acelga, albahaca, cebollas, papas, banana, manzana, peras. Separar lo que no sirve.', 'opening', 'morning', 'on_arrival', 'vegetables', true, 2),
('Control de panes', 'Medialunas, bollitos, tortillas, baguetín, ciabatta, tostón de campo, molde de campo (light). Verificar cantidad para el servicio.', 'opening', 'morning', 'on_arrival', 'bread', true, 3),
('Control de pastelería', 'Miel, cookies, roll de canela, cuadrados de limón, brownie, chipá, budín, alfajores.', 'opening', 'morning', 'on_arrival', 'pastry', false, 4),
('Control de lácteos', 'Tybo, cheddar, jamón crudo, jamón cocido, cantimpalo, mozzarella, yogurt griego, leche.', 'opening', 'morning', 'on_arrival', 'dairy', true, 5),
('Control de proteínas', 'Carne molida, nalga, bondiola/osobuco, lomo. Producido: milanesas, albóndigas, hamburguesas, lomo sandwich, lomo grueso.', 'opening', 'morning', 'on_arrival', 'proteins', true, 6),
('Revisar producción del turno noche', 'Ver nota de handover. ¿Qué dejó listo? ¿Qué hay que retomar?', 'opening', 'morning', 'on_arrival', 'mise_en_place', true, 7);

-- ── Con horario fijo (scheduled) ────────────────────────────────────────────

INSERT INTO checklist_templates (title, description, type, shift, timing, scheduled_time, family, is_critical, sort_order) VALUES
('Puré de papas en marcha', 'Pelar, cortar y poner a hervir. Objetivo: 2 GN llenas listas para las 12:00.', 'production', 'morning', 'scheduled', '10:30', 'mise_en_place', true, 10),
('Encender freidora', 'Verificar aceite. Temp objetivo: 180°C. Esperar que llegue antes de usar.', 'production', 'morning', 'scheduled', '11:00', 'equipment', true, 11),
('Encender horno pizzero', 'Temp según producto. Tarda ~20-25 min en llegar.', 'production', 'morning', 'scheduled', '11:00', 'equipment', true, 12),
('Marcar papas para servicio', 'Precocinar y condimentar. Listas antes de las 12:00.', 'production', 'morning', 'scheduled', '11:30', 'mise_en_place', true, 13);

-- ── Pre-servicio ────────────────────────────────────────────────────────────

INSERT INTO checklist_templates (title, description, type, shift, timing, family, is_critical, sort_order) VALUES
('Verificar mise en place completa', 'Recorrer frío, caliente y pase. Todo en su lugar para servicio.', 'service', 'morning', 'pre_service', 'general', true, 20),
('Control de salsas y aderezos', 'Lactonesa, chimi pizzero, chimi de lomo, aderezo César, salsa tomate, mayonesa.', 'service', 'morning', 'pre_service', 'mise_en_place', false, 21),
('Cortesía lista', 'Tiras de panes tostados cortadas y listas.', 'service', 'morning', 'pre_service', 'bread', false, 22);

-- ── Cierre ──────────────────────────────────────────────────────────────────

INSERT INTO checklist_templates (title, description, type, shift, timing, family, is_critical, sort_order) VALUES
('Apagar freidora y cubrir', 'Apagar, enfriar, tapar. Registrar estado del aceite.', 'closing', 'morning', 'closing', 'equipment', true, 30),
('Apagar horno pizzero', 'Verificar que esté apagado y limpio.', 'closing', 'morning', 'closing', 'equipment', true, 31),
('Cubrir y etiquetar mise en place', 'Todo cubierto, etiquetado con fecha/hora, en temperatura correcta.', 'closing', 'morning', 'closing', 'mise_en_place', true, 32),
('Checklist de producción para turno noche', 'Completar nota de handover. Qué falta, qué está listo, novedades.', 'closing', 'morning', 'closing', 'general', true, 33);

-- ============================================================================
-- CHECKLIST TEMPLATES — TURNO NOCHE
-- ============================================================================

-- ── Al entrar (on_arrival) ──────────────────────────────────────────────────

INSERT INTO checklist_templates (title, description, type, shift, timing, family, is_critical, sort_order) VALUES
('Control de verdes / heladera', 'Revisar temperatura, orden y producciones del turno mañana. Todo cubierto y etiquetado.', 'opening', 'night', 'on_arrival', 'cold_storage', true, 1),
('Control de verdulería', 'Tomates redondos, cherry, pimientos, ajo, apio, perejil, acelga, cebollas, papas. Separar lo que no sirve.', 'opening', 'night', 'on_arrival', 'vegetables', true, 2),
('Control de pastelería', 'Revisar pastelería disponible para el servicio nocturno.', 'opening', 'night', 'on_arrival', 'pastry', false, 3),
('Control de panes', 'Brioche, ciabattas, tortillas. Verificar cantidad suficiente.', 'opening', 'night', 'on_arrival', 'bread', true, 4),
('Control de lácteos', 'Tybo, cheddar, mozzarella, crema, leche.', 'opening', 'night', 'on_arrival', 'dairy', false, 5),
('Control de proteínas', 'Verificar estado de todo lo producido del turno mañana.', 'opening', 'night', 'on_arrival', 'proteins', true, 6),
('Revisar producción del turno mañana', 'Ver nota de handover. ¿Qué dejó listo? ¿Qué hay que retomar?', 'opening', 'night', 'on_arrival', 'mise_en_place', true, 7);

-- ── Con horario fijo (scheduled) ────────────────────────────────────────────

INSERT INTO checklist_templates (title, description, type, shift, timing, scheduled_time, family, is_critical, sort_order) VALUES
('Descongelar proteínas y avisar cantidades', 'Sacar del freezer lo necesario para mañana. Informar cantidades.', 'production', 'night', 'scheduled', '18:00', 'proteins', true, 10),
('Puré de papas en marcha', 'Pelar, cortar y hervir. Objetivo: 2 GN para las 20:00.', 'production', 'night', 'scheduled', '18:30', 'mise_en_place', true, 11),
('Encender freidora', 'Verificar aceite. Temp 180°C.', 'production', 'night', 'scheduled', '19:00', 'equipment', true, 12),
('Encender horno pizzero', 'Temp según producto.', 'production', 'night', 'scheduled', '19:00', 'equipment', true, 13),
('Marcar papas para servicio', 'Precocinar y condimentar. Listas para las 20:00.', 'production', 'night', 'scheduled', '19:45', 'mise_en_place', true, 14),
('Decoraciones', 'Preparar decoraciones de platos.', 'production', 'night', 'scheduled', '19:45', 'mise_en_place', false, 15);

-- ── Pre-servicio ────────────────────────────────────────────────────────────

INSERT INTO checklist_templates (title, description, type, shift, timing, family, is_critical, sort_order) VALUES
('Verificar mise en place completa', 'Recorrer frío, caliente y pase. Todo listo para servicio.', 'service', 'night', 'pre_service', 'general', true, 20),
('Control de salsas y aderezos', 'Lactonesa, chimi pizzero, chimi de lomo, aderezo César, salsas.', 'service', 'night', 'pre_service', 'mise_en_place', false, 21);

-- ── Cierre ──────────────────────────────────────────────────────────────────

INSERT INTO checklist_templates (title, description, type, shift, timing, family, is_critical, sort_order) VALUES
('Apagar freidora, horno y equipos', 'Apagar todo. Dejar enfriar antes de cubrir.', 'closing', 'night', 'closing', 'equipment', true, 30),
('Cubrir y etiquetar mise en place', 'Todo cubierto, etiquetado con fecha/hora, en temperatura correcta.', 'closing', 'night', 'closing', 'mise_en_place', true, 31),
('Checklist de producción para turno mañana', 'Completar nota de handover. Informar qué falta, qué está listo.', 'closing', 'night', 'closing', 'general', true, 32);

-- ============================================================================
-- MISE EN PLACE ITEMS — Producción real de LVE
-- ============================================================================

-- ── Salsas y aderezos ───────────────────────────────────────────────────────

INSERT INTO mise_en_place_items (name, family, unit, target_quantity, alert_threshold, shift, sort_order) VALUES
('Lactonesa', 'mise_en_place', 'litros', 1, 0.3, 'both', 1),
('Chimi pizzero', 'mise_en_place', 'litros', 0.5, 0.15, 'both', 2),
('Chimi de lomo', 'mise_en_place', 'litros', 0.5, 0.15, 'both', 3),
('Aderezo César', 'mise_en_place', 'litros', 0.5, 0.15, 'both', 4),
('Salsa pizza / napolitana', 'mise_en_place', 'litros', 1, 0.3, 'both', 5),
('Salsa portuguesa', 'mise_en_place', 'litros', 0.5, 0.15, 'both', 6),
('Reducción demiglace', 'mise_en_place', 'litros', 0.3, 0.1, 'both', 7),
('Pesto', 'mise_en_place', 'litros', 0.3, 0.1, 'both', 8),
('Aceite verde', 'mise_en_place', 'litros', 0.3, 0.1, 'both', 9),
('Almíbar', 'mise_en_place', 'litros', 0.5, 0.15, 'both', 10),
('Salsa de chocolate', 'mise_en_place', 'litros', 0.3, 0.1, 'both', 11);

-- ── Guarniciones y bases ────────────────────────────────────────────────────

INSERT INTO mise_en_place_items (name, family, unit, target_quantity, alert_threshold, shift, sort_order) VALUES
('Puré de papas', 'mise_en_place', 'GN', 2, 1, 'both', 20),
('Papas marcadas', 'mise_en_place', 'porciones', 30, 10, 'both', 21),
('Crutones', 'mise_en_place', 'porciones', 20, 5, 'both', 22),
('Arroz primavera', 'mise_en_place', 'GN', 1, 0, 'both', 23),
('Arroz marcado risotto', 'mise_en_place', 'GN', 1, 0, 'both', 24),
('Sofrito risotto', 'mise_en_place', 'GN', 1, 0, 'both', 25),
('Caldo en olla', 'mise_en_place', 'litros', 3, 1, 'both', 26),
('Masas de pizza', 'mise_en_place', 'unidades', 10, 3, 'both', 27),
('Cortesía panes tostados', 'bread', 'porciones', 20, 5, 'both', 28);

-- ── Proteínas producidas ────────────────────────────────────────────────────

INSERT INTO mise_en_place_items (name, family, unit, target_quantity, alert_threshold, shift, sort_order) VALUES
('Milanesas empanadas', 'proteins', 'unidades', 20, 6, 'both', 30),
('Hamburguesas 100g', 'proteins', 'unidades', 15, 4, 'both', 31),
('Albóndigas 90g', 'proteins', 'unidades', 15, 4, 'both', 32),
('Bondiola/osobuco braseado', 'proteins', 'kg', 1.5, 0.4, 'both', 33),
('Lomo sandwich descongelado', 'proteins', 'unidades', 6, 2, 'both', 34),
('Lomo grueso (LVE) descongelado', 'proteins', 'unidades', 4, 1, 'both', 35);

-- ── Vegetales y mise en place frío ──────────────────────────────────────────

INSERT INTO mise_en_place_items (name, family, unit, target_quantity, alert_threshold, shift, sort_order) VALUES
('Rúcula deshojada', 'vegetables', 'GN', 1, 0, 'both', 40),
('Verduras asadas', 'vegetables', 'GN', 1, 0, 'both', 41),
('Mix para salteado', 'vegetables', 'GN', 1, 0, 'both', 42),
('Morrones asados', 'vegetables', 'GN', 1, 0, 'both', 43),
('Cebollas caramelizadas', 'mise_en_place', 'GN', 1, 0, 'both', 44),
('Cherry confitados', 'mise_en_place', 'GN', 1, 0, 'both', 45),
('Tomates secos hidratados', 'mise_en_place', 'GN', 1, 0, 'both', 46),
('Panceta en cubos / salteada', 'proteins', 'GN', 1, 0, 'both', 47);

-- ── Quesos porcionados ──────────────────────────────────────────────────────

INSERT INTO mise_en_place_items (name, family, unit, target_quantity, alert_threshold, shift, sort_order) VALUES
('Mozzarella pizza 400g', 'dairy', 'porciones', 10, 3, 'both', 50),
('Mozzarella rallada 70g', 'dairy', 'porciones', 15, 5, 'both', 51),
('Cheddar feteado', 'dairy', 'porciones', 15, 5, 'both', 52),
('Parmesano rallado', 'dairy', 'GN', 1, 0, 'both', 53),
('Fiambres feteados', 'dairy', 'GN', 1, 0, 'morning', 54);

-- ── Mise en place servicio (GN listos) ──────────────────────────────────────

INSERT INTO mise_en_place_items (name, family, unit, target_quantity, alert_threshold, shift, sort_order) VALUES
('Lechuga lavada y seca', 'vegetables', 'GN', 1, 0, 'both', 60),
('Tomates rodaja', 'vegetables', 'GN', 1, 0, 'both', 61),
('Verdeo picado', 'vegetables', 'GN', 1, 0, 'both', 62),
('Huevos cascados', 'mise_en_place', 'tupper', 1, 0, 'both', 63),
('Parme y manteca en GN', 'dairy', 'GN', 1, 0, 'both', 64),
('Papas cubos para tortilla', 'mise_en_place', 'GN', 1, 0, 'both', 65),
('Mozza sandwich en GN', 'dairy', 'GN', 1, 0, 'both', 66);

-- ── Pastelería y granola ────────────────────────────────────────────────────

INSERT INTO mise_en_place_items (name, family, unit, target_quantity, alert_threshold, shift, sort_order) VALUES
('Granola de la casa', 'pastry', 'GN', 1, 0, 'morning', 70),
('Brioche descongelados', 'bread', 'unidades', 10, 3, 'both', 71),
('Ciabattas descongelados', 'bread', 'unidades', 10, 3, 'both', 72);

-- ── Postres ─────────────────────────────────────────────────────────────────

INSERT INTO mise_en_place_items (name, family, unit, target_quantity, alert_threshold, shift, sort_order) VALUES
('Arroz con leche', 'pastry', 'porciones', 6, 2, 'both', 80),
('Panqueques', 'pastry', 'unidades', 8, 2, 'both', 81),
('Vigilante', 'pastry', 'porciones', 6, 2, 'both', 82);

-- ============================================================================
-- FIN SEED
-- ============================================================================
