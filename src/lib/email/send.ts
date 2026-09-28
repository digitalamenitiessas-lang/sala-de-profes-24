// ---------------------------------------------------------------------------
// Email notification system — Resend
// ---------------------------------------------------------------------------
// Sends email notifications for pedidos (cocina/barra) and expedientes.
// Falls back silently if RESEND_API_KEY is not configured.
// ---------------------------------------------------------------------------

import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM_EMAIL = process.env.EMAIL_FROM ?? 'Sala de Profes <info@laviejaescuelabar.com.ar>'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getEmailsByRole(role: string, excludeUserId?: string | null): Promise<string[]> {
  const admin = createAdminClient()
  const { data: profiles } = await admin
    .from('profiles')
    .select('id')
    .eq('role', role)
    .eq('is_active', true)

  if (!profiles?.length) return []

  // Get emails from auth.users via admin API
  const emails: string[] = []
  for (const p of profiles) {
    if (excludeUserId && p.id === excludeUserId) continue
    const { data } = await admin.auth.admin.getUserById(p.id)
    if (data?.user?.email) emails.push(data.user.email)
  }
  return emails
}

async function getEmailsByRoles(roles: string[]): Promise<string[]> {
  const all = await Promise.all(roles.map((r) => getEmailsByRole(r)))
  return [...new Set(all.flat())]
}

async function getUserEmail(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.auth.admin.getUserById(userId)
  return data?.user?.email ?? null
}

// ---------------------------------------------------------------------------
// Send email (safe — never throws)
// ---------------------------------------------------------------------------

