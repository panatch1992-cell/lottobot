import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'

// Check if request has Supabase auth cookie (same logic as middleware)
function hasAuthCookie(req: NextRequest): boolean {
  const allCookies = req.cookies.getAll()
  return allCookies.some(c =>
    (c.name.startsWith('sb-') && c.name.endsWith('-auth-token')) ||
    c.name === 'sb-access-token'
  )
}

function requireAuth(req: NextRequest) {
  // Allow CRON_SECRET for programmatic access
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '')
  if (authHeader && authHeader === process.env.CRON_SECRET) return null

  // Require auth cookie for browser requests
  if (!hasAuthCookie(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function GET(req: NextRequest) {
  // Require authentication
  const authError = requireAuth(req)
  if (authError) return authError

  try {
    const db = getServiceClient()
    const [settingsRes, groupsRes] = await Promise.all([
      db.from('bot_settings').select('*'),
      db.from('line_groups').select('*').order('created_at'),
    ])

    let settingsData = settingsRes.data || []

    // Fallback: if Supabase JS client returns empty values, try REST API
    const hasEmptyValues = settingsData.some((s: { key: string; value: string }) => s.value === '' || s.value === null)
    if (hasEmptyValues || settingsData.length === 0) {
      const restSettings = await getSettings()
      if (Object.keys(restSettings).length > 0) {
        // Merge REST values into settingsData (REST values override empty ones)
        settingsData = settingsData.map((s: { key: string; value: string; [k: string]: unknown }) => {
          if ((!s.value || s.value === '') && restSettings[s.key]) {
            return { ...s, value: restSettings[s.key] }
          }
          return s
        })
        // Add any keys from REST that aren't in settingsData
        const existingKeys = new Set(settingsData.map((s: { key: string }) => s.key))
        for (const [key, value] of Object.entries(restSettings)) {
          if (!existingKeys.has(key)) {
            settingsData.push({ key, value })
          }
        }
      }
    }

    return NextResponse.json({
      settings: settingsData,
      groups: groupsRes.data || [],
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  // Require authentication
  const authError = requireAuth(req)
  if (authError) return authError

  try {
    const db = getServiceClient()
    const body = await req.json()

    if (body.key && body.value !== undefined) {
      const valueToSave = String(body.value)

      // Try update first (key exists from seed data)
      const { data: updated, error: updateError } = await db.from('bot_settings')
        .update({ value: valueToSave, updated_at: new Date().toISOString() })
        .eq('key', body.key)
        .select()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 })
      }

      // If no rows updated, insert new
      if (!updated || updated.length === 0) {
        const { data: inserted, error: insertError } = await db.from('bot_settings')
          .insert({ key: body.key, value: valueToSave, updated_at: new Date().toISOString() })
          .select()

        if (insertError) {
          return NextResponse.json({ error: insertError.message }, { status: 400 })
        }
        return NextResponse.json({ success: true, debug: { action: 'insert', key: body.key, valueLength: valueToSave.length, rows: inserted?.length } })
      }

      return NextResponse.json({ success: true, debug: { action: 'update', key: body.key, valueLength: valueToSave.length, rows: updated.length } })
    }

    return NextResponse.json({ error: 'Missing key or value' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // Require authentication
  const authError = requireAuth(req)
  if (authError) return authError

  try {
    const db = getServiceClient()
    const body = await req.json()

    if (body.action === 'add_group') {
      const { error } = await db.from('line_groups').insert({
        name: body.name,
        line_notify_token: body.line_notify_token || '',
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true })
    }

    if (body.action === 'toggle_group') {
      const { error } = await db.from('line_groups')
        .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
        .eq('id', body.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true })
    }

    if (body.action === 'delete_group') {
      const { error } = await db.from('line_groups').delete().eq('id', body.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
