import {
  Home,
  Clock,
  Calendar,
  RefreshCw,
  CalendarDays,
  Coffee,
  Bell,
  Package,
  MoreHorizontal,
  Users,
  Shield,
  ShieldAlert,
  Truck,
  Bot,
  BookOpen,
  ShoppingCart,
  FolderOpen,
  Wine,
  BarChart3,
  Armchair,
  ClipboardCheck,
  Hammer,
  ClipboardList,
  ScanFace,
  Sparkles,
  Wifi,
  Croissant,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// Menú de la app por rol (barra de abajo + "Más")
// ---------------------------------------------------------------------------
// Vive acá y no en BottomNav para que La Vieja de Historia (el asistente) use
// el mismo menú al guiar: si se agrega o mueve una pantalla, el asistente lo
// sabe sin tocar nada más. Ver lib/ai/guia-app y lib/ai/destinos.
// ---------------------------------------------------------------------------

export type NavItem = {
  label: string
  href: string
  icon: LucideIcon
  description?: string
}

export type NavGroup = {
  label: string
  items: NavItem[]
}

export type ExpandableNavItem = {
  label: string
  icon: LucideIcon
  groups: NavGroup[]
}

// ---------------------------------------------------------------------------
// Nav config per role — grouped by section
// ---------------------------------------------------------------------------

const BASE_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Mi Turno', href: '/mi-turno', icon: Clock },
  { label: 'Horarios', href: '/mis-horarios', icon: Calendar },
  { label: 'Avisos', href: '/notificaciones', icon: Bell },
]

// Encargado/Socio: Hoy es el ancla del día (pedir→recibir→producir→contar)
const OPERATIONS_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Hoy', href: '/hoy', icon: CalendarDays },
  { label: 'Stock', href: '/stock', icon: Package },
  { label: 'Compras', href: '/pedidos', icon: ShoppingCart },
]

// Cocina/Chef: Hoy les muestra qué producir
const COCINA_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Hoy', href: '/hoy', icon: CalendarDays },
  { label: 'Mi Turno', href: '/mi-turno', icon: Clock },
  { label: 'Avisos', href: '/notificaciones', icon: Bell },
]

// Barista: Hoy como ancla del turno (vista de barra) + Tolva en el Más
const BARISTA_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Hoy', href: '/hoy', icon: CalendarDays },
  { label: 'Mi Turno', href: '/mi-turno', icon: Clock },
  { label: 'Avisos', href: '/notificaciones', icon: Bell },
]

// Runners get Salón in main bar instead of Horarios
const RUNNER_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Salón', href: '/salon', icon: Armchair },
  { label: 'Mi Turno', href: '/mi-turno', icon: Clock },
  { label: 'Avisos', href: '/notificaciones', icon: Bell },
]

// SOCIO — operaciones críticas fijas abajo; el resto queda agrupado por intención.
const SOCIO_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Equipo',
      items: [
        { label: 'Equipo y turnos', href: '/equipo', icon: Users, description: 'Presentes, roles y planificación semanal' },
        { label: 'Asistencia', href: '/equipo/asistencia', icon: ScanFace, description: 'Fichajes y correcciones de hoy' },
        { label: 'Centro de control', href: '/control', icon: ShieldAlert, description: 'Stock crítico, anomalías y fichajes en un solo lugar' },
      ],
    },
    {
      label: 'Operación',
      items: [
        { label: 'Ventas', href: '/ventas', icon: BarChart3, description: 'Facturación y tickets sincronizados desde Fudo' },
        { label: 'Reportes', href: '/admin/reportes', icon: BookOpen, description: 'Food cost, márgenes y ventas por período' },
        { label: 'Protocolos', href: '/protocolos', icon: Sparkles, description: 'Baño, tolva y descartables: asignar, foto y registro' },
        { label: 'Descartables', href: '/stock/descartables', icon: Package, description: 'Vasos y tapas que se descuentan solos al vender para llevar' },
        { label: 'Salón', href: '/salon', icon: Armchair, description: 'Tareas y control del servicio' },
        { label: 'Producción', href: '/cocina/produccion', icon: Hammer, description: 'Órdenes y plan de producción' },
        { label: 'Horneado', href: '/cocina/horneado', icon: Croissant, description: 'Medialunas, bollitos y tortillas: cuántas hornear, qué sobró y el control contra Fudo' },
        { label: 'Recetario de platos', href: '/recetario', icon: BookOpen, description: 'Qué lleva cada plato: costo, compras y armado' },
        { label: 'Vajilla', href: '/vajilla', icon: Wine, description: 'Control de roturas, faltantes y reposición' },
      ],
    },
    {
      label: 'Administración',
      items: [
        { label: 'Fudo', href: '/admin/fudo', icon: RefreshCw, description: 'Sincronización y configuración de Fudo' },
        { label: 'Salud de Fudo', href: '/admin/fudo/salud', icon: Wifi, description: 'Conexión, pendientes y vínculos para arreglar' },
        { label: 'Proveedores', href: '/proveedores', icon: Truck, description: 'Datos de proveedores y condiciones' },
        { label: 'Importar recetas', href: '/admin/fudo/importar', icon: ClipboardCheck, description: 'Subir el export de Fudo para sincronizar recetas' },
        { label: 'Expedientes', href: '/expedientes', icon: FolderOpen, description: 'Seguimiento de temas administrativos' },
        { label: 'Auditoría', href: '/auditoria', icon: Shield, description: 'Historial de cambios sensibles' },
      ],
    },
  ],
}

