// ---------------------------------------------------------------------------
// Chef Recipe Corpus — structured real recipes from La Vieja Escuela
// ---------------------------------------------------------------------------
// Source of truth for gastronomy. FUDO integrates later as commercial layer.
// This file contains the normalized, typed corpus ready for DB ingestion.
// ---------------------------------------------------------------------------

export type CorpusIngredient = {
  producto: string
  cantidad: number | null
  unidad: string | null
  detalle?: string
  opcional?: boolean
}

export type CorpusVariant = {
  nombre: string
  ingredientes_extra?: CorpusIngredient[]
  detalle?: string
  pasos_extra?: string[]
}

export type CorpusRecipe = {
  slug: string
  nombre: string
  categoria: 'plato' | 'sandwich' | 'postre' | 'pizza' | 'preparacion_base' | 'guarnicion' | 'bebida'
  ingredientes: CorpusIngredient[]
  ingredientes_base?: CorpusIngredient[] // for pizza base
  pasos: string[]
  notas: string[]
  variantes: CorpusVariant[]
  guarnicion: string | null
  estado: 'completa' | 'incompleta'
  // Derived during analysis
  depends_on?: string[] // slugs of sub-recipes
  is_base_preparation?: boolean
}

// ---------------------------------------------------------------------------
// Ingredient classification
// ---------------------------------------------------------------------------

export type IngredientClassification =
  | 'atomico'           // raw ingredient (cebolla, sal, huevo)
  | 'preparacion_base'  // sub-recipe (salsa LVE, vegetales asados)
  | 'guarnicion'        // side dish (papas fritas, puré)
  | 'ambiguo'           // needs manual resolution (carne o pollo)
  | 'pendiente'         // not enough info

export type NormalizedIngredient = {
  original_name: string
  normalized_name: string
  classification: IngredientClassification
  cantidad: number | null
  unidad: string | null
  confidence: 'alta' | 'media' | 'baja'
  requires_review: boolean
  review_reason: string | null
  recipe_slug: string
}

// ---------------------------------------------------------------------------
// THE CORPUS
// ---------------------------------------------------------------------------

