/**
 * GET  /api/admin/lucky-images           — list all lucky images
 * POST /api/admin/lucky-images           — add image by URL { public_url, category?, caption? }
 * DELETE /api/admin/lucky-images?id=...  — remove image
 * PATCH /api/admin/lucky-images?id=...   — update { is_active?, category?, caption? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import crypto from 'crypto'

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

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)
}

export async function GET(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const db = getServiceClient()
  const { searchParams } = req.nextUrl
  const category = searchParams.get('category')

  let q = db
    .from('lucky_images')
    .select('*')
    .order('uploaded_at', { ascending: false })
    .limit(500)

  if (category) q = q.eq('category', category)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const total = (data || []).length
  const active = (data || []).filter(r => r.is_active).length
  const totalUse = (data || []).reduce((sum, r) => sum + (r.use_count || 0), 0)

  return NextResponse.json({
    items: data || [],
    stats: { total, active, inactive: total - active, totalUse },
  })
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const body = await req.json().catch(() => ({}))
  const publicUrl = (body.public_url || '').trim()
  const category = (body.category || 'general').trim()
  const caption = (body.caption || '').trim() || null
  const storagePath = (body.storage_path || publicUrl).trim()

  if (!publicUrl || !/^https?:\/\//i.test(publicUrl)) {
    return NextResponse.json({ error: 'invalid public_url' }, { status: 400 })
  }

  const db = getServiceClient()
  const { data, error } = await db
    .from('lucky_images')
    .insert({
      public_url: publicUrl,
      storage_path: storagePath,
      category,
      caption,
      source_url: publicUrl,
      source_hash: hashUrl(publicUrl),
      uploaded_by: 'admin',
    })
    .select('*')
    .single()

  if (error) {
    if (error.message.includes('duplicate key')) {
      return NextResponse.json({ error: 'รูปนี้มีอยู่แล้ว' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ item: data })
}

export async function DELETE(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const db = getServiceClient()
  const { error } = await db.from('lucky_images').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = {}
  if (typeof body.is_active === 'boolean') update.is_active = body.is_active
  if (typeof body.category === 'string') update.category = body.category
  if (typeof body.caption === 'string') update.caption = body.caption

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const db = getServiceClient()
  const { data, error } = await db
    .from('lucky_images')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}
