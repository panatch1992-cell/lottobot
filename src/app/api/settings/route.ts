import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function GET() {
  try {
    const db = getServiceClient()
    const [settingsRes, groupsRes] = await Promise.all([
      db.from('bot_settings').select('*'),
      db.from('line_groups').select('*').order('created_at'),
    ])
    return NextResponse.json({
      settings: settingsRes.data || [],
      groups: groupsRes.data || [],
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const db = getServiceClient()
    const body = await req.json()

    if (body.key && body.value !== undefined) {
      const { error } = await db.from('bot_settings')
        .update({ value: body.value, updated_at: new Date().toISOString() })
        .eq('key', body.key)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Missing key or value' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
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
