export type AppRole = 'socio' | 'encargado' | 'chef' | 'barista' | 'runner' | 'cocina' | 'bacha'
export type AnnouncementTypeValue = 'general' | 'urgente' | 'recordatorio' | 'operativo'
export type PriorityValue = 'baja' | 'media' | 'alta' | 'critica'
export type AlertTypeValue = 'low_stock' | 'upcoming_purchase' | 'critical'
export type KitchenServiceValue = 'desayuno_merienda' | 'almuerzo_cena'
export type KitchenLogStatusValue = 'borrador' | 'enviado'

// Kitchen Operations enums
export type KitchenShiftTypeValue = 'morning' | 'night'
export type KitchenShiftStatusValue = 'pending' | 'in_progress' | 'completed'
export type ChecklistTypeValue = 'opening' | 'production' | 'service' | 'closing'
export type ChecklistTimingValue = 'on_arrival' | 'pre_service' | 'during_service' | 'closing' | 'scheduled'
export type KitchenFamilyValue = 'equipment' | 'proteins' | 'vegetables' | 'pastry' | 'bread' | 'dairy' | 'cold_storage' | 'mise_en_place' | 'general'
export type ChecklistItemStatusValue = 'pending' | 'done' | 'skipped' | 'overdue'
export type MiseRecordStatusValue = 'pending' | 'in_progress' | 'done' | 'low' | 'missing'

// Bar enums
export type BarCategoryValue = 'lacteos' | 'cafe' | 'packaging' | 'suministros' | 'insumos_oyambre' | 'libreria' | 'general'
export type BarOrderUrgencyValue = 'normal' | 'alta' | 'urgente'
export type BarOrderStatusValue = 'pending' | 'ordered' | 'received' | 'cancelled'

// Kitchen order enums
export type KitchenOrderCategoryValue = 'verduleria' | 'fruteria' | 'carniceria' | 'fiambreria' | 'panaderia' | 'lacteos' | 'secos' | 'limpieza' | 'otros'
export type KitchenOrderUrgencyValue = 'normal' | 'alta' | 'urgente'
export type KitchenOrderStatusValue = 'pending' | 'ordered' | 'received' | 'cancelled'

// Legacy enum types (UI existente los usa, se van a eliminar al migrar cada página)
export type StockCategoryValue = 'bebidas' | 'lacteos' | 'carnes' | 'verduras' | 'frutas' | 'panaderia' | 'elaborados' | 'condimentos' | 'limpieza' | 'desechables' | 'otros'
export type RecipeCategoryValue = 'bebidas' | 'platos' | 'postres' | 'snacks'
export type MenuItemCategoryValue =
  | 'desayunos_meriendas'
  | 'entrepanes'
  | 'tostones'
  | 'sin_trigo'
  | 'panaderia_salada'
  | 'entradas'
  | 'ensaladas'
  | 'kids'
  | 'especialidades'
  | 'pizzas'
  | 'entre_panes'
  | 'bebidas'
  | 'postres'

// Tipo viejo de ingrediente JSONB (reemplazado por tabla recipe_ingredients)
export type LegacyRecipeIngredient = {
  name: string
  qty: string
  unit: string
}

export type KitchenDailyItem = {
  _id: string
  name: string
  qty_needed: number
  qty_current: number
  qty_sold: number
  qty_remaining: number
  unit: string
  recipe_id: string | number | null
  stock_item_id: string | number | null
  is_from_recipe: boolean
  menu_item_id: string | number | null
  is_from_menu: boolean
}

// Attendance Anti-Fraud enums (needed inside Database type)
export type ClockEventType = 'clock_in' | 'clock_out'
export type AnomalyType = 'wifi_mismatch' | 'gps_out_of_range' | 'unknown_device' | 'rapid_succession' | 'unusual_hour'
export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical'
export type CorrectionType = 'add_missing' | 'change_time' | 'remove_event'
export type CorrectionStatus = 'pending' | 'approved' | 'rejected'
export type AnomalyFlag = { type: AnomalyType; [key: string]: unknown }


