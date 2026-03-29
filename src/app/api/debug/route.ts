import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  const diag: Record<string, unknown> = {
    supabase_url: supabaseUrl ? supabaseUrl.substring(0, 30) + '...' : 'MISSING',
    service_key: serviceKey ? serviceKey.substring(0, 15) + '...' : 'MISSING',
  }

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ...diag, error: 'Missing env vars' })
  }

  try {
    const db = createClient(supabaseUrl, serviceKey)

    // Check tables
    const { data: settings, error: settingsErr } = await db.from('bot_settings').select('key, value')
    diag.bot_settings_error = settingsErr?.message || null
    diag.bot_settings_count = settings?.length || 0
    diag.bot_settings = settings?.map(s => ({ key: s.key, value: s.value ? s.value.substring(0, 10) + '...' : '(empty)' }))

    // Try upsert
    const { error: upsertErr } = await db.from('bot_settings').upsert(
      { key: 'test_key', value: 'test_value', updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )
    diag.upsert_test = upsertErr ? upsertErr.message : 'OK'

    // Clean up test
    await db.from('bot_settings').delete().eq('key', 'test_key')

    return NextResponse.json(diag)
  } catch (err) {
    return NextResponse.json({ ...diag, error: err instanceof Error ? err.message : 'Unknown error' })
  }
}