// ENCARGADO — gestiona todo lo operativo
const ENCARGADO_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Equipo',
      items: [
        { label: 'Equipo y turnos', href: '/equipo', icon: Users, description: 'Presentes, roles y planificación semanal' },
        { label: 'Asistencia', href: '/equipo/asistencia', icon: ScanFace, description: 'Fichajes y correcciones de hoy' },
        { label: 'Centro de control', href: '/control', icon: ShieldAlert, description: 'Stock crítico, anomalías y fichajes en un solo lugar' },
      ],
    },
    {
      label: 'Operación',
      items: [
        { label: 'Reportes', href: '/admin/reportes', icon: BookOpen, description: 'Food cost, márgenes y ventas por período' },
        { label: 'Protocolos', href: '/protocolos', icon: Sparkles, description: 'Baño, tolva y descartables: asignar, foto y registro' },
        { label: 'Descartables', href: '/stock/descartables', icon: Package, description: 'Vasos y tapas que se descuentan solos al vender para llevar' },
        { label: 'Salón', href: '/salon', icon: Armchair, description: 'Servicio y tareas del salón' },
        { label: 'Producción', href: '/cocina/produccion', icon: Hammer, description: 'Órdenes y plan de producción' },
        { label: 'Horneado', href: '/cocina/horneado', icon: Croissant, description: 'Medialunas, bollitos y tortillas: cuántas hornear, qué sobró y el control contra Fudo' },
        { label: 'Recetario de platos', href: '/recetario', icon: BookOpen, description: 'Qué lleva cada plato: costo, compras y armado' },
        { label: 'Vajilla', href: '/vajilla', icon: Wine, description: 'Faltantes, roturas y reposición' },
      ],
    },
    {
      label: 'Inventario',
      items: [
        { label: 'Proveedores', href: '/proveedores', icon: Truck, description: 'Contactos y condiciones de compra' },
        { label: 'Salud de Fudo', href: '/admin/fudo/salud', icon: Wifi, description: 'Conexión, pendientes y vínculos para arreglar' },
      ],
    },
  ],
}

// CHEF — producción, stock y recetario
const CHEF_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Cocina',
      items: [
        { label: 'Sugerir compra', href: '/sugerir-compra', icon: ShoppingCart, description: '¿Se acaba algo? Avisale al encargado para que lo pida' },
        { label: 'Protocolos', href: '/protocolos', icon: Sparkles, description: 'Tareas con horario: asignadas a vos, pasos y foto' },
        { label: 'Producción', href: '/cocina/produccion', icon: Hammer, description: 'Registrar producción hecha' },
        { label: 'Horneado', href: '/cocina/horneado', icon: Croissant, description: 'Medialunas, bollitos y tortillas: cuántas hornear y qué sobró' },
        { label: 'Contar elaborados', href: '/cocina/elaborados?tab=contar', icon: ClipboardList, description: 'Cargar cuánto hay de cada elaborado' },
        { label: 'Stock cocina', href: '/stock?area=cocina', icon: Package, description: 'Contar y ver faltantes del sector' },
        { label: 'Recetario', href: '/recetario', icon: BookOpen, description: 'Qué lleva cada plato y cómo se arma' },
      ],
    },
    {
      label: 'Herramientas',
      items: [
        { label: 'Horarios', href: '/mis-horarios', icon: Calendar, description: 'Mis turnos y con quién trabajo' },
        { label: 'La Vieja', href: '/asistente', icon: Bot, description: 'Consultar por chat' },
      ],
    },
  ],
}