export const RECIPE_CORPUS: CorpusRecipe[] = [
  {
    slug: 'el-salteado',
    nombre: 'El Salteado',
    categoria: 'plato',
    ingredientes: [
      { producto: 'cebolla', cantidad: 40, unidad: 'gr' },
      { producto: 'zanahoria', cantidad: 40, unidad: 'gr' },
      { producto: 'morrón verde', cantidad: 40, unidad: 'gr' },
      { producto: 'morrón rojo', cantidad: 40, unidad: 'gr' },
      { producto: 'berenjena', cantidad: 40, unidad: 'gr' },
      { producto: 'zucchini', cantidad: 40, unidad: 'gr' },
      { producto: 'zapallito verde', cantidad: 40, unidad: 'gr' },
      { producto: 'carne o pollo', cantidad: 150, unidad: 'gr', opcional: true },
      { producto: 'mostaza', cantidad: 0.5, unidad: 'cucharada' },
      { producto: 'salsa de soja', cantidad: 20, unidad: 'ml' },
      { producto: 'salsa inglesa', cantidad: null, unidad: null },
      { producto: 'semillas de sésamo', cantidad: null, unidad: null },
    ],
    pasos: [
      'Cortar la cebolla en plumas y el resto de las verduras en juliana.',
      'En sartén con aceite caliente, cocinar primero la zanahoria durante 1 minuto.',
      'Agregar los morrones y cocinar 2 minutos.',
      'Agregar la cebolla y salpimentar.',
      'Agregar berenjena, zucchini y zapallitos, y condimentar.',
      'Emplatar en plato hondo con semillas y rulos de cebolla de verdeo.',
    ],
    notas: ['Si lleva carne, cortarla en tiras y precocer en plancha.'],
    variantes: [],
    guarnicion: null,
    estado: 'completa',
    depends_on: [],
  },
  {
    slug: 'el-sanguchito-vege',
    nombre: 'El Sanguchito Vege',
    categoria: 'sandwich',
    ingredientes: [
      { producto: 'pan ciabatta', cantidad: 1, unidad: 'unidad' },
      { producto: 'vegetales asados', cantidad: 200, unidad: 'gr', detalle: 'cebolla, morrones, zanahoria, zucchini, zapallitos y berenjenas con salsa inglesa, soja, mostaza, sal y pimienta' },
      { producto: 'queso mozzarella', cantidad: 70, unidad: 'gr' },
      { producto: 'huevos', cantidad: 2, unidad: 'unidad' },
    ],
    pasos: ['Tostar el pan y gratinar el queso.', 'Calentar los vegetales asados.', 'Preparar huevos revueltos.', 'Montar el sándwich.', 'Emplatar con porción de papas y dip de lactonesa del día.'],
    notas: [],
    variantes: [],
    guarnicion: 'papas con dip de lactonesa del día',
    estado: 'completa',
    depends_on: ['vegetales-asados', 'lactonesa-del-dia'],
  },
  {
    slug: 'arroz-con-leche',
    nombre: 'Arroz con Leche',
    categoria: 'postre',
    ingredientes: [
      { producto: 'leche en polvo preparada', cantidad: 1, unidad: 'lt' },
      { producto: 'arroz largo fino común', cantidad: 180, unidad: 'gr' },
      { producto: 'azúcar', cantidad: 200, unidad: 'gr' },
      { producto: 'canela', cantidad: 1, unidad: 'ramita' },
      { producto: 'piel de limón', cantidad: 1, unidad: 'tajadita' },
    ],
    pasos: ['Hervir la leche con azúcar, piel de limón y canela.', 'Mezclar hasta disolver el azúcar y agregar el arroz.', 'Revolver periódicamente para liberar el almidón.', 'Vaciar en placa para enfriamiento rápido, cubriendo con film.', 'Servir en vasito de soda con corazón de dulce de leche y decorar con cacao amargo.'],
    notas: [],
    variantes: [],
    guarnicion: null,
    estado: 'completa',
  },
  {
    slug: 'vigilante',
    nombre: 'Vigilante',
    categoria: 'postre',
    ingredientes: [
      { producto: 'queso tybo', cantidad: 80, unidad: 'gr' },
      { producto: 'dulce de batata o membrillo', cantidad: 80, unidad: 'gr' },
    ],
    pasos: ['Cortar fetones a la mitad.', 'Emplatar superponiendo rectángulos.', 'Decorar con salsa de chocolate en hilos diagonales.'],
    notas: [],
    variantes: [{ nombre: 'Batata', detalle: 'Con dulce de batata.' }, { nombre: 'Membrillo', detalle: 'Con dulce de membrillo.' }],
    guarnicion: null,
    estado: 'completa',
  },
  {
    slug: 'lomo-completo',
    nombre: 'Lomo Completo',
    categoria: 'sandwich',
    ingredientes: [
      { producto: 'pan ciabatta', cantidad: 1, unidad: 'unidad' },
      { producto: 'bife de nalga', cantidad: 200, unidad: 'gr' },
      { producto: 'jamón', cantidad: 1, unidad: 'feta' },
      { producto: 'queso mozzarella', cantidad: 70, unidad: 'gr' },
      { producto: 'huevos', cantidad: 2, unidad: 'unidad' },
      { producto: 'lechuga', cantidad: null, unidad: null },
      { producto: 'tomate', cantidad: null, unidad: null },
    ],
    pasos: ['Dorar el pan y gratinar el queso.', 'Cocinar el bife en plancha.', 'Cocinar los huevos con jamón.', 'Montar el sándwich.', 'Servir con papas.'],
    notas: [],
    variantes: [],
    guarnicion: 'papas',
    estado: 'completa',
  },
  {
    slug: 'panqueque',
    nombre: 'Panqueque',
    categoria: 'postre',
    ingredientes: [
      { producto: 'leche', cantidad: 1, unidad: 'lt' },
      { producto: 'harina 0000', cantidad: 200, unidad: 'gr' },
      { producto: 'azúcar', cantidad: 3, unidad: 'cucharadas' },
      { producto: 'huevos', cantidad: 3, unidad: 'unidad' },
    ],
    pasos: ['Realizar la mezcla y mixear.', 'Cocinar los panqueques y reservar en frío.', 'Rellenar con 2 cucharadas de dulce de leche.', 'Emplatar en forma de pañuelo con bocha de helado borracho.'],
    notas: [],
    variantes: [],
    guarnicion: 'bocha de helado borracho',
    estado: 'completa',
  },
  {
    slug: 'la-bondiola',
    nombre: 'La Bondiola',
    categoria: 'sandwich',
    ingredientes: [
      { producto: 'bondiola', cantidad: 1, unidad: 'kg' },
      { producto: 'cebolla', cantidad: 0.5, unidad: 'kg' },
      { producto: 'morrón rojo', cantidad: 1, unidad: 'unidad' },
      { producto: 'zanahoria rallada', cantidad: 250, unidad: 'gr' },
      { producto: 'cerveza negra', cantidad: 473, unidad: 'ml' },
      { producto: 'ketchup', cantidad: 300, unidad: 'gr' },
      { producto: 'sal', cantidad: null, unidad: null },
      { producto: 'pimienta', cantidad: null, unidad: null },
      { producto: 'pan ciabatta', cantidad: 1, unidad: 'unidad' },
      { producto: 'lactonesa del día', cantidad: null, unidad: null },
    ],
    pasos: ['Condimentar y cubrir la bondiola con verduras.', 'Sellar en cacerola.', 'Brasear con cerveza negra a cocción larga.', 'Desarmar y porcionar en 180 gr.', 'Armar sándwich con lactonesa y servir con papas fritas.'],
    notas: ['La porción operativa es de 180 gr de carne.'],
    variantes: [],
    guarnicion: 'papas fritas',
    estado: 'completa',
    depends_on: ['lactonesa-del-dia'],
  },
  {
    slug: 'hamburguesa-preparado',
    nombre: 'Hamburguesa - Preparado de Carne',
    categoria: 'preparacion_base',
    is_base_preparation: true,
    ingredientes: [
      { producto: 'carne molida', cantidad: 1, unidad: 'kg' },
      { producto: 'sal', cantidad: null, unidad: null },
      { producto: 'pimienta', cantidad: null, unidad: null },
      { producto: 'nuez moscada', cantidad: 1, unidad: 'pizca' },
      { producto: 'mostaza', cantidad: 1, unidad: 'cucharada' },
      { producto: 'orégano', cantidad: null, unidad: null },
      { producto: 'huevo', cantidad: 1, unidad: 'unidad' },
      { producto: 'pan rallado', cantidad: null, unidad: null },
    ],
    pasos: ['Mezclar todos los ingredientes.', 'Amasar para activar la proteína.', 'Porcionar en bollitas de 100 gr.'],
    notas: [],
    variantes: [],
    guarnicion: null,
    estado: 'completa',
  },
  {
    slug: 'lomo-lve',
    nombre: 'Lomo LVE',
    categoria: 'plato',
    ingredientes: [
      { producto: 'lomo corte grueso', cantidad: 300, unidad: 'gr' },
      { producto: 'puré de papas', cantidad: 200, unidad: 'gr' },
      { producto: 'salsa LVE', cantidad: null, unidad: null },
    ],
    pasos: ['Salpimentar y sellar en sartén.', 'Terminar en horno al punto del cliente.', 'Calentar la salsa LVE.', 'Emplatar con aceite verde, puré y corte.', 'Bañar con salsa LVE y decorar.'],
    notas: ['La salsa LVE se prepara con vegetales asados en horno con puchero común, salsa inglesa, salsa de soja, mostaza, caldo de verduras.', 'Utilizar el líquido y el tuétano para reducción y espesar con roux oscuro.'],
    variantes: [],
    guarnicion: 'puré de papas',
    estado: 'completa',
    depends_on: ['salsa-lve', 'pure-de-papas'],
  },
  {
    slug: 'hamburguesa',
    nombre: 'Hamburguesa',
    categoria: 'sandwich',
    ingredientes: [
      { producto: 'medallones', cantidad: 2, unidad: 'unidad', detalle: '100 gr c/u' },
      { producto: 'cheddar', cantidad: 4, unidad: 'fetas' },
      { producto: 'pan brioche', cantidad: 1, unidad: 'unidad' },
      { producto: 'panceta en cubos', cantidad: 30, unidad: 'gr' },
      { producto: 'cebolla caramelizada', cantidad: null, unidad: null },
      { producto: 'lechuga', cantidad: null, unidad: null },
      { producto: 'tomate', cantidad: null, unidad: null },
    ],
    pasos: ['Tostar el interior del pan.', 'Smashar las bollitas de carne.', 'Derretir cheddar.', 'Montar la hamburguesa.', 'Emplatar con papas fritas.'],
    notas: [],
    variantes: [],
    guarnicion: 'papas fritas',
    estado: 'completa',
    depends_on: ['hamburguesa-preparado'],
  },
  {
    slug: 'el-de-pollo',
    nombre: 'El de Pollo',
    categoria: 'sandwich',
    ingredientes: [
      { producto: 'pan ciabatta', cantidad: 1, unidad: 'unidad' },
      { producto: 'filet de pollo', cantidad: 1, unidad: 'unidad' },
      { producto: 'cheddar', cantidad: 4, unidad: 'fetas' },
      { producto: 'panceta en cubos', cantidad: 30, unidad: 'gr' },
      { producto: 'lechuga', cantidad: null, unidad: null },
      { producto: 'tomate', cantidad: null, unidad: null },
    ],
    pasos: ['Tostar el pan.', 'Cocinar el pollo.', 'Agregar cheddar.', 'Armar sándwich con panceta.', 'Colocar lechuga y tomate.', 'Emplatar con papas fritas.'],
    notas: [],
    variantes: [],
    guarnicion: 'papas fritas',
    estado: 'completa',
  },
  {
    slug: 'pizzas',
    nombre: 'Pizzas',
    categoria: 'pizza',
    ingredientes: [
      { producto: 'masa de prepizza', cantidad: 550, unidad: 'gr' },
      { producto: 'salsa de pizza', cantidad: 80, unidad: 'gr' },
      { producto: 'queso mozzarella', cantidad: 400, unidad: 'gr' },
      { producto: 'chimi pizzero', cantidad: 30, unidad: 'gr' },
      { producto: 'aceitunas', cantidad: 8, unidad: 'unidad' },
    ],
    pasos: ['Preparar pizza muzza base.'],
    notas: [],
    variantes: [
      { nombre: 'Napo', ingredientes_extra: [{ producto: 'tomate confitado', cantidad: null, unidad: null }] },
      { nombre: 'Especial', ingredientes_extra: [{ producto: 'jamón cocido', cantidad: 125, unidad: 'gr' }, { producto: 'morrones asados', cantidad: null, unidad: null }] },
      { nombre: 'Calabresa', ingredientes_extra: [{ producto: 'cantimpalo', cantidad: 160, unidad: 'gr' }] },
      { nombre: 'La Puerca', ingredientes_extra: [{ producto: 'cheddar', cantidad: 10, unidad: 'fetas' }, { producto: 'panceta ahumada en cubos', cantidad: 150, unidad: 'gr' }] },
      { nombre: 'Fugazza', ingredientes_extra: [{ producto: 'cebolla', cantidad: 1, unidad: 'unidad' }] },
    ],
    guarnicion: null,
    estado: 'completa',
    depends_on: ['salsa-de-pizza', 'masa-de-prepizza'],
  },
  {
    slug: 'milanesita',
    nombre: 'Milanesita',
    categoria: 'plato',
    ingredientes: [
      { producto: 'milanesa clásica de menor tamaño', cantidad: 1, unidad: 'unidad' },
      { producto: 'puré o papas fritas', cantidad: 1, unidad: 'porción' },
    ],
    pasos: ['Servir milanesa con puré o papas fritas.'],
    notas: [],
    variantes: [],
    guarnicion: 'puré o papas fritas',
    estado: 'incompleta',
    depends_on: ['milanesa'],
  },
  {
    slug: 'risotto',
    nombre: 'Risotto',
    categoria: 'plato',
    ingredientes: [
      { producto: 'arroz precocido carnaroli o doble carolina', cantidad: 250, unidad: 'gr' },
      { producto: 'crema de leche', cantidad: 40, unidad: 'gr' },
      { producto: 'caldo de verduras', cantidad: 100, unidad: 'ml' },
      { producto: 'cebolla y ajo picados', cantidad: 50, unidad: 'gr' },
      { producto: 'manteca', cantidad: 30, unidad: 'gr' },
      { producto: 'queso rallado', cantidad: 50, unidad: 'gr' },
      { producto: 'sal', cantidad: null, unidad: null },
      { producto: 'pimienta', cantidad: null, unidad: null },
    ],
    pasos: ['Rehogar cebolla con ajo.', 'Calentar arroz con verduras y agregar caldo.', 'Sartenear para liberar almidón.', 'Agregar caldo y crema.', 'Agregar manteca.', 'Agregar queso rallado.', 'Emplatar con cebolla de verdeo y tomate cherry confitado.'],
    notas: [],
    variantes: [],
    guarnicion: null,
    estado: 'completa',
  },
  {
    slug: 'milanesa',
    nombre: 'Milanesa',
    categoria: 'plato',
    ingredientes: [
      { producto: 'filet de nalga', cantidad: 1, unidad: 'unidad' },
      { producto: 'huevo', cantidad: 1, unidad: 'unidad' },
      { producto: 'sal', cantidad: null, unidad: null },
      { producto: 'pimienta', cantidad: null, unidad: null },
      { producto: 'perejil', cantidad: null, unidad: null },
      { producto: 'ajo', cantidad: null, unidad: null },
      { producto: 'mostaza', cantidad: null, unidad: null },
      { producto: 'salsa inglesa', cantidad: null, unidad: null },
      { producto: 'leche', cantidad: null, unidad: null },
      { producto: 'pan rallado', cantidad: null, unidad: null },
    ],
    pasos: ['Preparar mezcla de huevo con condimentos.', 'Reposar el filet y empanizar.', 'Freír.', 'Emplatar con perejil, limones y aceite verde.'],
    notas: ['Napolitana: salsa de pizza + mozzarella + tomate + orégano.'],
    variantes: [
      { nombre: 'Napolitana', ingredientes_extra: [{ producto: 'salsa de pizza', cantidad: 3, unidad: 'cucharadas' }, { producto: 'mozzarella en barra', cantidad: 4, unidad: 'fetas' }, { producto: 'tomate', cantidad: 2, unidad: 'rodajas' }] },
    ],
    guarnicion: 'a definir',
    estado: 'completa',
  },
  {
    slug: 'salchimila',
    nombre: 'Salchimila',
    categoria: 'plato',
    ingredientes: [
      { producto: 'salchichas', cantidad: 4, unidad: 'unidad' },
      { producto: 'empanizado de pan rallado y cereales', cantidad: null, unidad: null },
      { producto: 'huevos', cantidad: 3, unidad: 'unidad' },
    ],
    pasos: ['Freír las salchichas empanizadas.', 'Emplatar con papas fritas o puré.'],
    notas: [],
    variantes: [],
    guarnicion: 'papas fritas o puré',
    estado: 'incompleta',
  },
  {
    slug: 'hamburguesita',
    nombre: 'Hamburguesita',
    categoria: 'sandwich',
    ingredientes: [
      { producto: 'pan brioche', cantidad: 1, unidad: 'unidad' },
      { producto: 'hamburguesa', cantidad: 100, unidad: 'gr' },
      { producto: 'cheddar', cantidad: 2, unidad: 'fetas' },
    ],
    pasos: ['Preparar hamburguesa con queso.', 'Emplatar con papas fritas.'],
    notas: [],
    variantes: [],
    guarnicion: 'papas fritas',
    estado: 'incompleta',
    depends_on: ['hamburguesa-preparado'],
  },
]

