import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import type { SupabaseClient } from '@supabase/supabase-js'

type DecisionAction = 'confirm_ok' | 'snooze_30d' | 'create_rule' | 'fix_fudo' | 'fix_lve'

type IssuePayload = {
  id?: string
  stock_item_id?: string | number
  stock_item_name?: string
  type?: string
  title?: string
  detail?: string
  current_qty?: number
  unit?: string
}

function issueKey(issue: IssuePayload) {
  return `${issue.type}:${issue.stock_item_id}`
}

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isMissingAnomalyTables(message: string | undefined) {
  if (!message) return false
  return message.includes('stock_anomaly_')
    || message.includes('Could not find the table')
    || message.includes('does not exist')
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!isManagerOrAbove(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const action = body.action as DecisionAction
    const issue = (body.issue ?? {}) as IssuePayload

    if (!action || !['confirm_ok', 'snooze_30d', 'create_rule', 'fix_fudo', 'fix_lve'].includes(action)) {
      return NextResponse.json({ error: 'Acción inválida' }, { status: 400 })
    }
    if (!issue.stock_item_id || !issue.type) {
      return NextResponse.json({ error: 'Falta issue.stock_item_id o issue.type' }, { status: 400 })
    }

    const admin = createAdminClient() as SupabaseClient
    const { data: item, error: itemError } = await admin
      .from('stock_items')
      .select('id, name, unit, current_qty, category, fudo_product_id, fudo_ingredient_id, fudo_skip')
      .eq('id', issue.stock_item_id)
      .single()

    if (itemError || !item) {
      return NextResponse.json({ error: 'Item de stock no encontrado' }, { status: 404 })
    }

    const now = new Date()
    const key = issueKey(issue)
    const snapshot = {
      issue_title: issue.title ?? null,
      issue_detail: issue.detail ?? null,
      current_qty: Number(item.current_qty ?? issue.current_qty ?? 0),
      unit: item.unit ?? issue.unit ?? null,
      category: item.category ?? null,
      fudo_product_id: item.fudo_product_id ?? null,
      fudo_ingredient_id: item.fudo_ingredient_id ?? null,
    }

    let decision: 'confirmed_ok' | 'snoozed' | 'rule_created' | 'fix_fudo' | 'fix_lve'
    let snoozedUntil: string | null = null
    let rule = null

    if (action === 'confirm_ok') {
      decision = 'confirmed_ok'
    } else if (action === 'snooze_30d') {
      decision = 'snoozed'
      snoozedUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
    } else if (action === 'create_rule') {
      decision = 'rule_created'
      const minQty = toNumberOrNull(body.min_qty)
      const maxQty = toNumberOrNull(body.max_qty)

      if (minQty == null && maxQty == null) {
        return NextResponse.json({ error: 'La regla necesita mínimo o máximo' }, { status: 400 })
      }
      if (minQty != null && maxQty != null && minQty > maxQty) {
        return NextResponse.json({ error: 'El mínimo no puede ser mayor al máximo' }, { status: 400 })
      }

      const { data: insertedRule, error: ruleError } = await admin
        .from('stock_anomaly_rules')
        .insert({
          stock_item_id: item.id,
          issue_type: issue.type,
          unit: item.unit,
          min_qty: minQty,
          max_qty: maxQty,
          notify_enabled: body.notify_enabled !== false,
          notification_priority: body.notification_priority ?? 'media',
          created_from_issue_key: key,
          note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
          created_by: user.id,
        })
        .select('id')
        .single()

      if (ruleError) {
        if (isMissingAnomalyTables(ruleError.message)) {
          return NextResponse.json({ error: 'Falta aplicar migración de anomalías de stock' }, { status: 409 })
        }
        throw ruleError
      }
      rule = insertedRule
    } else if (action === 'fix_fudo') {
      decision = 'fix_fudo'
    } else {
      decision = 'fix_lve'
    }

    const { data: insertedDecision, error: decisionError } = await admin
      .from('stock_anomaly_decisions')
      .insert({
        issue_key: key,
        stock_item_id: item.id,
        issue_type: issue.type,
        decision,
        note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
        snapshot,
        snoozed_until: snoozedUntil,
        decided_by: user.id,
      })
      .select('id, decision, snoozed_until')
      .single()

    if (decisionError) {
      if (isMissingAnomalyTables(decisionError.message)) {
        return NextResponse.json({ error: 'Falta aplicar migración de anomalías de stock' }, { status: 409 })
      }
      throw decisionError
    }

    try {
      const { error: auditError } = await admin.from('audit_trail').insert({
        user_id: user.id,
        action: `stock_anomaly_${decision}`,
        module: 'stock',
        entity_type: 'stock_item',
        entity_id: String(item.id),
        description: `${item.name}: ${decision} para ${issue.type}`,
        metadata: {
          issue_key: key,
          rule_id: rule?.id ?? null,
          snapshot,
        },
      })
      if (auditError) console.error('[stock anomaly audit]', auditError)
    } catch (auditError) {
      console.error('[stock anomaly audit]', auditError)
    }

    return NextResponse.json({
      success: true,
      decision: insertedDecision,
      rule,
    })
  } catch (error) {
    console.error('[POST /api/stock/anomalies/decision]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
