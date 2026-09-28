import { NextResponse } from 'next/server'
import { fudo } from '@/lib/fudoClient'
import { requireRole } from '@/lib/supabase/require-role'

export async function GET() {
  // Mesas, salones y medios de pago de Fudo: solo socios y encargados
  const auth = await requireRole(['socio', 'encargado'])
  if (auth.response) return auth.response
  try {
    const [rooms, tables, paymentMethods] = await Promise.all([
      fudo.getRooms(),
      fudo.getTables(),
      fudo.getPaymentMethods(),
    ])

    // Group tables by room
    const roomMap = new Map<string, { name: string; tableCount: number }>()
    for (const room of rooms) {
      roomMap.set(room.id, { name: room.name, tableCount: 0 })
    }
    for (const table of tables) {
      const roomId = (table._relationships?.room?.data as { id: string })?.id
      if (roomId && roomMap.has(roomId)) {
        roomMap.get(roomId)!.tableCount++
      }
    }

    return NextResponse.json({
      rooms: Array.from(roomMap.values()),
      paymentMethods: paymentMethods.map((pm) => ({
        name: pm.name,
        active: pm.active,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