// COCINA — producción y stock del sector
const COCINA_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Cocina',
      items: [
        { label: 'Sugerir compra', href: '/sugerir-compra', icon: ShoppingCart, description: '¿Se acaba algo? Avisale al encargado para que lo pida' },
        { label: 'Protocolos', href: '/protocolos', icon: Sparkles, description: 'Tareas con horario: asignadas a vos, pasos y foto' },
        { label: 'Producción', href: '/cocina/produccion', icon: Hammer, description: 'Registrar producción hecha' },
        { label: 'Horneado', href: '/cocina/horneado', icon: Croissant, description: 'Medialunas, bollitos y tortillas: cuántas hornear y qué sobró' },
        { label: 'Contar elaborados', href: '/cocina/elaborados?tab=contar', icon: ClipboardList, description: 'Cargar cuánto hay de cada elaborado' },
        { label: 'Stock cocina', href: '/stock?area=cocina', icon: Package, description: 'Contar y ver faltantes del sector' },
        { label: 'Recetario', href: '/recetario', icon: BookOpen, description: 'Qué lleva cada plato y cómo se arma' },
      ],
    },
    {
      label: 'Herramientas',
      items: [
        { label: 'Horarios', href: '/mis-horarios', icon: Calendar, description: 'Mis turnos y con quién trabajo' },
        { label: 'La Vieja', href: '/asistente', icon: Bot, description: 'Consultar por chat' },
      ],
    },
  ],
}

// BARISTA — tolva, vajilla y herramientas
const BARISTA_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Herramientas',
      items: [
        { label: 'Tolva', href: '/tolva', icon: Coffee, description: 'Control de la tolva del día' },
        { label: 'Horneado', href: '/cocina/horneado', icon: Croissant, description: 'Medialunas, bollitos y tortillas: cuántas hornear y qué sobró' },
        { label: 'Protocolos', href: '/protocolos', icon: Sparkles, description: 'Tolva, descartables y baño: tareas con horario' },
        { label: 'Sugerir compra', href: '/sugerir-compra', icon: ShoppingCart, description: '¿Se acaba algo? Avisale al encargado para que lo pida' },
        { label: 'Descartables', href: '/stock?area=descartables', icon: Package, description: 'Contar vasos y tapas · avisar faltantes' },
        { label: 'Horarios', href: '/mis-horarios', icon: Calendar, description: 'Mis turnos y con quién trabajo' },
        { label: 'Vajilla', href: '/vajilla', icon: Wine, description: 'Controlar roturas y faltantes' },
        { label: 'La Vieja', href: '/asistente', icon: Bot, description: 'Consultar por chat' },
      ],
    },
  ],
}

// RUNNER — vajilla + chatbot
const RUNNER_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Herramientas',
      items: [
        { label: 'Protocolos', href: '/protocolos', icon: Sparkles, description: 'Tareas con horario: asignadas a vos, pasos y foto' },
        { label: 'Horarios', href: '/mis-horarios', icon: Calendar, description: 'Mis turnos y con quién trabajo' },
        { label: 'Vajilla', href: '/vajilla', icon: Wine, description: 'Controlar roturas y faltantes' },
        { label: 'La Vieja', href: '/asistente', icon: Bot, description: 'Consultar por chat' },
        { label: 'Sugerir compra', href: '/sugerir-compra', icon: ShoppingCart, description: '¿Se acaba algo? Avisale al encargado para que lo pida' },
      ],
    },
  ],
}

// BACHA — mínimo: vajilla + chatbot
const BACHA_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Herramientas',
      items: [
        { label: 'Protocolos', href: '/protocolos', icon: Sparkles, description: 'Tareas con horario: asignadas a vos, pasos y foto' },
        { label: 'Vajilla', href: '/vajilla', icon: Wine, description: 'Controlar roturas y faltantes' },
        { label: 'Sugerir compra', href: '/sugerir-compra', icon: ShoppingCart, description: '¿Se acaba algo? Avisale al encargado para que lo pida' },
        { label: 'La Vieja', href: '/asistente', icon: Bot, description: 'Consultar por chat' },
      ],
    },
  ],
}

export function getAllMoreItems(more?: ExpandableNavItem): NavItem[] {
  if (!more) return []
  return more.groups.flatMap((g) => g.items)
}

export function getNavItems(role?: AppRole): { items: NavItem[]; more?: ExpandableNavItem } {
  if (role === 'socio') return { items: OPERATIONS_NAV, more: SOCIO_MORE }
  if (role === 'encargado') return { items: OPERATIONS_NAV, more: ENCARGADO_MORE }
  if (role === 'chef') return { items: COCINA_NAV, more: CHEF_MORE }
  if (role === 'cocina') return { items: COCINA_NAV, more: COCINA_MORE }
  if (role === 'barista') return { items: BARISTA_NAV, more: BARISTA_MORE }
  if (role === 'runner') return { items: RUNNER_NAV, more: RUNNER_MORE }
  if (role === 'bacha') return { items: BASE_NAV, more: BACHA_MORE }
  return { items: BASE_NAV, more: BACHA_MORE }
}
