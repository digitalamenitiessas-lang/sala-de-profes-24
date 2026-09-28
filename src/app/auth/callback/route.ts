import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// GET /auth/callback — handles Supabase email links (password reset, magic link, etc.)
// Supabase redirects here with ?code=... which we exchange for a session.
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const type = searchParams.get('type') // 'recovery', 'signup', 'magiclink', etc.
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // For password recovery, redirect to change password page
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/cambiar-clave`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // If code exchange fails, redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