async function sendEmail(to: string[], subject: string, html: string) {
  if (!resend || to.length === 0) return
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    })
  } catch (err) {
    console.error('[email] Error sending:', err)
  }
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function wrapTemplate(title: string, body: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; background: #faf8f5; border-radius: 16px; overflow: hidden;">
      <div style="background: #006d5a; padding: 20px 24px;">
        <h1 style="color: white; margin: 0; font-size: 16px; font-weight: 600;">🏫 Sala de Profes</h1>
        <p style="color: rgba(255,255,255,0.6); margin: 4px 0 0; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;">La Vieja Escuela</p>
      </div>
      <div style="padding: 24px;">
        <h2 style="color: #3d2c24; margin: 0 0 16px; font-size: 18px;">${title}</h2>
        ${body}
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #ebe6df;">
          <a href="https://sala-de-profes-lve.vercel.app" style="display: inline-block; background: #006d5a; color: white; text-decoration: none; padding: 10px 20px; border-radius: 10px; font-size: 13px; font-weight: 600;">
            Abrir Sala de Profes
          </a>
        </div>
      </div>
    </div>
  `
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Notify encargados about a new bar/kitchen order (only encargados, not socios) */
export async function notifyOrderToEncargados(opts: {
  type: 'barra' | 'cocina'
  authorName: string
  items: { name: string; quantity: string }[]
  urgency: string
  note?: string | null
  /** Creador del pedido: se excluye del mail (no se autonotifica) */
  excludeUserId?: string | null
}) {
  const emails = await getEmailsByRole('encargado', opts.excludeUserId ?? null)
  const icon = opts.type === 'barra' ? '☕' : '🍳'
  const label = opts.type === 'barra' ? 'Barra' : 'Cocina'

  const itemsList = opts.items
    .map((i) => `<li style="margin: 4px 0; color: #3d2c24;"><strong>${i.name}</strong> — ${i.quantity}</li>`)
    .join('')

  const urgencyColors: Record<string, string> = {
    normal: '#006d5a', alta: '#d4943a', urgente: '#ea504c',
  }

  const html = wrapTemplate(
    `${icon} Nuevo pedido de ${label}`,
    `
      <p style="color: #6b6560; margin: 0 0 12px; font-size: 14px;">
        <strong>${opts.authorName}</strong> creó un pedido:
      </p>
      <ul style="padding-left: 20px; margin: 0 0 12px;">${itemsList}</ul>
      <p style="margin: 0;">
        <span style="display: inline-block; background: ${urgencyColors[opts.urgency] ?? '#006d5a'}20; color: ${urgencyColors[opts.urgency] ?? '#006d5a'}; padding: 4px 10px; border-radius: 8px; font-size: 12px; font-weight: 600;">
          Urgencia: ${opts.urgency.charAt(0).toUpperCase() + opts.urgency.slice(1)}
        </span>
      </p>
      ${opts.note ? `<p style="color: #a39e97; margin: 12px 0 0; font-size: 13px; font-style: italic;">Nota: ${opts.note}</p>` : ''}
    `,
  )

  await sendEmail(emails, `${icon} Pedido de ${label} — ${opts.authorName}`, html)
}

/** Notify the responsible person (only) about expediente movements */
export async function notifyExpedienteToResponsible(opts: {
  responsibleId?: string | null
  code: string
  title: string
  action: string // 'creado' | 'tarea asignada' | 'tarea completada' | 'cambio de estado' | 'comentario'
  authorName: string
  detail?: string
}) {
  // Only email the responsible person — not all socios
  if (!opts.responsibleId) return

  const email = await getUserEmail(opts.responsibleId)
  if (!email) return

  const html = wrapTemplate(
    `📋 Expediente ${opts.code}`,
    `
      <p style="color: #6b6560; margin: 0 0 8px; font-size: 14px;">
        <strong>${opts.authorName}</strong> — ${opts.action}
      </p>
      <div style="background: white; border-radius: 10px; padding: 12px 16px; border-left: 3px solid #006d5a;">
        <p style="margin: 0; font-size: 15px; font-weight: 600; color: #3d2c24;">${opts.title}</p>
        ${opts.detail ? `<p style="margin: 8px 0 0; color: #6b6560; font-size: 13px;">${opts.detail}</p>` : ''}
      </div>
    `,
  )

  await sendEmail([email], `📋 ${opts.code} — ${opts.action}`, html)
}

/** @deprecated Use notifyExpedienteToResponsible instead */
export const notifyExpedienteToSocios = notifyExpedienteToResponsible

/** Notify a specific user about expediente assignment */
export async function notifyExpedienteAssignment(opts: {
  userId: string
  code: string
  title: string
  assignedBy: string
}) {
  const email = await getUserEmail(opts.userId)
  if (!email) return

  const html = wrapTemplate(
    `📋 Te asignaron un expediente`,
    `
      <p style="color: #6b6560; margin: 0 0 8px; font-size: 14px;">
        <strong>${opts.assignedBy}</strong> te asignó como responsable:
      </p>
      <div style="background: white; border-radius: 10px; padding: 12px 16px; border-left: 3px solid #d4943a;">
        <p style="margin: 0; font-size: 11px; color: #a39e97; font-family: monospace;">${opts.code}</p>
        <p style="margin: 4px 0 0; font-size: 15px; font-weight: 600; color: #3d2c24;">${opts.title}</p>
      </div>
      <p style="color: #6b6560; margin: 12px 0 0; font-size: 13px;">
        Revisá el expediente y tomá las acciones necesarias.
      </p>
    `,
  )

  await sendEmail([email], `📋 ${opts.code} — Asignado a vos`, html)
}

/** Notify a specific user about order status change */
export async function notifyOrderStatusChange(opts: {
  userId: string
  productName: string
  quantity: string
  newStatus: 'ordered' | 'received' | 'cancelled'
}) {
  const email = await getUserEmail(opts.userId)
  if (!email) return

  const statusLabels: Record<string, { icon: string; label: string; color: string }> = {
    ordered: { icon: '🚚', label: 'Enviado al proveedor', color: '#d4943a' },
    received: { icon: '✅', label: 'Recibido', color: '#006d5a' },
    cancelled: { icon: '❌', label: 'Cancelado', color: '#ea504c' },
  }

  const s = statusLabels[opts.newStatus]
  const html = wrapTemplate(
    `${s.icon} Pedido ${s.label.toLowerCase()}`,
    `
      <div style="background: white; border-radius: 10px; padding: 12px 16px; border-left: 3px solid ${s.color};">
        <p style="margin: 0; font-size: 15px; font-weight: 600; color: #3d2c24;">${opts.productName}</p>
        <p style="margin: 4px 0 0; color: #6b6560; font-size: 13px;">Cantidad: ${opts.quantity}</p>
      </div>
      <p style="margin: 12px 0 0;">
        <span style="display: inline-block; background: ${s.color}20; color: ${s.color}; padding: 4px 10px; border-radius: 8px; font-size: 12px; font-weight: 600;">
          ${s.label}
        </span>
      </p>
    `,
  )

  await sendEmail([email], `${s.icon} Pedido: ${opts.productName} — ${s.label}`, html)
}