// ---------------------------------------------------------------------------
// Implicit sub-recipes detected in the corpus
// ---------------------------------------------------------------------------

export const IMPLICIT_SUB_RECIPES = [
  { slug: 'salsa-lve', nombre: 'Salsa LVE', description: 'Vegetales asados con puchero, salsa inglesa, soja, mostaza, caldo. Reducción con tuétano y roux oscuro.' },
  { slug: 'vegetales-asados', nombre: 'Vegetales Asados', description: 'Cebolla, morrones, zanahoria, zucchini, zapallitos y berenjenas asados con salsa inglesa, soja, mostaza.' },
  { slug: 'lactonesa-del-dia', nombre: 'Lactonesa del Día', description: 'Dip rotativo del día. Detalles pendientes del chef.' },
  { slug: 'pure-de-papas', nombre: 'Puré de Papas', description: 'Guarnición estándar. Detalles pendientes.' },
  { slug: 'salsa-de-pizza', nombre: 'Salsa de Pizza', description: 'Usada en pizzas y milanesa napo. Detalles pendientes.' },
  { slug: 'masa-de-prepizza', nombre: 'Masa de Prepizza', description: 'Masa base para pizzas. Detalles pendientes.' },
  { slug: 'aceite-verde', nombre: 'Aceite Verde', description: 'Decoración. Detalles pendientes.' },
  { slug: 'cebolla-caramelizada', nombre: 'Cebolla Caramelizada', description: 'Topping para hamburguesa. Detalles pendientes.' },
]

