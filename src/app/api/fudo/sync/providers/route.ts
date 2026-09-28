import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// POST /api/fudo/sync/providers
// ---------------------------------------------------------------------------
// Sincroniza proveedores desde Fudo (/providers) hacia suppliers en Supabase.
// ---------------------------------------------------------------------------

export async function POST() {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response

    const supabase = createAdminClient()

    // Fetch Fudo providers
    const fudoProviders = await fudo.fetchAll<{ id: string; name: string }>(
      '/providers',
    )

    // Fetch existing suppliers
    const { data: existing } = await supabase
      .from('suppliers')
      .select('id, name, fudo_provider_id')

    const existingMap = new Map(
      (existing ?? [])
        .filter((s) => s.fudo_provider_id)
        .map((s) => [s.fudo_provider_id!, s]),
    )

    let synced = 0
    let created = 0
    let errors = 0

    for (const provider of fudoProviders) {
      const ex = existingMap.get(provider.id)

      if (ex) {
        // Update name if changed
        if (ex.name !== provider.name) {
          await supabase
            .from('suppliers')
            .update({ name: provider.name })
            .eq('id', ex.id)
        }
        synced++
      } else {
        // Create new supplier
        const category = guessSupplierCategory(provider.name)
        const { error } = await supabase.from('suppliers').insert({
          name: provider.name.trim(),
          category,
          fudo_provider_id: provider.id,
          is_active: true,
        })
        if (error) {
          console.error(`Failed to create supplier ${provider.name}:`, error.message)
          errors++
        } else {
          created++
        }
      }
    }

    return NextResponse.json({
      success: true,
      totalProviders: fudoProviders.length,
      synced,
      created,
      errors,
    })
  } catch (error) {
    console.error('[/api/fudo/sync/providers] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}

function guessSupplierCategory(name: string): string {
  const n = name.toLowerCase()
  if (/carne|carnic/i.test(n)) return 'carnes'
  if (/lácteo|lacteo|leche|queso/i.test(n)) return 'lacteos'
  if (/verdur|frut|puesto/i.test(n)) return 'verduras'
  if (/harina|panad|bakery|pannico/i.test(n)) return 'panaderia'
  if (/coca|refres|soda|bebid|hielo/i.test(n)) return 'bebidas'
  if (/aceite|gastronom/i.test(n)) return 'condimentos'
  if (/envase|packing|take away|papel|librer/i.test(n)) return 'desechables'
  if (/tacc/i.test(n)) return 'otros'
  if (/cafe|café/i.test(n)) return 'bebidas'
  if (/yogurt/i.test(n)) return 'lacteos'
  return 'otros'
}
