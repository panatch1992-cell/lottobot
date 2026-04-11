/**
 * GET    /api/admin/bot-accounts           — list all bot accounts
 * POST   /api/admin/bot-accounts           — create { name, endpoint_url?, endpoint_token?, priority? }
 * PATCH  /api/admin/bot-accounts?id=...    — update fields
 * DELETE /api/admin/bot-accounts?id=...    — remove
 *
 * Also:
 * POST   /api/admin/bot-accounts?action=resume&id=...  — clear cooldown_until
 * POST   /api/admin/bot-accounts?action=pause&id=...   — set cooldown_until = +24h
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function hasAuthCookie(req: NextRequest): boolean {
  const allCookies = req.cookies.getAll()
  return allCookies.some(c =>
    (c.name.startsWith('sb-') && c.name.endsWith('-auth-token')) ||
    c.name === 'sb-access-token'
  )
}

function requireAuth(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '')
  if (authHeader && authHeader === process.env.CRON_SECRET) return null
  if (!hasAuthCookie(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const db = getServiceClient()
  const { data, error } = await db
    .from('bot_accounts')
    .select('*')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data || [] })
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const action = req.nextUrl.searchParams.get('action')
  const id = req.nextUrl.searchParams.get('id')

  // Actions
  if (action && id) {
    const db = getServiceClient()
    if (action === 'resume') {
      const { error } = await db
        .from('bot_accounts')
        .update({
          cooldown_until: null,
          consecutive_failures: 0,
          health_status: 'unknown',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    if (action === 'pause') {
      const cooldownUntil = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
      const { error } = await db
        .from('bot_accounts')
        .update({
          cooldown_until: cooldownUntil,
          health_status: 'cooldown',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, cooldown_until: cooldownUntil })
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }

  // Create
  const body = await req.json().catch(() => ({}))
  const name = (body.name || '').trim()
  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }

  const db = getServiceClient()
  const { data, error } = await db
    .from('bot_accounts')
    .insert({
      name,
      endpoint_url: body.endpoint_url || null,
      endpoint_token: body.endpoint_token || null,
      line_mid: body.line_mid || null,
      line_display_name: body.line_display_name || null,
      priority: typeof body.priority === 'number' ? body.priority : 100,
      is_active: true,
      health_status: 'unknown',
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function PATCH(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = {}
  if (typeof body.name === 'string') update.name = body.name
  if (typeof body.endpoint_url === 'string') update.endpoint_url = body.endpoint_url || null
  if (typeof body.endpoint_token === 'string') update.endpoint_token = body.endpoint_token || null
  if (typeof body.priority === 'number') update.priority = body.priority
  if (typeof body.is_active === 'boolean') update.is_active = body.is_active
  if (typeof body.line_display_name === 'string') update.line_display_name = body.line_display_name

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }
  update.updated_at = new Date().toISOString()

  const db = getServiceClient()
  const { data, error } = await db
    .from('bot_accounts')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const db = getServiceClient()
  const { error } = await db.from('bot_accounts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
