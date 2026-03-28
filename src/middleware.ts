import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()

  // Skip auth for login page, API routes, and static files
  if (
    req.nextUrl.pathname === '/login' ||
    req.nextUrl.pathname.startsWith('/api/') ||
    req.nextUrl.pathname === '/guide'
  ) {
    return res
  }

  // Check for Supabase auth cookie
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    // No Supabase config — allow through (dev mode)
    return res
  }

  // Look for auth token in cookies (supports both formats)
  const hasAuth = req.cookies.getAll().some(c =>
    (c.name.startsWith('sb-') && c.name.endsWith('-auth-token')) ||
    c.name === 'sb-access-token'
  )

  if (!hasAuth) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
