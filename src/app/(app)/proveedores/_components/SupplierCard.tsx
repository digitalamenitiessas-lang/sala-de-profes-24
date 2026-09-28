'use client'

import { Phone, Mail, MessageCircle, Pencil, Trash2, Package, AlertTriangle, CalendarDays } from 'lucide-react'
import type { Supplier, LowStockItem } from './types'
import { DOW_SHORT } from './types'
import { LowStockRow } from './LowStockRow'

function stripNonDigits(phone: string): string {
  return phone.replace(/\D/g, '')
}

type Props = {
  supplier: Supplier
  isEncargado: boolean
  lowStockItems: LowStockItem[]
  linkedCount: number
  whatsAppMessage: string
  onEdit: () => void
  onDelete: () => void
  onAssign: () => void
}

export function SupplierCard({ supplier, isEncargado, lowStockItems, linkedCount, whatsAppMessage, onEdit, onDelete, onAssign }: Props) {
  const phoneDigits = supplier.phone ? stripNonDigits(supplier.phone) : null
  const hasAlerts = lowStockItems.length > 0

  return (
    <div className={`space-y-3 rounded-xl p-5 transition-all ${hasAlerts ? 'bg-white ring-2 ring-[#ea504c]/20 shadow-sm' : 'card-elevated hover-lift'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[#3d2c24]">{supplier.name}</h3>
            {hasAlerts && (
              <span className="flex items-center gap-1 rounded-full bg-[#ea504c]/10 px-2 py-0.5 text-[10px] font-bold text-[#ea504c]">
                <AlertTriangle className="size-3" />
                {lowStockItems.length}
              </span>
            )}
          </div>
          {supplier.contact_name && <p className="text-xs text-[#a39e97]">{supplier.contact_name}</p>}
          <div className="flex items-center gap-1.5">
            {supplier.category && (
              <span className="inline-block rounded-full bg-[#f0f7f5] px-2.5 py-0.5 text-[11px] font-semibold text-[#006d5a]">
                {supplier.category}
              </span>
            )}
            {linkedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#faf8f5] px-2 py-0.5 text-[10px] font-medium text-[#a39e97]">
                <Package className="size-2.5" />
                {linkedCount}
              </span>
            )}
            {(supplier.order_days ?? []).length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf6ec] px-2 py-0.5 text-[10px] font-semibold text-[#d4943a]">
                <CalendarDays className="size-2.5" />
                {(supplier.order_days ?? []).map((d) => DOW_SHORT[d]).join(' · ')}
              </span>
            )}
          </div>
        </div>
        {isEncargado && (
          <div className="flex gap-1">
            <button onClick={onAssign} className="icon-btn hover:bg-[#f0f7f5] hover:text-[#006d5a]" title="Vincular productos">
              <Package className="size-4" />
            </button>
            <button onClick={onEdit} className="icon-btn hover:bg-[#faf8f5] hover:text-[#3d2c24]">
              <Pencil className="size-4" />
            </button>
            <button onClick={onDelete} className="icon-btn hover:bg-[#fef2f2] hover:text-[#ea504c]">
              <Trash2 className="size-4" />
            </button>
          </div>
        )}
      </div>

      {hasAlerts && (
        <div className="space-y-1.5 rounded-xl bg-[#fef7ed] p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#d4943a]">Productos con stock bajo</p>
          {lowStockItems.map((item) => <LowStockRow key={item.id} item={item} />)}
        </div>
      )}

      {(supplier.phone || supplier.email) && (
        <div className="space-y-1.5 text-xs text-[#a39e97]">
          {supplier.phone && (
            <a href={`tel:${supplier.phone}`} className="flex items-center gap-2 transition-colors hover:text-[#006d5a]">
              <Phone className="size-3 shrink-0" />
              <span className="text-[#3d2c24] underline decoration-dotted">{supplier.phone}</span>
            </a>
          )}
          {supplier.email && (
            <a href={`mailto:${supplier.email}`} className="flex items-center gap-2 transition-colors hover:text-[#006d5a]">
              <Mail className="size-3 shrink-0" />
              <span className="text-[#3d2c24] underline decoration-dotted">{supplier.email}</span>
            </a>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {phoneDigits ? (
          <a href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(whatsAppMessage)}`} target="_blank" rel="noopener noreferrer">
            <button className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-all active:scale-95 ${
              hasAlerts
                ? 'border-[#25D366] bg-[#25D366] text-white hover:bg-[#1da851]'
                : 'border-[#ebe6df] bg-[#fefcf9] text-[#25D366] hover:border-[#25D366] hover:bg-[#25D366] hover:text-white'
            }`}>
              <MessageCircle className="size-4" />
              {hasAlerts ? 'Pedir por WhatsApp' : 'WhatsApp'}
            </button>
          </a>
        ) : (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-full border border-dashed border-[#ebe6df] px-3 py-2 text-xs font-medium text-[#a39e97] transition-all hover:border-[#25D366] hover:text-[#25D366] active:scale-95"
          >
            <MessageCircle className="size-4" />
            Agregar teléfono
          </button>
        )}
        {phoneDigits && (
          <a href={`tel:${supplier.phone}`}>
            <button className="flex size-9 items-center justify-center rounded-full border border-[#ebe6df] bg-[#fefcf9] text-[#3d2c24] transition-all hover:border-[#006d5a]/20 hover:bg-[#f0f7f5] hover:text-[#006d5a] active:scale-95">
              <Phone className="size-4" />
            </button>
          </a>
        )}
        {supplier.email && (
          <a href={`mailto:${supplier.email}`}>
            <button className="flex size-9 items-center justify-center rounded-full border border-[#ebe6df] bg-[#fefcf9] text-[#006d5a] transition-all hover:border-[#006d5a] hover:bg-[#006d5a] hover:text-white active:scale-95">
              <Mail className="size-4" />
            </button>
          </a>
        )}
      </div>

      {supplier.notes && (
        <p className="border-t border-[#ebe6df] pt-3 text-xs italic leading-relaxed text-[#a39e97]">{supplier.notes}</p>
      )}
    </div>
  )
}
