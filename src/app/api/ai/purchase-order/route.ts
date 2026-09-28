import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { generatePurchaseOrders, generateOrderMessage } from '@/lib/ai/purchase-order'

// GET /api/ai/purchase-order — generate purchase orders grouped by supplier
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const result = await generatePurchaseOrders()
    return NextResponse.json(result)
  } catch (error) {
    console.error('[/api/ai/purchase-order GET]', error)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}

// POST /api/ai/purchase-order — generate message for a specific supplier + optionally save
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const body = await request.json()
    const { action } = body

    // Generate AI message for a supplier order
    if (action === 'generate_message') {
      const { order } = body
      if (!order) return NextResponse.json({ error: 'order requerido' }, { status: 400 })
      const message = await generateOrderMessage(order)
      return NextResponse.json({ message })
    }

    // Save order as sent (mark items as ordered)
    if (action === 'mark_sent') {
      const { supplier_id, items, message_sent } = body
      if (!supplier_id || !items?.length) {
        return NextResponse.json({ error: 'supplier_id y items requeridos' }, { status: 400 })
      }

      const admin = createAdminClient()

      // Update stock items last_ordered_at
      for (const item of items) {
        await admin
          .from('stock_items')
          .update({ last_ordered_at: new Date().toISOString() })
          .eq('id', item.item_id)
      }

      // Create announcement for audit trail
      await admin.from('announcements').insert({
        author_id: user.id,
        type: 'operativo',
        priority: 'media',
        title: `📦 Pedido enviado — ${body.supplier_name ?? 'Proveedor'}`,
        body: `${items.length} item(s) pedidos. ${message_sent ? 'Mensaje enviado.' : 'Generado por copiloto IA.'}`,
        scope: 'role',
        target_role: 'encargado',
        is_active: true,
      })

      // Audit trail (non-blocking)
      logAudit(admin, {
        userId: user.id,
        userName: null,
        action: 'ai_purchase_order',
        module: 'pedidos',
        entityType: 'stock_item',
        description: `AI generó orden de compra para ${items.length} items — ${body.supplier_name ?? 'Proveedor'}`,
      })

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (error) {
    console.error('[/api/ai/purchase-order POST]', error)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}
