-- ==========================================================================
-- Migration: menu_items
-- Carta / menu del restaurante La Vieja Escuela
-- ==========================================================================

CREATE TABLE public.menu_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  description           text,
  category              text NOT NULL,
  subcategory           text,
  is_active             boolean NOT NULL DEFAULT true,
  requires_preparation  boolean NOT NULL DEFAULT false,
  track_stock           boolean NOT NULL DEFAULT true,
  sort_order            int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_menu_items_category ON public.menu_items (category);
CREATE INDEX idx_menu_items_active ON public.menu_items (is_active) WHERE is_active = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_menu_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_menu_items_updated_at
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_menu_items_updated_at();

-- -------------------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------------------

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "menu_items_select" ON public.menu_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
    )
  );

-- Only encargado and chef can insert
CREATE POLICY "menu_items_insert" ON public.menu_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('encargado', 'chef')
    )
  );

-- Only encargado and chef can update
CREATE POLICY "menu_items_update" ON public.menu_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('encargado', 'chef')
    )
  );

-- =========================================================================
-- Seed: 59 menu items de la carta real de LVE
-- =========================================================================

INSERT INTO public.menu_items (name, description, category, subcategory, is_active, requires_preparation, track_stock, sort_order) VALUES
-- DESAYUNOS Y MERIENDAS - Combos (4)
('Clásico', 'Infusión + 2 bollitos, 2 tortillas o 2 medialunas', 'desayunos_meriendas', 'combos', true, true, true, 1),
('LVE Light (o no)', 'Opción 1: pan de la casa + mermelada + queso crema + mini griego. Opción 2: pan de la casa + dulce de leche + manteca + mini griego', 'desayunos_meriendas', 'combos', true, true, true, 2),
('Proteico', 'Porción de huevos revueltos + panceta + pan + tomate confitado + queso crema. Puede adicionar palta', 'desayunos_meriendas', 'combos', true, true, true, 3),
('Energético', 'Bowl de yogurt griego casero + frutas de estación + granola de la casa + dips de miel y dulces', 'desayunos_meriendas', 'combos', true, true, true, 4),

-- ENTREPANES - Ciabattas y Baguetín (4)
('Ciabatta de J&Q', 'Sanguchito clásico de jamón y queso', 'entrepanes', 'ciabattas_baguetin', true, true, true, 10),
('Ciabatta de crudo', 'Sanguchito de jamón crudo y queso muzzarella', 'entrepanes', 'ciabattas_baguetin', true, true, true, 11),
('Ciabatta Vege', 'Sanguchito de muzzarella y tomates deshidratados', 'entrepanes', 'ciabattas_baguetin', true, true, true, 12),
('Baguetín de Mortadela', 'Baguetín con mortadela, muzzarella y pesto de la casa', 'entrepanes', 'ciabattas_baguetin', true, true, true, 13),

-- TOSTONES (3)
('Fit', 'Queso crema, palta y huevo. Puede adicionar panceta', 'tostones', 'tostones', true, true, true, 20),
('Mediterráneo', 'Hojas de rúcula, jamón crudo, tomate deshidratado y aceite de perejil', 'tostones', 'tostones', true, true, true, 21),
('La Vieja Escuela', 'Muzzarella gratinada, jamón cocido, huevo a la plancha y tomate cherry fresco', 'tostones', 'tostones', true, true, true, 22),

-- SIN TRIGO - Sin TACC (4)
('Tostadas sin TACC', 'Porción + 2 dips a elección', 'sin_trigo', 'sin_tacc', true, true, true, 30),
('Alfajor sin TACC', 'Alfajor de maicena y dulce de leche', 'sin_trigo', 'sin_tacc', false, false, false, 31),
('Pastafrola sin TACC', 'Clásica de membrillo', 'sin_trigo', 'sin_tacc', false, false, false, 32),
('Brownie sin TACC', 'Sale tibio', 'sin_trigo', 'sin_tacc', false, false, false, 33),

-- PANADERÍA SALADA - Panificados (3)
('Tortilla', 'Agua, harina, levadura y grasa. Doblada y al horno', 'panaderia_salada', 'panificados', true, false, true, 40),
('Bollito', 'Agua, harina, levadura y grasa', 'panaderia_salada', 'panificados', true, false, true, 41),
('Chipá', 'Base de harina de mandioca, quesos duros y blandos, manteca, leche y huevo', 'panaderia_salada', 'panificados', true, false, true, 42),

-- ENTRADAS (4)
('Buñuelos de Acelga', 'Crocantes, aireados, con dip de lactonesa de la casa', 'entradas', 'entradas', true, true, true, 50),
('Tortilla de papa', 'Nuestra versión de un clásico bodegonero', 'entradas', 'entradas', true, true, true, 51),
('Bastón de Muzza', 'Bastones de queso muzzarella con dip del lajuja', 'entradas', 'entradas', true, true, true, 52),
('Empanadas', 'De carne, pollo o queso. Fritas o al horno', 'entradas', 'entradas', true, true, true, 53),

-- ENSALADAS (3)
('La César', 'Hojas verdes, cubos de pollo, panceta, queso, aderezo César y crutones', 'ensaladas', 'ensaladas', true, true, true, 60),
('El Salteado', 'Cebolla, morrón verde y rojo, zucchini, zapallito verde, berenjena y zanahoria. Opcional carne o pollo', 'ensaladas', 'ensaladas', true, true, true, 61),
('El Sanguchito Vege', 'Salteado de vegetales, con huevo y queso muzzarella. Sale con papas', 'ensaladas', 'ensaladas', true, true, true, 62),

