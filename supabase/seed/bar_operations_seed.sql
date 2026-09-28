-- Seed: Datos reales de barra de La Vieja Escuela

INSERT INTO bar_stock_items (name, category, unit, current_qty, current_detail, min_level, is_urgent, sort_order) VALUES
('Leche entera', 'lacteos', 'litros', 28, '2 fardos + 16 litros sueltos', 20, false, 1),
('Leche descremada', 'lacteos', 'litros', 21, '2 fardos + 9 litros sueltos', 12, false, 2),
('Leche 0% lactosa', 'lacteos', 'unidades', 0, 'Sin stock', 6, true, 3),
('Café Oyambre Santos Finos', 'cafe', 'kg', 7, '7 kg disponibles', 10, false, 10),
('Mate cocido', 'insumos_oyambre', 'saquitos', 57, '27 sueltos + 1 caja cerrada', 30, false, 20),
('Té negro', 'insumos_oyambre', 'saquitos', 46, '46 saquitos', 20, false, 21),
('Azúcar sobres', 'insumos_oyambre', 'cajas', 2.5, '2 cajas cerradas + 1 abierta', 1, false, 22),
('Edulcorante', 'insumos_oyambre', 'unidades', 0, 'Sin unidades selladas', 1, true, 23),
('Tablitas chocolate 70%', 'suministros', 'tablas', 0, 'Sin stock', 2, false, 30),
('Vasos descartables 18oz', 'packaging', 'unidades', 0, 'Sin stock', 50, false, 40),
('Dispensador cinta adhesiva', 'libreria', 'unidades', 0, 'Sin stock', 1, false, 50);

INSERT INTO bar_orders (product_name, category, quantity, urgency, status, note) VALUES
('Leche entera', 'lacteos', '2 fardos', 'normal', 'pending', 'Para cubrir demanda de fin de semana'),
('Leche 0% lactosa', 'lacteos', '1 fardo', 'urgente', 'pending', 'Stock en cero'),
('Café Oyambre Santos Finos', 'cafe', '~25 kg', 'alta', 'pending', 'Según consumo semanal'),
('Dispensador cinta adhesiva', 'libreria', '1 unidad', 'normal', 'pending', NULL),
('Vasos descartables 18oz', 'packaging', '50 unidades', 'alta', 'pending', 'Vasos grandes para café'),
('Tablitas chocolate 70%', 'suministros', '2 tablas', 'normal', 'pending', 'Para submarinos'),
('Edulcorante', 'insumos_oyambre', 'Pedido urgente', 'urgente', 'pending', 'Sin unidades selladas');