// ---------------------------------------------------------------------------
// Ingredient normalization
// ---------------------------------------------------------------------------

const KNOWN_PREPARATIONS: Set<string> = new Set([
  'vegetales asados', 'lactonesa del día', 'salsa lve', 'puré de papas',
  'cebolla caramelizada', 'aceite verde', 'salsa de pizza', 'masa de prepizza',
  'chimi pizzero', 'tomate confitado', 'helado borracho',
])

const KNOWN_AMBIGUOUS: Set<string> = new Set([
  'carne o pollo', 'puré o papas fritas', 'dulce de batata o membrillo',
  'medallones', 'empanizado de pan rallado y cereales',
  'milanesa clásica de menor tamaño',
])

export function normalizeIngredient(ing: CorpusIngredient, recipeSlug: string): NormalizedIngredient {
  const name = ing.producto.toLowerCase().trim()

  if (KNOWN_PREPARATIONS.has(name)) {
    return {
      original_name: ing.producto,
      normalized_name: name,
      classification: 'preparacion_base',
      cantidad: ing.cantidad,
      unidad: ing.unidad,
      confidence: 'alta',
      requires_review: false,
      review_reason: null,
      recipe_slug: recipeSlug,
    }
  }

  if (KNOWN_AMBIGUOUS.has(name)) {
    return {
      original_name: ing.producto,
      normalized_name: name,
      classification: 'ambiguo',
      cantidad: ing.cantidad,
      unidad: ing.unidad,
      confidence: 'baja',
      requires_review: true,
      review_reason: 'Ingrediente compuesto o con opciones — requiere decisión del chef',
      recipe_slug: recipeSlug,
    }
  }

  if (ing.cantidad === null && ing.unidad === null) {
    return {
      original_name: ing.producto,
      normalized_name: name,
      classification: 'atomico',
      cantidad: null,
      unidad: null,
      confidence: 'media',
      requires_review: true,
      review_reason: 'Sin cantidad ni unidad definida',
      recipe_slug: recipeSlug,
    }
  }

  return {
    original_name: ing.producto,
    normalized_name: name,
    classification: 'atomico',
    cantidad: ing.cantidad,
    unidad: ing.unidad,
    confidence: 'alta',
    requires_review: false,
    review_reason: null,
    recipe_slug: recipeSlug,
  }
}