-- KIDS (3)
('Salchimila a LVE', 'Tiras de salchicha y lomo empanizado', 'kids', 'kids', true, true, true, 70),
('Hamburguesita', 'Pan brioche, hamburguesa y queso', 'kids', 'kids', true, true, true, 71),
('Milanesita', 'Milanesita de nalga, con papafritas o puré de papas', 'kids', 'kids', true, true, true, 72),

-- ESPECIALIDADES - Platos principales (5)
('Mila con Papas', 'Milanesa de nalga con papafritas', 'especialidades', 'platos_principales', true, true, true, 80),
('Albóndigas con Puré', 'Albóndigas a la portuguesa con guarnición de puré de papas', 'especialidades', 'platos_principales', true, true, true, 81),
('Napo con Puré', 'Milanesa de nalga con salsa, jamón y queso. Con guarnición de puré de papas', 'especialidades', 'platos_principales', true, true, true, 82),
('Risotto a La Vieja Escuela', 'Especialidad variable del laboratorio gastronómico', 'especialidades', 'platos_principales', true, true, true, 83),
('Lomo a La Vieja Escuela', 'Bife de lomo con salsa LVE. Sale con papas, ensalada mixta, arroz o verduras salteadas', 'especialidades', 'platos_principales', true, true, true, 84),

-- PIZZAS (6)
('Muzza', 'La clásica de muzzarella con aceitunas y aceite pizzero', 'pizzas', 'pizzas', true, true, true, 90),
('Napo Confitada', 'Muzza más tomatitos cherry confitados', 'pizzas', 'pizzas', true, true, true, 91),
('La especial', 'Muzzarella, aceitunas, jamón y morrones', 'pizzas', 'pizzas', true, true, true, 92),
('Calabresa', 'Muzzarella y cantimpalo', 'pizzas', 'pizzas', true, true, true, 93),
('La Puerca', 'Muzzarella, cheddar y panceta', 'pizzas', 'pizzas', true, true, true, 94),
('Fugazza', 'Ríos de muzzarella y toneladas de cebolla', 'pizzas', 'pizzas', true, true, true, 95),

-- ENTRE PANES - Sandwiches principales (6)
('El de Pollo', 'Pan brioche de papa, pollo a la plancha con ensalada coleslaw', 'entre_panes', 'sandwiches_principales', true, true, true, 100),
('Hamburguesa LVE', 'Pan brioche de papa, fat smash, cheddar, panceta, lechuga y tomate', 'entre_panes', 'sandwiches_principales', true, true, true, 101),
('La Bondiola', 'Ciabatta clásica, bondiola deshebrada a la barbacoa', 'entre_panes', 'sandwiches_principales', true, true, true, 102),
('Braseado LVE', 'Preparación variable del laboratorio gastronómico con distintos cortes de res y panes', 'entre_panes', 'sandwiches_principales', true, true, true, 103),
('Cheesteack', 'Philly cheesesteak con carne, cebolla y queso cheddar en pan de papa', 'entre_panes', 'sandwiches_principales', true, true, true, 104),
('Lomo Completo', 'Ciabatta, bifes de nalga, jamón, queso, huevo, lechuga y tomate', 'entre_panes', 'sandwiches_principales', true, true, true, 105),

-- BEBIDAS - Sin alcohol (5)
('Coquita de vidrio', 'Gaseosa línea Coca', 'bebidas', 'sin_alcohol', true, false, true, 110),
('Coca de litro', 'Gaseosa línea Coca', 'bebidas', 'sin_alcohol', true, false, true, 111),
('Aquarius', 'Agua saborizada de pera', 'bebidas', 'sin_alcohol', true, false, true, 112),
('Schweppes', 'Agua tónica o saborizada de pomelo', 'bebidas', 'sin_alcohol', true, false, true, 113),
('Limonada', 'Jarra de limonada regular o de frutos rojos. También vaso', 'bebidas', 'sin_alcohol', true, true, true, 114),

-- BEBIDAS - Con alcohol (6)
('Vermut', 'Bebida alcohólica', 'bebidas', 'con_alcohol', true, false, true, 120),
('Gin Tonic', 'Bebida alcohólica preparada', 'bebidas', 'con_alcohol', true, true, true, 121),
('Fernet con Coca', 'Bebida alcohólica preparada', 'bebidas', 'con_alcohol', true, true, true, 122),
('Vinos', 'Botella de vino', 'bebidas', 'con_alcohol', true, false, true, 123),
('Copa de Vino', 'Servicio por copa', 'bebidas', 'con_alcohol', true, false, true, 124),
('Cerveza', 'Stella Artois, Heineken, Pampa o Rabieta', 'bebidas', 'con_alcohol', true, false, true, 125),

-- POSTRES (3)
('Vigilante', 'Dulce de batata o membrillo con queso', 'postres', 'postres', true, false, true, 130),
('Panqueques a La Vieja Escuela', 'Panqueques con dulce de leche', 'postres', 'postres', true, true, true, 131),
('Arroz con Leche', 'Postre de la casa', 'postres', 'postres', true, false, true, 132);
