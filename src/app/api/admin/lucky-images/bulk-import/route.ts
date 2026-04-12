/**
 * POST /api/admin/lucky-images/bulk-import
 *
 * Body: { urls: string[] | string, category?: string }
 *
 * Accepts an array (or newline-separated string) of https image URLs
 * and inserts each as a lucky_images row. Dedups by source_hash.
 *
 * Use case: admin grabs image URLs from Google Images / Facebook /
 * anywhere → pastes them into the UI → bulk imports. No scraping.
 *
 * Response:
 *   { added, skipped, invalid, errors?: string[] }
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

function normalizeUrls(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .filter((x): x is string => typeof x === 'string')
      .map(s => s.trim())
      .filter(Boolean)
  }
  if (typeof input === 'string') {
    return input
      .split(/[\r\n,]+/)
      .map(s => s.trim())
      .filter(Boolean)
  }
  return []
}

function isValidHttpsImage(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req)
  if (authError) return authError

  const body = await req.json().catch(() => ({}))
  const urls = normalizeUrls(body.urls)
  const category = typeof body.category === 'string' && body.category.trim()
    ? body.category.trim()
    : 'general'

  if (urls.length === 0) {
    return NextResponse.json({ error: 'urls required (array or newline-separated string)' }, { status: 400 })
  }
  if (urls.length > 200) {
    return NextResponse.json({ error: 'max 200 URLs per request' }, { status: 400 })
  }

  const db = getServiceClient()
  let added = 0
  let skipped = 0
  let invalid = 0
  const errors: string[] = []

  for (const rawUrl of urls) {
    if (!isValidHttpsImage(rawUrl)) {
      invalid++
      continue
    }

    const hash = hashUrl(rawUrl)

    const { data: existing } = await db
      .from('lucky_images')
      .select('id')
      .eq('source_hash', hash)
      .maybeSingle()

    if (existing) {
      skipped++
      continue
    }

    const { error } = await db.from('lucky_images').insert({
      public_url: rawUrl,
      storage_path: rawUrl,
      source_url: rawUrl,
      source_hash: hash,
      category,
      caption: null,
      uploaded_by: 'bulk-import',
    })

    if (error) {
      if (errors.length < 5) errors.push(error.message)
    } else {
      added++
    }
  }

  return NextResponse.json({
    added,
    skipped,
    invalid,
    total: urls.length,
    ...(errors.length > 0 && { errors }),
  })
}