// ---------------------------------------------------------------------------
// Corpus statistics
// ---------------------------------------------------------------------------

export function getCorpusStats() {
  const total = RECIPE_CORPUS.length
  const completas = RECIPE_CORPUS.filter(r => r.estado === 'completa').length
  const incompletas = RECIPE_CORPUS.filter(r => r.estado === 'incompleta').length
  const byCategory = new Map<string, number>()
  RECIPE_CORPUS.forEach(r => byCategory.set(r.categoria, (byCategory.get(r.categoria) ?? 0) + 1))
  const totalVariants = RECIPE_CORPUS.reduce((s, r) => s + r.variantes.length, 0)
  const withDependencies = RECIPE_CORPUS.filter(r => (r.depends_on?.length ?? 0) > 0).length

  // All unique ingredients
  const allIngredients = new Set<string>()
  RECIPE_CORPUS.forEach(r => {
    r.ingredientes.forEach(i => allIngredients.add(i.producto.toLowerCase()))
    r.variantes.forEach(v => v.ingredientes_extra?.forEach(i => allIngredients.add(i.producto.toLowerCase())))
  })

  const normalized = RECIPE_CORPUS.flatMap(r =>
    r.ingredientes.map(i => normalizeIngredient(i, r.slug))
  )
  const needsReview = normalized.filter(n => n.requires_review).length

  return {
    total,
    completas,
    incompletas,
    byCategory: Object.fromEntries(byCategory),
    totalVariants,
    withDependencies,
    implicitSubRecipes: IMPLICIT_SUB_RECIPES.length,
    uniqueIngredients: allIngredients.size,
    ingredientsNeedingReview: needsReview,
  }
}