// ---------------------------------------------------------------------------
// Tipos generados desde el esquema real de Supabase (supabase gen types).
// Regenerar con: npx supabase gen types typescript --project-id <project-ref> --schema public
// ---------------------------------------------------------------------------

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      announcement_reads: {
        Row: {
          announcement_id: string
          id: string
          read_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          id?: string
          read_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          author_id: string
          body: string
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          priority: string
          publish_at: string
          scope: string
          target_role: Database["public"]["Enums"]["app_role"] | null
          target_user_id: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          priority?: string
          publish_at?: string
          scope?: string
          target_role?: Database["public"]["Enums"]["app_role"] | null
          target_user_id?: string | null
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          priority?: string
          publish_at?: string
          scope?: string
          target_role?: Database["public"]["Enums"]["app_role"] | null
          target_user_id?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string | null
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string | null
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_config: {
        Row: {
          key: string
          value: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          key: string
          value: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          key?: string
          value?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_logs: {
        Row: {
          clock_in_accuracy: number | null
          clock_in_at: string
          clock_in_lat: number | null
          clock_in_lng: number | null
          clock_in_selfie_url: string | null
          clock_in_type: string | null
          clock_out_accuracy: number | null
          clock_out_at: string | null
          clock_out_lat: number | null
          clock_out_lng: number | null
          clock_out_selfie_url: string | null
          clock_out_type: string | null
          created_at: string
          device_fingerprint: string | null
          edit_reason: string | null
          edited_by: string | null
          id: string
          is_suspicious: boolean | null
          network_ip: string | null
          notes: string | null
          operative_date: string
          original_clock_in: string | null
          original_clock_out: string | null
          status: string
          suspicious_reasons: string[] | null
          user_id: string
        }
        Insert: {
          clock_in_accuracy?: number | null
          clock_in_at?: string
          clock_in_lat?: number | null
          clock_in_lng?: number | null
          clock_in_selfie_url?: string | null
          clock_in_type?: string | null
          clock_out_accuracy?: number | null
          clock_out_at?: string | null
          clock_out_lat?: number | null
          clock_out_lng?: number | null
          clock_out_selfie_url?: string | null
          clock_out_type?: string | null
          created_at?: string
          device_fingerprint?: string | null
          edit_reason?: string | null
          edited_by?: string | null
          id?: string
          is_suspicious?: boolean | null
          network_ip?: string | null
          notes?: string | null
          operative_date?: string
          original_clock_in?: string | null
          original_clock_out?: string | null
          status?: string
          suspicious_reasons?: string[] | null
          user_id: string
        }
        Update: {
          clock_in_accuracy?: number | null
          clock_in_at?: string
          clock_in_lat?: number | null
          clock_in_lng?: number | null
          clock_in_selfie_url?: string | null
          clock_in_type?: string | null
          clock_out_accuracy?: number | null
          clock_out_at?: string | null
          clock_out_lat?: number | null
          clock_out_lng?: number | null
          clock_out_selfie_url?: string | null
          clock_out_type?: string | null
          created_at?: string
          device_fingerprint?: string | null
          edit_reason?: string | null
          edited_by?: string | null
          id?: string
          is_suspicious?: boolean | null
          network_ip?: string | null
          notes?: string | null
          operative_date?: string
          original_clock_in?: string | null
          original_clock_out?: string | null
          status?: string
          suspicious_reasons?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_logs_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      audit_trail: {
        Row: {
          action: string
          created_at: string
          description: string
          entity_id: string | null
          entity_type: string | null
          id: number
          ip_address: string | null
          metadata: Json | null
          module: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          created_at?: string
          description: string
          entity_id?: string | null
          entity_type?: string | null
          id?: number
          ip_address?: string | null
          metadata?: Json | null
          module: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          description?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: number
          ip_address?: string | null
          metadata?: Json | null
          module?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_trail_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bar_orders: {
        Row: {
          ordered_at: string | null
          fudo_expense_id: string | null
          fudo_amount: number | null
          received_mode: string | null
          received_note: string | null
          bar_stock_item_id: number | null
          category: string
          created_at: string
          expires_at: string | null
          id: number
          note: string | null
          product_name: string
          quantity: string
          received_at: string | null
          received_by: string | null
          received_qty: string | null
          requested_by: string | null
          status: string
          stock_item_id: string | null
          supplier_id: string | null
          unit_cost: number | null
          updated_at: string
          urgency: string
        }
        Insert: {
          ordered_at?: string | null
          fudo_expense_id?: string | null
          fudo_amount?: number | null
          received_mode?: string | null
          received_note?: string | null
          bar_stock_item_id?: number | null
          category?: string
          created_at?: string
          expires_at?: string | null
          id?: number
          note?: string | null
          product_name: string
          quantity?: string
          received_at?: string | null
          received_by?: string | null
          received_qty?: string | null
          requested_by?: string | null
          status?: string
          stock_item_id?: string | null
          supplier_id?: string | null
          unit_cost?: number | null
          updated_at?: string
          urgency?: string
        }
        Update: {
          ordered_at?: string | null
          fudo_expense_id?: string | null
          fudo_amount?: number | null
          received_mode?: string | null
          received_note?: string | null
          bar_stock_item_id?: number | null
          category?: string
          created_at?: string
          expires_at?: string | null
          id?: number
          note?: string | null
          product_name?: string
          quantity?: string
          received_at?: string | null
          received_by?: string | null
          received_qty?: string | null
          requested_by?: string | null
          status?: string
          stock_item_id?: string | null
          supplier_id?: string | null
          unit_cost?: number | null
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "bar_orders_bar_stock_item_id_fkey"
            columns: ["bar_stock_item_id"]
            isOneToOne: false
            referencedRelation: "bar_stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bar_orders_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bar_orders_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bar_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      bar_product_recipes: {
        Row: {
          bar_stock_item_id: number
          created_at: string
          fudo_product_id: string
          fudo_product_name: string
          id: number
          notes: string | null
          qty_per_unit: number
          unit: string
        }
        Insert: {
          bar_stock_item_id: number
          created_at?: string
          fudo_product_id: string
          fudo_product_name: string
          id?: number
          notes?: string | null
          qty_per_unit?: number
          unit?: string
        }
        Update: {
          bar_stock_item_id?: number
          created_at?: string
          fudo_product_id?: string
          fudo_product_name?: string
          id?: number
          notes?: string | null
          qty_per_unit?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "bar_product_recipes_bar_stock_item_id_fkey"
            columns: ["bar_stock_item_id"]
            isOneToOne: false
            referencedRelation: "bar_stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      bar_shift_handover: {
        Row: {
          closed_by: string | null
          created_at: string
          date: string
          id: number
          items: Json
          notes: string | null
          shift_type: string
        }
        Insert: {
          closed_by?: string | null
          created_at?: string
          date: string
          id?: number
          items?: Json
          notes?: string | null
          shift_type: string
        }
        Update: {
          closed_by?: string | null
          created_at?: string
          date?: string
          id?: number
          items?: Json
          notes?: string | null
          shift_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bar_shift_handover_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bar_stock_items: {
        Row: {
          category: string
          created_at: string
          current_detail: string | null
          current_qty: number
          id: number
          is_active: boolean
          is_urgent: boolean
          min_level: number
          name: string
          sort_order: number
          supplier_id: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          current_detail?: string | null
          current_qty?: number
          id?: number
          is_active?: boolean
          is_urgent?: boolean
          min_level?: number
          name: string
          sort_order?: number
          supplier_id?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          current_detail?: string | null
          current_qty?: number
          id?: number
          is_active?: boolean
          is_urgent?: boolean
          min_level?: number
          name?: string
          sort_order?: number
          supplier_id?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bar_stock_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      bar_stock_logs: {
        Row: {
          action: string
          bar_stock_item_id: number
          created_at: string
          id: number
          new_qty: number | null
          note: string | null
          old_qty: number | null
          user_id: string | null
        }
        Insert: {
          action?: string
          bar_stock_item_id: number
          created_at?: string
          id?: number
          new_qty?: number | null
          note?: string | null
          old_qty?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          bar_stock_item_id?: number
          created_at?: string
          id?: number
          new_qty?: number | null
          note?: string | null
          old_qty?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bar_stock_logs_bar_stock_item_id_fkey"
            columns: ["bar_stock_item_id"]
            isOneToOne: false
            referencedRelation: "bar_stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bar_stock_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          family: string
          id: number
          is_alert_sent: boolean
          is_critical: boolean
          kitchen_shift_id: number
          note: string | null
          scheduled_time: string | null
          sort_order: number
          status: string
          template_id: number | null
          timing: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          family?: string
          id?: number
          is_alert_sent?: boolean
          is_critical?: boolean
          kitchen_shift_id: number
          note?: string | null
          scheduled_time?: string | null
          sort_order?: number
          status?: string
          template_id?: number | null
          timing: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          family?: string
          id?: number
          is_alert_sent?: boolean
          is_critical?: boolean
          kitchen_shift_id?: number
          note?: string | null
          scheduled_time?: string | null
          sort_order?: number
          status?: string
          template_id?: number | null
          timing?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_kitchen_shift_id_fkey"
            columns: ["kitchen_shift_id"]
            isOneToOne: false
            referencedRelation: "kitchen_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          family: string
          id: number
          is_active: boolean
          is_critical: boolean
          scheduled_time: string | null
          shift: string
          sort_order: number
          timing: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          family?: string
          id?: number
          is_active?: boolean
          is_critical?: boolean
          scheduled_time?: string | null
          shift: string
          sort_order?: number
          timing: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          family?: string
          id?: number
          is_active?: boolean
          is_critical?: boolean
          scheduled_time?: string | null
          shift?: string
          sort_order?: number
          timing?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      closing_hours: {
        Row: {
          closing_time: string
          day_of_week: number
          id: number
          is_default: boolean
          override_date: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          closing_time: string
          day_of_week: number
          id?: number
          is_default?: boolean
          override_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          closing_time?: string
          day_of_week?: number
          id?: number
          is_default?: boolean
          override_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "closing_hours_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      device_registry: {
        Row: {
          device_label: string | null
          fingerprint: string
          first_seen_at: string | null
          id: number
          is_trusted: boolean | null
          last_seen_at: string | null
          user_id: string
        }
        Insert: {
          device_label?: string | null
          fingerprint: string
          first_seen_at?: string | null
          id?: never
          is_trusted?: boolean | null
          last_seen_at?: string | null
          user_id: string
        }
        Update: {
          device_label?: string | null
          fingerprint?: string
          first_seen_at?: string | null
          id?: never
          is_trusted?: boolean | null
          last_seen_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_registry_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expediente_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          expediente_id: string
          id: string
          metadata: Json | null
          type: string
        }
        Insert: {
          author_id: string
          body?: string
          created_at?: string
          expediente_id: string
          id?: string
          metadata?: Json | null
          type?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          expediente_id?: string
          id?: string
          metadata?: Json | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "expediente_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expediente_comments_expediente_id_fkey"
            columns: ["expediente_id"]
            isOneToOne: false
            referencedRelation: "expedientes"
            referencedColumns: ["id"]
          },
        ]
      }
      expediente_tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          expediente_id: string
          id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          expediente_id: string
          id?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          expediente_id?: string
          id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expediente_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expediente_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expediente_tasks_expediente_id_fkey"
            columns: ["expediente_id"]
            isOneToOne: false
            referencedRelation: "expedientes"
            referencedColumns: ["id"]
          },
        ]
      }
      expedientes: {
        Row: {
          approver_id: string | null
          areas: string[]
          author_id: string
          close_reason: string | null
          closed_at: string | null
          code: string
          created_at: string
          description: string
          id: string
          impact_categories: string[]
          priority: number | null
          reason: string
          responsible_id: string | null
          status: string
          target_date: string | null
          title: string
          type: string
          updated_at: string
          urgency: string
        }
        Insert: {
          approver_id?: string | null
          areas?: string[]
          author_id: string
          close_reason?: string | null
          closed_at?: string | null
          code?: string
          created_at?: string
          description?: string
          id?: string
          impact_categories?: string[]
          priority?: number | null
          reason?: string
          responsible_id?: string | null
          status?: string
          target_date?: string | null
          title: string
          type: string
          updated_at?: string
          urgency?: string
        }
        Update: {
          approver_id?: string | null
          areas?: string[]
          author_id?: string
          close_reason?: string | null
          closed_at?: string | null
          code?: string
          created_at?: string
          description?: string
          id?: string
          impact_categories?: string[]
          priority?: number | null
          reason?: string
          responsible_id?: string | null
          status?: string
          target_date?: string | null
          title?: string
          type?: string
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "expedientes_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expedientes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expedientes_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fudo_reintentos: {
        Row: {
          id: string
          tipo: string
          stock_item_id: string | null
          delta: number | null
          payload: Json
          origen: string
          nota: string | null
          stock_movement_ids: string[]
          estado: string
          intentos: number
          ultimo_error: string | null
          proximo_intento_at: string
          alertado_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          hecho_at: string | null
        }
        Insert: {
          id?: string
          tipo: string
          stock_item_id?: string | null
          delta?: number | null
          payload?: Json
          origen: string
          nota?: string | null
          stock_movement_ids?: string[]
          estado?: string
          intentos?: number
          ultimo_error?: string | null
          proximo_intento_at?: string
          alertado_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          hecho_at?: string | null
        }
        Update: {
          id?: string
          tipo?: string
          stock_item_id?: string | null
          delta?: number | null
          payload?: Json
          origen?: string
          nota?: string | null
          stock_movement_ids?: string[]
          estado?: string
          intentos?: number
          ultimo_error?: string | null
          proximo_intento_at?: string
          alertado_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          hecho_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fudo_reintentos_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      fudo_salud: {
        Row: {
          id: number
          ultimo_ok_at: string | null
          ultimo_error_at: string | null
          ultimo_error: string | null
          fallas_seguidas: number
          caida_avisada_at: string | null
          ultima_lectura_stock_at: string | null
          ultimo_menu_at: string | null
          updated_at: string
        }
        Insert: {
          id?: number
          ultimo_ok_at?: string | null
          ultimo_error_at?: string | null
          ultimo_error?: string | null
          fallas_seguidas?: number
          caida_avisada_at?: string | null
          ultima_lectura_stock_at?: string | null
          ultimo_menu_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: number
          ultimo_ok_at?: string | null
          ultimo_error_at?: string | null
          ultimo_error?: string | null
          fallas_seguidas?: number
          caida_avisada_at?: string | null
          ultima_lectura_stock_at?: string | null
          ultimo_menu_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fudo_sale_subitems: {
        Row: {
          created_at: string
          fudo_product_id: string
          fudo_sale_item_id: string
          fudo_subitem_id: string
          fudo_ticket_id: string
          price: number | null
          quantity: number
          sold_at: string
        }
        Insert: {
          created_at?: string
          fudo_product_id: string
          fudo_sale_item_id: string
          fudo_subitem_id: string
          fudo_ticket_id: string
          price?: number | null
          quantity?: number
          sold_at: string
        }
        Update: {
          created_at?: string
          fudo_product_id?: string
          fudo_sale_item_id?: string
          fudo_subitem_id?: string
          fudo_ticket_id?: string
          price?: number | null
          quantity?: number
          sold_at?: string
        }
        Relationships: []
      }
      fudo_sales: {
        Row: {
          created_at: string
          fudo_product_id: string
          fudo_sale_item_id: string | null
          fudo_ticket_id: string
          id: number
          quantity: number
          raw_payload: Json | null
          sold_at: string
        }
        Insert: {
          created_at?: string
          fudo_product_id: string
          fudo_sale_item_id?: string | null
          fudo_ticket_id: string
          id?: number
          quantity?: number
          raw_payload?: Json | null
          sold_at: string
        }
        Update: {
          created_at?: string
          fudo_product_id?: string
          fudo_sale_item_id?: string | null
          fudo_ticket_id?: string
          id?: number
          quantity?: number
          raw_payload?: Json | null
          sold_at?: string
        }
        Relationships: []
      }
      fudo_sync_events: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          direction: string
          entity_id: string | null
          entity_type: string | null
          error_message: string | null
          fudo_id: string | null
          fudo_type: string | null
          id: string
          idempotency_key: string | null
          operation: string
          request_payload: Json
          response_payload: Json | null
          status: string
          stock_item_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          direction: string
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          fudo_id?: string | null
          fudo_type?: string | null
          id?: string
          idempotency_key?: string | null
          operation: string
          request_payload?: Json
          response_payload?: Json | null
          status?: string
          stock_item_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          fudo_id?: string | null
          fudo_type?: string | null
          id?: string
          idempotency_key?: string | null
          operation?: string
          request_payload?: Json
          response_payload?: Json | null
          status?: string
          stock_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fudo_sync_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fudo_sync_incidents: {
        Row: {
          code: string
          created_at: string
          detail: string | null
          entity_id: string | null
          entity_type: string | null
          first_seen_at: string
          fudo_id: string | null
          fudo_type: string | null
          id: string
          incident_key: string
          last_seen_at: string
          payload: Json
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source: string
          status: string
          stock_item_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          detail?: string | null
          entity_id?: string | null
          entity_type?: string | null
          first_seen_at?: string
          fudo_id?: string | null
          fudo_type?: string | null
          id?: string
          incident_key: string
          last_seen_at?: string
          payload?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source?: string
          status?: string
          stock_item_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          detail?: string | null
          entity_id?: string | null
          entity_type?: string | null
          first_seen_at?: string
          fudo_id?: string | null
          fudo_type?: string | null
          id?: string
          incident_key?: string
          last_seen_at?: string
          payload?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source?: string
          status?: string
          stock_item_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fudo_sync_incidents_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_daily_logs: {
        Row: {
          created_at: string
          created_by: string
          id: string
          items: Json
          notes: string | null
          operative_date: string
          service: string
          status: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          items?: Json
          notes?: string | null
          operative_date: string
          service: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          items?: Json
          notes?: string | null
          operative_date?: string
          service?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_daily_logs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_orders: {
        Row: {
          ordered_at: string | null
          fudo_expense_id: string | null
          fudo_amount: number | null
          received_mode: string | null
          received_note: string | null
          category: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: number
          note: string | null
          product_name: string
          quantity: string
          received_at: string | null
          received_by: string | null
          received_qty: string | null
          status: string
          stock_item_id: string | null
          supplier_id: string | null
          unit_cost: number | null
          updated_at: string
          urgency: string
        }
        Insert: {
          ordered_at?: string | null
          fudo_expense_id?: string | null
          fudo_amount?: number | null
          received_mode?: string | null
          received_note?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: number
          note?: string | null
          product_name: string
          quantity: string
          received_at?: string | null
          received_by?: string | null
          received_qty?: string | null
          status?: string
          stock_item_id?: string | null
          supplier_id?: string | null
          unit_cost?: number | null
          updated_at?: string
          urgency?: string
        }
        Update: {
          ordered_at?: string | null
          fudo_expense_id?: string | null
          fudo_amount?: number | null
          received_mode?: string | null
          received_note?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: number
          note?: string | null
          product_name?: string
          quantity?: string
          received_at?: string | null
          received_by?: string | null
          received_qty?: string | null
          status?: string
          stock_item_id?: string | null
          supplier_id?: string | null
          unit_cost?: number | null
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_orders_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_orders_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_shift_handover: {
        Row: {
          closed_by: string | null
          created_at: string
          date: string
          id: number
          items: Json | null
          notes: string | null
          shift_type: string
        }
        Insert: {
          closed_by?: string | null
          created_at?: string
          date: string
          id?: number
          items?: Json | null
          notes?: string | null
          shift_type: string
        }
        Update: {
          closed_by?: string | null
          created_at?: string
          date?: string
          id?: number
          items?: Json | null
          notes?: string | null
          shift_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_shift_handover_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_shifts: {
        Row: {
          closed_by: string | null
          created_at: string
          date: string
          handover_note: string | null
          id: number
          opened_by: string | null
          shift_type: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_by?: string | null
          created_at?: string
          date: string
          handover_note?: string | null
          id?: number
          opened_by?: string | null
          shift_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_by?: string | null
          created_at?: string
          date?: string
          handover_note?: string | null
          id?: number
          opened_by?: string | null
          shift_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_shifts_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          created_at: string
          fudo_category_id: string | null
          id: number
          name: string
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          fudo_category_id?: string | null
          id?: number
          name: string
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          fudo_category_id?: string | null
          id?: number
          name?: string
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          category: string
          consumo_modo: string | null
          consumo_qty: number | null
          consumo_stock_item_id: string | null
          cost_price: number | null
          created_at: string
          description: string | null
          fudo_code: string | null
          fudo_product_id: string | null
          id: string
          is_active: boolean
          menu_category_id: number | null
          name: string
          recipe_id: string | null
          recipe_link_source: string | null
          requires_preparation: boolean
          sale_price: number | null
          sort_order: number
          subcategory: string | null
          track_stock: boolean
          updated_at: string
        }
        Insert: {
          category: string
          consumo_modo?: string | null
          consumo_qty?: number | null
          consumo_stock_item_id?: string | null
          cost_price?: number | null
          created_at?: string
          description?: string | null
          fudo_code?: string | null
          fudo_product_id?: string | null
          id?: string
          is_active?: boolean
          menu_category_id?: number | null
          name: string
          recipe_id?: string | null
          recipe_link_source?: string | null
          requires_preparation?: boolean
          sale_price?: number | null
          sort_order?: number
          subcategory?: string | null
          track_stock?: boolean
          updated_at?: string
        }
        Update: {
          category?: string
          consumo_modo?: string | null
          consumo_qty?: number | null
          consumo_stock_item_id?: string | null
          cost_price?: number | null
          created_at?: string
          description?: string | null
          fudo_code?: string | null
          fudo_product_id?: string | null
          id?: string
          is_active?: boolean
          menu_category_id?: number | null
          name?: string
          recipe_id?: string | null
          recipe_link_source?: string | null
          requires_preparation?: boolean
          sale_price?: number | null
          sort_order?: number
          subcategory?: string | null
          track_stock?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_menu_category_id_fkey"
            columns: ["menu_category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      mise_en_place_items: {
        Row: {
          alert_threshold: number
          created_at: string
          family: string
          id: number
          is_active: boolean
          name: string
          recipe_id: string | null
          shift: string
          sort_order: number
          target_quantity: number
          unit: string
          updated_at: string
        }
        Insert: {
          alert_threshold?: number
          created_at?: string
          family?: string
          id?: number
          is_active?: boolean
          name: string
          recipe_id?: string | null
          shift: string
          sort_order?: number
          target_quantity?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          alert_threshold?: number
          created_at?: string
          family?: string
          id?: number
          is_active?: boolean
          name?: string
          recipe_id?: string | null
          shift?: string
          sort_order?: number
          target_quantity?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mise_en_place_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      mise_en_place_records: {
        Row: {
          created_at: string
          id: number
          kitchen_shift_id: number
          left_for_next_shift: boolean
          mise_en_place_item_id: number
          note: string | null
          produced_by: string | null
          quantity_left_for_next_shift: number | null
          quantity_produced: number | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          kitchen_shift_id: number
          left_for_next_shift?: boolean
          mise_en_place_item_id: number
          note?: string | null
          produced_by?: string | null
          quantity_left_for_next_shift?: number | null
          quantity_produced?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          kitchen_shift_id?: number
          left_for_next_shift?: boolean
          mise_en_place_item_id?: number
          note?: string | null
          produced_by?: string | null
          quantity_left_for_next_shift?: number | null
          quantity_produced?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mise_en_place_records_kitchen_shift_id_fkey"
            columns: ["kitchen_shift_id"]
            isOneToOne: false
            referencedRelation: "kitchen_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mise_en_place_records_mise_en_place_item_id_fkey"
            columns: ["mise_en_place_item_id"]
            isOneToOne: false
            referencedRelation: "mise_en_place_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mise_en_place_records_produced_by_fkey"
            columns: ["produced_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_rates: {
        Row: {
          hourly_rate: number
          id: number
          label: string
          role: string
          updated_at: string
        }
        Insert: {
          hourly_rate: number
          id?: number
          label: string
          role: string
          updated_at?: string
        }
        Update: {
          hourly_rate?: number
          id?: number
          label?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      production_inputs: {
        Row: {
          movement_uuid: string | null
          cost_per_unit: number | null
          created_at: string
          id: number
          production_order_id: number
          qty_used: number
          stock_item_id: string | null
          stock_movement_id: number | null
          unit: string
        }
        Insert: {
          movement_uuid?: string | null
          cost_per_unit?: number | null
          created_at?: string
          id?: number
          production_order_id: number
          qty_used?: number
          stock_item_id?: string | null
          stock_movement_id?: number | null
          unit?: string
        }
        Update: {
          movement_uuid?: string | null
          cost_per_unit?: number | null
          created_at?: string
          id?: number
          production_order_id?: number
          qty_used?: number
          stock_item_id?: string | null
          stock_movement_id?: number | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_inputs_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_inputs_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      production_orders: {
        Row: {
          efficiency_pct: number | null
          total_cost: number | null
          cost_per_output_unit: number | null
          main_output_stock_item_id: string | null
          chef_id: string | null
          completed_at: string | null
          created_at: string
          id: number
          name: string
          notes: string | null
          parent_order_id: number | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          started_at: string | null
          status: string
          submitted_at: string | null
          template_id: number | null
          updated_at: string
        }
        Insert: {
          efficiency_pct?: number | null
          total_cost?: number | null
          cost_per_output_unit?: number | null
          main_output_stock_item_id?: string | null
          chef_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: number
          name: string
          notes?: string | null
          parent_order_id?: number | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          started_at?: string | null
          status?: string
          submitted_at?: string | null
          template_id?: number | null
          updated_at?: string
        }
        Update: {
          efficiency_pct?: number | null
          total_cost?: number | null
          cost_per_output_unit?: number | null
          main_output_stock_item_id?: string | null
          chef_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: number
          name?: string
          notes?: string | null
          parent_order_id?: number | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          started_at?: string | null
          status?: string
          submitted_at?: string | null
          template_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_orders_chef_id_fkey"
            columns: ["chef_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_orders_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "production_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      production_outputs: {
        Row: {
          movement_uuid: string | null
          created_at: string
          expires_at: string | null
          id: number
          is_waste: boolean | null
          lot_code: string | null
          notes: string | null
          output_name: string
          produced_at: string | null
          production_order_id: number
          qty_produced: number
          stock_item_id: string | null
          stock_movement_id: number | null
          theoretical_qty: number | null
          unit: string
        }
        Insert: {
          movement_uuid?: string | null
          created_at?: string
          expires_at?: string | null
          id?: number
          is_waste?: boolean | null
          lot_code?: string | null
          notes?: string | null
          output_name: string
          produced_at?: string | null
          production_order_id: number
          qty_produced?: number
          stock_item_id?: string | null
          stock_movement_id?: number | null
          theoretical_qty?: number | null
          unit?: string
        }
        Update: {
          movement_uuid?: string | null
          created_at?: string
          expires_at?: string | null
          id?: number
          is_waste?: boolean | null
          lot_code?: string | null
          notes?: string | null
          output_name?: string
          produced_at?: string | null
          production_order_id?: number
          qty_produced?: number
          stock_item_id?: string | null
          stock_movement_id?: number | null
          theoretical_qty?: number | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_outputs_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_outputs_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      production_template_inputs: {
        Row: {
          id: number
          template_id: number
          stock_item_id: string | null
          qty: number | null
          unit: string | null
          sort_order: number
        }
        Insert: {
          id?: number
          template_id: number
          stock_item_id?: string | null
          qty?: number | null
          unit?: string | null
          sort_order?: number
        }
        Update: {
          id?: number
          template_id?: number
          stock_item_id?: string | null
          qty?: number | null
          unit?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_template_inputs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "production_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_template_inputs_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      production_template_outputs: {
        Row: {
          id: number
          is_waste: boolean | null
          notes: string | null
          output_name: string
          output_unit: string
          default_qty: number | null
          sort_order: number | null
          stock_item_id: string | null
          template_id: number
          theoretical_yield_pct: number
        }
        Insert: {
          id?: number
          is_waste?: boolean | null
          notes?: string | null
          output_name: string
          output_unit?: string
          default_qty?: number | null
          sort_order?: number | null
          stock_item_id?: string | null
          template_id: number
          theoretical_yield_pct?: number
        }
        Update: {
          id?: number
          is_waste?: boolean | null
          notes?: string | null
          output_name?: string
          output_unit?: string
          default_qty?: number | null
          sort_order?: number | null
          stock_item_id?: string | null
          template_id?: number
          theoretical_yield_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_template_outputs_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_template_outputs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "production_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      production_templates: {
        Row: {
          created_at: string
          default_input_stock_item_id: string | null
          default_input_unit: string | null
          description: string | null
          id: number
          is_active: boolean | null
          name: string
          recipe_id: string | null
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_input_stock_item_id?: string | null
          default_input_unit?: string | null
          description?: string | null
          id?: number
          is_active?: boolean | null
          name: string
          recipe_id?: string | null
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_input_stock_item_id?: string | null
          default_input_unit?: string | null
          description?: string | null
          id?: number
          is_active?: boolean | null
          name?: string
          recipe_id?: string | null
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_templates_default_input_stock_item_id_fkey"
            columns: ["default_input_stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_templates_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          birth_date: string | null
          created_at: string
          cuit: string | null
          dni: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          settings: Json
          updated_at: string
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          birth_date?: string | null
          created_at?: string
          cuit?: string | null
          dni?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          first_name: string
          id: string
          is_active?: boolean
          last_name: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          settings?: Json
          updated_at?: string
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          birth_date?: string | null
          created_at?: string
          cuit?: string | null
          dni?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          first_name?: string
          id?: string
          is_active?: boolean
          last_name?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      protocolo_tareas: {
        Row: {
          id: string
          protocolo_id: string
          fecha: string
          hora: string
          estado: string
          asignado_a: string | null
          asignado_por: string | null
          asignado_at: string | null
          hecho_por: string | null
          hecho_at: string | null
          foto_path: string | null
          fotos: string[] | null
          pasos_ok: string[] | null
          nota: string | null
          avisado_at: string | null
          reaviso_at: string | null
          recordatorio_at: string | null
          atraso_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          protocolo_id: string
          fecha: string
          hora: string
          estado?: string
          asignado_a?: string | null
          asignado_por?: string | null
          asignado_at?: string | null
          hecho_por?: string | null
          hecho_at?: string | null
          foto_path?: string | null
          fotos?: string[] | null
          pasos_ok?: string[] | null
          nota?: string | null
          avisado_at?: string | null
          reaviso_at?: string | null
          recordatorio_at?: string | null
          atraso_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          protocolo_id?: string
          fecha?: string
          hora?: string
          estado?: string
          asignado_a?: string | null
          asignado_por?: string | null
          asignado_at?: string | null
          hecho_por?: string | null
          hecho_at?: string | null
          foto_path?: string | null
          fotos?: string[] | null
          pasos_ok?: string[] | null
          nota?: string | null
          avisado_at?: string | null
          reaviso_at?: string | null
          recordatorio_at?: string | null
          atraso_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocolo_tareas_protocolo_id_fkey"
            columns: ["protocolo_id"]
            isOneToOne: false
            referencedRelation: "protocolos"
            referencedColumns: ["id"]
          },
        ]
      }
      protocolos: {
        Row: {
          id: string
          nombre: string
          descripcion: string | null
          horarios: string[]
          pasos: string[]
          fotos: string[]
          requiere_foto: boolean
          activo: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          nombre: string
          descripcion?: string | null
          horarios?: string[]
          pasos?: string[]
          fotos?: string[]
          requiere_foto?: boolean
          activo?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          nombre?: string
          descripcion?: string | null
          horarios?: string[]
          pasos?: string[]
          fotos?: string[]
          requiere_foto?: boolean
          activo?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          id: number
          keys: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: number
          keys: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: number
          keys?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredient_pending_links: {
        Row: {
          cantidad: number | null
          created_at: string | null
          id: number
          ingredient_name: string
          match_confidence: string
          match_reasons: string[] | null
          match_score: number | null
          normalized_name: string
          recipe_id: string | null
          recipe_name: string
          recipe_slug: string
          resolved_at: string | null
          resolved_by: string | null
          resolved_qty_per_portion: number | null
          resolved_stock_item_id: string | null
          resolved_unit: string | null
          status: string
          suggested_stock_item_id: string | null
          suggested_stock_item_name: string | null
          unidad: string | null
          updated_at: string | null
        }
        Insert: {
          cantidad?: number | null
          created_at?: string | null
          id?: number
          ingredient_name: string
          match_confidence?: string
          match_reasons?: string[] | null
          match_score?: number | null
          normalized_name: string
          recipe_id?: string | null
          recipe_name: string
          recipe_slug: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_qty_per_portion?: number | null
          resolved_stock_item_id?: string | null
          resolved_unit?: string | null
          status?: string
          suggested_stock_item_id?: string | null
          suggested_stock_item_name?: string | null
          unidad?: string | null
          updated_at?: string | null
        }
        Update: {
          cantidad?: number | null
          created_at?: string | null
          id?: number
          ingredient_name?: string
          match_confidence?: string
          match_reasons?: string[] | null
          match_score?: number | null
          normalized_name?: string
          recipe_id?: string | null
          recipe_name?: string
          recipe_slug?: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_qty_per_portion?: number | null
          resolved_stock_item_id?: string | null
          resolved_unit?: string | null
          status?: string
          suggested_stock_item_id?: string | null
          suggested_stock_item_name?: string | null
          unidad?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredient_pending_links_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredient_pending_links_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredient_pending_links_resolved_stock_item_id_fkey"
            columns: ["resolved_stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredient_pending_links_suggested_stock_item_id_fkey"
            columns: ["suggested_stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          created_at: string
          id: number
          ingredient_unit: string | null
          notes: string | null
          qty_per_portion: number
          recipe_id: string
          stock_item_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          ingredient_unit?: string | null
          notes?: string | null
          qty_per_portion?: number
          recipe_id: string
          stock_item_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          ingredient_unit?: string | null
          notes?: string | null
          qty_per_portion?: number
          recipe_id?: string
          stock_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          category: string
          cost_per_portion: number | null
          created_at: string | null
          created_by: string
          id: string
          ingredients: Json | null
          is_active: boolean | null
          name: string
          notes: string | null
          output_stock_item_id: string | null
          preparation: string | null
          slug: string | null
          updated_at: string | null
          yield_portions: number | null
        }
        Insert: {
          category?: string
          cost_per_portion?: number | null
          created_at?: string | null
          created_by: string
          id?: string
          ingredients?: Json | null
          is_active?: boolean | null
          name: string
          notes?: string | null
          output_stock_item_id?: string | null
          preparation?: string | null
          slug?: string | null
          updated_at?: string | null
          yield_portions?: number | null
        }
        Update: {
          category?: string
          cost_per_portion?: number | null
          created_at?: string | null
          created_by?: string
          id?: string
          ingredients?: Json | null
          is_active?: boolean | null
          name?: string
          notes?: string | null
          output_stock_item_id?: string | null
          preparation?: string | null
          slug?: string | null
          updated_at?: string | null
          yield_portions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recipes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_output_stock_item_id_fkey"
            columns: ["output_stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_item_status: {
        Row: {
          fudo_item_id: string
          fudo_sale_id: string
          id: number
          served_at: string
          served_by: string | null
        }
        Insert: {
          fudo_item_id: string
          fudo_sale_id: string
          id?: number
          served_at?: string
          served_by?: string | null
        }
        Update: {
          fudo_item_id?: string
          fudo_sale_id?: string
          id?: number
          served_at?: string
          served_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salon_item_status_served_by_fkey"
            columns: ["served_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          color: string
          created_at: string
          created_by: string
          emoji: string
          end_time: string
          id: string
          notes: string | null
          shift_date: string
          shift_role: Database["public"]["Enums"]["app_role"]
          start_time: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by: string
          emoji?: string
          end_time: string
          id?: string
          notes?: string | null
          shift_date: string
          shift_role: Database["public"]["Enums"]["app_role"]
          start_time: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string
          emoji?: string
          end_time?: string
          id?: string
          notes?: string | null
          shift_date?: string
          shift_role?: Database["public"]["Enums"]["app_role"]
          start_time?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_alerts: {
        Row: {
          alert_type: string
          created_at: string
          id: string
          message: string
          priority: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          stock_item_id: string
          triggered_at: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          id?: string
          message: string
          priority?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          stock_item_id: string
          triggered_at?: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          id?: string
          message?: string
          priority?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          stock_item_id?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_alerts_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_anomaly_decisions: {
        Row: {
          created_at: string
          decided_by: string | null
          decision: string
          id: string
          issue_key: string
          issue_type: string
          note: string | null
          snapshot: Json
          snoozed_until: string | null
          stock_item_id: string
        }
        Insert: {
          created_at?: string
          decided_by?: string | null
          decision: string
          id?: string
          issue_key: string
          issue_type: string
          note?: string | null
          snapshot?: Json
          snoozed_until?: string | null
          stock_item_id: string
        }
        Update: {
          created_at?: string
          decided_by?: string | null
          decision?: string
          id?: string
          issue_key?: string
          issue_type?: string
          note?: string | null
          snapshot?: Json
          snoozed_until?: string | null
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_anomaly_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_anomaly_decisions_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_anomaly_rules: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          created_from_issue_key: string | null
          id: string
          is_active: boolean
          issue_type: string | null
          last_notified_at: string | null
          max_qty: number | null
          min_qty: number | null
          name_pattern: string | null
          note: string | null
          notification_priority: string
          notify_enabled: boolean
          stock_item_id: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          created_from_issue_key?: string | null
          id?: string
          is_active?: boolean
          issue_type?: string | null
          last_notified_at?: string | null
          max_qty?: number | null
          min_qty?: number | null
          name_pattern?: string | null
          note?: string | null
          notification_priority?: string
          notify_enabled?: boolean
          stock_item_id?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          created_from_issue_key?: string | null
          id?: string
          is_active?: boolean
          issue_type?: string | null
          last_notified_at?: string | null
          max_qty?: number | null
          min_qty?: number | null
          name_pattern?: string | null
          note?: string | null
          notification_priority?: string
          notify_enabled?: boolean
          stock_item_id?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_anomaly_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_anomaly_rules_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_aliases: {
        Row: {
          alias: string
          created_at: string
          created_by: string | null
          stock_item_id: string | null
          updated_at: string
        }
        Insert: {
          alias: string
          created_at?: string
          created_by?: string | null
          stock_item_id?: string | null
          updated_at?: string
        }
        Update: {
          alias?: string
          created_at?: string
          created_by?: string | null
          stock_item_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      stock_items: {
        Row: {
          area: string | null
          fudo_category: string | null
          area_locked: boolean
          category: string
          cost_per_unit: number | null
          cost_source: string | null
          cost_updated_at: string | null
          created_at: string
          current_qty: number
          fudo_ingredient_id: string | null
          fudo_product_id: string | null
          fudo_skip: boolean
          id: string
          is_active: boolean
          is_produced: boolean
          last_counted_at: string | null
          last_ordered_at: string | null
          min_qty: number
          name: string
          next_purchase_date: string | null
          notes: string | null
          purchase_lead_time_days: number | null
          semaphore: string
          shelf_life_days: number | null
          supplier_id: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          area?: string | null
          fudo_category?: string | null
          area_locked?: boolean
          category: string
          cost_per_unit?: number | null
          cost_source?: string | null
          cost_updated_at?: string | null
          created_at?: string
          current_qty?: number
          fudo_ingredient_id?: string | null
          fudo_product_id?: string | null
          fudo_skip?: boolean
          id?: string
          is_active?: boolean
          is_produced?: boolean
          last_counted_at?: string | null
          last_ordered_at?: string | null
          min_qty?: number
          name: string
          next_purchase_date?: string | null
          notes?: string | null
          purchase_lead_time_days?: number | null
          semaphore?: string
          shelf_life_days?: number | null
          supplier_id?: string | null
          unit: string
          updated_at?: string
        }
        Update: {
          area?: string | null
          fudo_category?: string | null
          area_locked?: boolean
          category?: string
          cost_per_unit?: number | null
          cost_source?: string | null
          cost_updated_at?: string | null
          created_at?: string
          current_qty?: number
          fudo_ingredient_id?: string | null
          fudo_product_id?: string | null
          fudo_skip?: boolean
          id?: string
          is_active?: boolean
          is_produced?: boolean
          last_counted_at?: string | null
          last_ordered_at?: string | null
          min_qty?: number
          name?: string
          next_purchase_date?: string | null
          notes?: string | null
          purchase_lead_time_days?: number | null
          semaphore?: string
          shelf_life_days?: number | null
          supplier_id?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_logs: {
        Row: {
          action: string
          created_at: string
          id: number
          new_qty: number | null
          note: string | null
          old_qty: number | null
          stock_item_id: string
          user_id: string | null
        }
        Insert: {
          action?: string
          created_at?: string
          id?: number
          new_qty?: number | null
          note?: string | null
          old_qty?: number | null
          stock_item_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: number
          new_qty?: number | null
          note?: string | null
          old_qty?: number | null
          stock_item_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_logs_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_lots: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: number
          lot_code: string
          notes: string | null
          produced_at: string
          production_order_id: number | null
          production_output_id: number | null
          qty_original: number
          qty_remaining: number
          status: string
          stock_item_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: number
          lot_code: string
          notes?: string | null
          produced_at?: string
          production_order_id?: number | null
          production_output_id?: number | null
          qty_original?: number
          qty_remaining?: number
          status?: string
          stock_item_id: string
          unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: number
          lot_code?: string
          notes?: string | null
          produced_at?: string
          production_order_id?: number | null
          production_output_id?: number | null
          qty_original?: number
          qty_remaining?: number
          status?: string
          stock_item_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_lots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_production_order_id_fkey"
            columns: ["production_order_id"]
            isOneToOne: false
            referencedRelation: "production_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_production_output_id_fkey"
            columns: ["production_output_id"]
            isOneToOne: false
            referencedRelation: "production_outputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          production_order_id: number | null
          fudo_synced: boolean
          cost_per_unit: number | null
          created_at: string | null
          created_by: string
          id: string
          movement_type: string
          new_qty: number
          note: string | null
          previous_qty: number
          qty: number
          reason: string | null
          related_log_id: string | null
          stock_item_id: string
        }
        Insert: {
          production_order_id?: number | null
          fudo_synced?: boolean
          cost_per_unit?: number | null
          created_at?: string | null
          created_by: string
          id?: string
          movement_type: string
          new_qty: number
          note?: string | null
          previous_qty: number
          qty: number
          reason?: string | null
          related_log_id?: string | null
          stock_item_id: string
        }
        Update: {
          production_order_id?: number | null
          fudo_synced?: boolean
          cost_per_unit?: number | null
          created_at?: string | null
          created_by?: string
          id?: string
          movement_type?: string
          new_qty?: number
          note?: string | null
          previous_qty?: number
          qty?: number
          reason?: string | null
          related_log_id?: string | null
          stock_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_related_log_id_fkey"
            columns: ["related_log_id"]
            isOneToOne: false
            referencedRelation: "kitchen_daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_receipts: {
        Row: {
          id: number
          stock_item_id: string | null
          supplier_id: string | null
          order_source: string | null
          order_id: number | null
          qty: number
          unit: string | null
          cost_total: number | null
          cost_per_unit: number | null
          freeze_qty: number | null
          expires_at: string | null
          note: string | null
          received_by: string | null
          received_date: string
          received_at: string
          payment_status: string
          paid_at: string | null
          paid_by: string | null
          payment_method: string | null
        }
        Insert: {
          id?: number
          stock_item_id?: string | null
          supplier_id?: string | null
          order_source?: string | null
          order_id?: number | null
          qty: number
          unit?: string | null
          cost_total?: number | null
          cost_per_unit?: number | null
          freeze_qty?: number | null
          expires_at?: string | null
          note?: string | null
          received_by?: string | null
          received_date: string
          received_at?: string
          payment_status?: string
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
        }
        Update: {
          id?: number
          stock_item_id?: string | null
          supplier_id?: string | null
          order_source?: string | null
          order_id?: number | null
          qty?: number
          unit?: string | null
          cost_total?: number | null
          cost_per_unit?: number | null
          freeze_qty?: number | null
          expires_at?: string | null
          note?: string | null
          received_by?: string | null
          received_date?: string
          received_at?: string
          payment_status?: string
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_receipts_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          critical_count: number
          id: number
          items: Json
          label: string | null
          snapshot_date: string
          snapshot_type: string
          total_items: number
          total_qty: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          critical_count?: number
          id?: number
          items?: Json
          label?: string | null
          snapshot_date: string
          snapshot_type?: string
          total_items?: number
          total_qty?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          critical_count?: number
          id?: number
          items?: Json
          label?: string | null
          snapshot_date?: string
          snapshot_type?: string
          total_items?: number
          total_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          category: string
          contact_name: string | null
          created_at: string
          email: string | null
          fudo_provider_id: string | null
          id: string
          is_active: boolean
          lead_time_days: number | null
          order_days: number[]
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          category: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          fudo_provider_id?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number | null
          order_days?: number[]
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          fudo_provider_id?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number | null
          order_days?: number[]
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tolva_logs: {
        Row: {
          id: number
          log_date: string
          shift: string
          start_gr: number | null
          added_gr: number
          end_gr: number | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          log_date: string
          shift: string
          start_gr?: number | null
          added_gr?: number
          end_gr?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          log_date?: string
          shift?: string
          start_gr?: number | null
          added_gr?: number
          end_gr?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tolva_logs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vajilla_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          id: number
          items: Json
          label: string | null
          snapshot_date: string
          total_pieces: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: number
          items?: Json
          label?: string | null
          snapshot_date: string
          total_pieces?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: number
          items?: Json
          label?: string | null
          snapshot_date?: string
          total_pieces?: number
        }
        Relationships: [
          {
            foreignKeyName: "vajilla_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vajilla_stock: {
        Row: {
          category: string
          created_at: string
          id: number
          item_name: string
          notes: string | null
          quantity: number
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: number
          item_name: string
          notes?: string | null
          quantity?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: number
          item_name?: string
          notes?: string | null
          quantity?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      fudo_consumo: {
        Row: {
          es_subitem: boolean
          fudo_product_id: string
          fudo_ticket_id: string
          id: string
          quantity: number
          sold_at: string
        }
        Relationships: []
      }
      v_active_alerts: {
        Row: {
          alert_type: string | null
          category: string | null
          current_qty: number | null
          id: string | null
          item_name: string | null
          message: string | null
          min_qty: number | null
          priority: string | null
          semaphore: string | null
          status: string | null
          stock_item_id: string | null
          triggered_at: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_alerts_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      v_today_attendance: {
        Row: {
          clock_in_at: string | null
          clock_out_at: string | null
          first_name: string | null
          id: string | null
          last_name: string | null
          notes: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          status: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_announcements_summary: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      admin_attendance_summary: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      admin_dashboard_kpis: { Args: never; Returns: Json }
      admin_shifts_summary: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      admin_stock_snapshot: { Args: never; Returns: Json }
      auth_role: { Args: never; Returns: string }
      check_attendance_anomalies: {
        Args: { p_event: string; p_log_id: string }
        Returns: Json
      }
      clock_in:
        | { Args: { p_notes?: string }; Returns: Json }
        | {
            Args: {
              p_accuracy?: number
              p_device_fingerprint?: string
              p_lat?: number
              p_lng?: number
              p_network_ip?: string
              p_notes?: string
              p_selfie_url?: string
            }
            Returns: Json
          }
      clock_out:
        | { Args: { p_notes?: string }; Returns: Json }
        | {
            Args: {
              p_accuracy?: number
              p_device_fingerprint?: string
              p_lat?: number
              p_lng?: number
              p_network_ip?: string
              p_notes?: string
              p_selfie_url?: string
            }
            Returns: Json
          }
      complete_production_order: {
        Args: { p_order_id: number; p_user_id: string }
        Returns: Json
      }
      deduct_stock_on_sale: { Args: { p_sale_id: number }; Returns: Json }
      earth: { Args: never; Returns: number }
      get_my_announcements: {
        Args: never
        Returns: {
          author_id: string
          body: string
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          priority: string
          publish_at: string
          scope: string
          target_role: Database["public"]["Enums"]["app_role"] | null
          target_user_id: string | null
          title: string
          type: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "announcements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_weekly_schedule: {
        Args: { p_start_date: string }
        Returns: {
          color: string
          emoji: string
          end_time: string
          first_name: string
          last_name: string
          notes: string
          shift_date: string
          shift_id: string
          shift_role: string
          start_time: string
          user_id: string
        }[]
      }
      is_encargado: { Args: never; Returns: boolean }
      is_encargado_or_chef: { Args: never; Returns: boolean }
      menu_item_reconciliation: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          expected_remaining: number
          menu_item_id: string
          menu_item_name: string
          qty_produced: number
          qty_sold: number
          recipe_id: string
          recipe_name: string
        }[]
      }
      produce_recipe: {
        Args: {
          p_portions: number
          p_recipe_id: number
          p_reference_id?: string
        }
        Returns: Json
      }
      production_dashboard: { Args: { p_days?: number }; Returns: Json }
      recalculate_semaphores: { Args: never; Returns: undefined }
      recipes_at_risk: {
        Args: { p_min_portions?: number }
        Returns: {
          max_portions: number
          missing_items: Json
          recipe_id: string
          recipe_name: string
        }[]
      }
      resolve_alert:
        | {
            Args: { p_alert_id: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.resolve_alert(p_alert_id => text), public.resolve_alert(p_alert_id => uuid). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { p_alert_id: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.resolve_alert(p_alert_id => text), public.resolve_alert(p_alert_id => uuid). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      stock_reconciliation: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          actual_closing: number
          expected_closing: number
          manual_adj: number
          name: string
          opening_qty: number
          prod_in: number
          prod_out: number
          received: number
          sales: number
          stock_item_id: string
          unit: string
          variance: number
          waste: number
        }[]
      }
      stock_yield: {
        Args: never
        Returns: {
          ingredients: Json
          limiting_item: string
          limiting_need: number
          limiting_qty: number
          max_portions: number
          recipe_id: string
          recipe_name: string
          yield_portions: number
        }[]
      }
      update_stock_qty:
        | { Args: { p_item_id: string; p_new_qty: number }; Returns: undefined }
        | { Args: { p_item_id: string; p_new_qty: number }; Returns: Json }
    }
    Enums: {
      app_role:
        | "encargado"
        | "chef"
        | "barista"
        | "runner"
        | "cocina"
        | "socio"
        | "bacha"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "encargado",
        "chef",
        "barista",
        "runner",
        "cocina",
        "socio",
        "bacha",
      ],
    },
  },
} as const

// ---------------------------------------------------------------------------
// Convenience type aliases
// ---------------------------------------------------------------------------
export type Profile = Database['public']['Tables']['profiles']['Row']
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert']
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update']

export type AttendanceLog = Database['public']['Tables']['attendance_logs']['Row']
export type AttendanceLogInsert = Database['public']['Tables']['attendance_logs']['Insert']
export type AttendanceLogUpdate = Database['public']['Tables']['attendance_logs']['Update']

export type Shift = Database['public']['Tables']['shifts']['Row']
export type ShiftInsert = Database['public']['Tables']['shifts']['Insert']
export type ShiftUpdate = Database['public']['Tables']['shifts']['Update']

export type Announcement = Database['public']['Tables']['announcements']['Row']
export type AnnouncementInsert = Database['public']['Tables']['announcements']['Insert']
export type AnnouncementUpdate = Database['public']['Tables']['announcements']['Update']

export type AnnouncementRead = Database['public']['Tables']['announcement_reads']['Row']

export type Supplier = Database['public']['Tables']['suppliers']['Row']
export type SupplierInsert = Database['public']['Tables']['suppliers']['Insert']
export type SupplierUpdate = Database['public']['Tables']['suppliers']['Update']

export type StockItem = Database['public']['Tables']['stock_items']['Row']
export type StockItemInsert = Database['public']['Tables']['stock_items']['Insert']
export type StockItemUpdate = Database['public']['Tables']['stock_items']['Update']

export type StockAlert = Database['public']['Tables']['stock_alerts']['Row']
export type StockAlertInsert = Database['public']['Tables']['stock_alerts']['Insert']
export type StockAlertUpdate = Database['public']['Tables']['stock_alerts']['Update']

export type Recipe = Database['public']['Tables']['recipes']['Row']
export type RecipeInsert = Database['public']['Tables']['recipes']['Insert']
export type RecipeUpdate = Database['public']['Tables']['recipes']['Update']

export type RecipeIngredient = Database['public']['Tables']['recipe_ingredients']['Row']
export type RecipeIngredientInsert = Database['public']['Tables']['recipe_ingredients']['Insert']
export type RecipeIngredientUpdate = Database['public']['Tables']['recipe_ingredients']['Update']

export type RecipeIngredientPendingLink = Database['public']['Tables']['recipe_ingredient_pending_links']['Row']
export type RecipeIngredientPendingLinkInsert = Database['public']['Tables']['recipe_ingredient_pending_links']['Insert']
export type RecipeIngredientPendingLinkUpdate = Database['public']['Tables']['recipe_ingredient_pending_links']['Update']

export type MenuCategory = Database['public']['Tables']['menu_categories']['Row']
export type MenuCategoryInsert = Database['public']['Tables']['menu_categories']['Insert']
export type MenuCategoryUpdate = Database['public']['Tables']['menu_categories']['Update']

export type MenuItem = Database['public']['Tables']['menu_items']['Row']
export type MenuItemInsert = Database['public']['Tables']['menu_items']['Insert']
export type MenuItemUpdate = Database['public']['Tables']['menu_items']['Update']

export type FudoSale = Database['public']['Tables']['fudo_sales']['Row']
export type FudoSaleInsert = Database['public']['Tables']['fudo_sales']['Insert']
export type FudoSyncEvent = Database['public']['Tables']['fudo_sync_events']['Row']
export type FudoSyncEventInsert = Database['public']['Tables']['fudo_sync_events']['Insert']
export type FudoSyncIncident = Database['public']['Tables']['fudo_sync_incidents']['Row']
export type FudoSyncIncidentInsert = Database['public']['Tables']['fudo_sync_incidents']['Insert']

export type StockMovement = Database['public']['Tables']['stock_movements']['Row']
export type StockMovementInsert = Database['public']['Tables']['stock_movements']['Insert']

export type RecipeCost = {
  recipe_id: number
  recipe_name: string
  portion_yield: number
  cost_per_portion: number
  cost_per_batch: number
}

export type KitchenDailyLog = Database['public']['Tables']['kitchen_daily_logs']['Row']
export type KitchenDailyLogInsert = Database['public']['Tables']['kitchen_daily_logs']['Insert']
export type KitchenDailyLogUpdate = Database['public']['Tables']['kitchen_daily_logs']['Update']

export type AuditLog = Database['public']['Tables']['audit_log']['Row']

// Kitchen Operations type aliases
export type KitchenShift = Database['public']['Tables']['kitchen_shifts']['Row']
export type KitchenShiftInsert = Database['public']['Tables']['kitchen_shifts']['Insert']
export type KitchenShiftUpdate = Database['public']['Tables']['kitchen_shifts']['Update']

export type ChecklistTemplate = Database['public']['Tables']['checklist_templates']['Row']
export type ChecklistTemplateInsert = Database['public']['Tables']['checklist_templates']['Insert']
export type ChecklistTemplateUpdate = Database['public']['Tables']['checklist_templates']['Update']

export type ChecklistItem = Database['public']['Tables']['checklist_items']['Row']
export type ChecklistItemInsert = Database['public']['Tables']['checklist_items']['Insert']
export type ChecklistItemUpdate = Database['public']['Tables']['checklist_items']['Update']

export type MiseEnPlaceItem = Database['public']['Tables']['mise_en_place_items']['Row']
export type MiseEnPlaceItemInsert = Database['public']['Tables']['mise_en_place_items']['Insert']
export type MiseEnPlaceItemUpdate = Database['public']['Tables']['mise_en_place_items']['Update']

export type MiseEnPlaceRecord = Database['public']['Tables']['mise_en_place_records']['Row']
export type MiseEnPlaceRecordInsert = Database['public']['Tables']['mise_en_place_records']['Insert']
export type MiseEnPlaceRecordUpdate = Database['public']['Tables']['mise_en_place_records']['Update']

// Bar operations type aliases
export type BarStockItem = Database['public']['Tables']['bar_stock_items']['Row']
export type BarStockItemInsert = Database['public']['Tables']['bar_stock_items']['Insert']
export type BarStockItemUpdate = Database['public']['Tables']['bar_stock_items']['Update']

export type BarOrder = Database['public']['Tables']['bar_orders']['Row']
export type BarOrderInsert = Database['public']['Tables']['bar_orders']['Insert']
export type BarOrderUpdate = Database['public']['Tables']['bar_orders']['Update']

// Kitchen order type aliases
export type KitchenOrder = Database['public']['Tables']['kitchen_orders']['Row']
export type KitchenOrderInsert = Database['public']['Tables']['kitchen_orders']['Insert']
export type KitchenOrderUpdate = Database['public']['Tables']['kitchen_orders']['Update']

// ---------------------------------------------------------------------------
// RPC return types (stock availability + duration calculations)
// ---------------------------------------------------------------------------

export type StockAvailabilityIngredient = {
  stock_item_id: number
  name: string
  current_qty: number
  qty_per_portion: number
  unit: string
  available_portions: number
  is_limiting: boolean
}

export type StockAvailabilityResult = {
  success: boolean
  recipe_id: number
  recipe_name: string
  available_portions: number
  limiting_ingredient: string | null
  limiting_ingredient_id: number | null
  ingredients_count: number
  ingredients: StockAvailabilityIngredient[]
  warning?: string
  error?: string
}

export type StockDurationResult = {
  success: boolean
  stock_item_id: number
  name: string
  current_qty: number
  unit: string
  days_lookback: number
  total_consumed: number
  daily_avg_consumption: number
  days_remaining: number | null
  semaphore: 'critico' | 'bajo' | 'atención' | 'ok' | 'sin_historial'
  note: string | null
  error?: string
}

export type RecipeAtRisk = {
  recipe_id: number
  recipe_name: string
  available_portions: number
  limiting_ingredient: string | null
  limiting_item_id: number | null
  status: 'sin_stock' | 'bajo' | 'ok'
}

export type RecipeStockStatus = {
  recipe_id: number
  recipe_name: string
  recipe_slug: string | null
  portion_yield: number
  cost_per_portion: number
  cost_per_batch: number
  linked_ingredients_count: number
  out_of_stock_count: number
  critical_stock_count: number
}

// ---------------------------------------------------------------------------
// Production system types
// ---------------------------------------------------------------------------

export type ProductionTemplate = Database['public']['Tables']['production_templates']['Row']
export type ProductionTemplateInsert = Database['public']['Tables']['production_templates']['Insert']
export type ProductionTemplateUpdate = Database['public']['Tables']['production_templates']['Update']

export type ProductionTemplateOutput = Database['public']['Tables']['production_template_outputs']['Row']
export type ProductionTemplateOutputInsert = Database['public']['Tables']['production_template_outputs']['Insert']
export type ProductionTemplateOutputUpdate = Database['public']['Tables']['production_template_outputs']['Update']

export type ProductionOrder = Database['public']['Tables']['production_orders']['Row']
export type ProductionOrderInsert = Database['public']['Tables']['production_orders']['Insert']
export type ProductionOrderUpdate = Database['public']['Tables']['production_orders']['Update']

export type ProductionInput = Database['public']['Tables']['production_inputs']['Row']
export type ProductionInputInsert = Database['public']['Tables']['production_inputs']['Insert']
export type ProductionInputUpdate = Database['public']['Tables']['production_inputs']['Update']

export type ProductionOutput = Database['public']['Tables']['production_outputs']['Row']
export type ProductionOutputInsert = Database['public']['Tables']['production_outputs']['Insert']
export type ProductionOutputUpdate = Database['public']['Tables']['production_outputs']['Update']

export type ProductionOrderStatus = 'draft' | 'in_progress' | 'pending_review' | 'completed' | 'cancelled'

// Full order with nested inputs + outputs (returned by GET /api/produccion/orders/[id])
export type ProductionOrderDetail = ProductionOrder & {
  chef_name: string | null
  template_name: string | null
  inputs: (ProductionInput & { stock_item_name: string; stock_item_unit: string })[]
  outputs: (ProductionOutput & { stock_item_name: string | null })[]
  child_orders: Pick<ProductionOrder, 'id' | 'name' | 'status' | 'completed_at'>[]
  summary: {
    total_input_qty: number
    total_output_qty: number
    total_waste_qty: number
    efficiency_pct: number | null
  }
}

// Dashboard RPC result
export type ProductionDashboard = {
  period_days: number
  total_completed: number
  total_input_kg: number | null
  total_waste_kg: number | null
  avg_efficiency_pct: number | null
  pending_orders: number
  by_chef: {
    chef_id: string | null
    chef_name: string
    total_orders: number
    avg_efficiency: number | null
    total_waste: number
  }[]
  daily: {
    day: string
    orders: number
    avg_efficiency: number | null
  }[]
}

// Summary row from v_production_summary view
export type ProductionSummaryRow = {
  id: number
  name: string
  status: ProductionOrderStatus
  parent_order_id: number | null
  template_id: number | null
  chef_id: string | null
  notes: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  chef_name: string | null
  chef_role: string | null
  template_name: string | null
  total_input_qty: number
  total_output_qty: number
  total_waste_qty: number
  efficiency_pct: number | null
  child_orders_count: number
}

// ---------------------------------------------------------------------------
// Attendance Anti-Fraud System types
// ---------------------------------------------------------------------------

export type AttendanceStatus = 'clocked_in' | 'clocked_out' | 'no_record'

export type ClockEvent = {
  id: string
  employee_id: string
  event_type: ClockEventType
  timestamp: string
  wifi_bssid: string | null
  wifi_ssid: string | null
  gps_lat: number | null
  gps_lng: number | null
  gps_accuracy: number | null
  selfie_url: string | null
  device_fingerprint: string | null
  user_agent: string | null
  ip_address: string | null
  verified: boolean
  anomaly_flags: AnomalyFlag[]
  created_at: string
}

export type DeviceRegistration = {
  id: string
  employee_id: string
  device_fingerprint: string
  user_agent: string | null
  device_name: string | null
  registered_at: string
  is_active: boolean
  approved_by: string | null
  approved_at: string | null
}

export type AttendanceAnomaly = {
  id: string
  clock_event_id: string
  employee_id: string
  anomaly_type: AnomalyType
  severity: AnomalySeverity
  details: Record<string, unknown>
  resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  resolution_notes: string | null
  created_at: string
}

export type AttendanceCorrection = {
  id: string
  employee_id: string
  original_event_id: string | null
  correction_type: CorrectionType
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown>
  reason: string
  requested_by: string
  approved_by: string | null
  approved_at: string | null
  status: CorrectionStatus
  rejection_reason: string | null
  created_at: string
}

export type WifiAccessPoint = {
  id: string
  name: string
  bssid: string | null
  ssid: string | null
  location_description: string | null
  is_active: boolean
  created_at: string
  created_by: string | null
}

export type AttendanceConfig = {
  key: string
  value: Record<string, unknown>
  updated_at: string
  updated_by: string | null
}

export type EmployeeHours = {
  total_hours: number
  normal_hours: number
  nocturnal_hours: number
  extra_hours: number
  days_worked: number
}

export type AttendanceDashboardRow = {
  employee_id: string
  first_name: string
  last_name: string
  role: string
  is_currently_in: boolean
  last_event_time: string | null
  days_worked: number
  total_hours: number
  /** Fichajes sospechosos en el período (nombre histórico del campo). */
  open_anomalies: number
  /** Horas programadas según turnos cargados en el período. */
  scheduled_hours: number
  /** Turno de HOY (si está cargado). */
  shift_today: { start: string; end: string } | null
  today_in: string | null
  today_out: string | null
  today_out_type: string | null
  /** Minutos de diferencia contra el inicio del turno (positivo = tarde). */
  late_min: number | null
  /** Minutos que se fue antes del fin del turno (solo egreso manual). */
  left_early_min: number | null
  /** Tiene turno hoy, ya empezó hace >15 min y no fichó. */
  no_show: boolean
}

// ---------------------------------------------------------------------------
// Stock Reconciliation
// ---------------------------------------------------------------------------

export type StockReconciliationRow = {
  stock_item_id: string
  name: string
  unit: string
  opening_qty: number
  received: number
  prod_in: number
  prod_out: number
  sales: number
  waste: number
  manual_adj: number
  expected_closing: number
  actual_closing: number
  variance: number
}

export type MenuItemReconciliationRow = {
  menu_item_id: string
  menu_item_name: string
  recipe_id: string
  recipe_name: string | null
  qty_produced: number
  qty_sold: number
  expected_remaining: number
}
