import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { today } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// Debug endpoint — ทดสอบ DB connection + settings + LINE/TG config
export async function GET() {
  const results: Record<string, unknown> = {}

  try {
    const db = getServiceClient()
    results.db_connected = true

    // Test read settings
    const { data: settings, error: settingsErr } = await db.from('bot_settings').select('key, value')
    results.settings_count = settings?.length || 0
    results.settings_error = settingsErr?.message || null

    const settingsMap: Record<string, string> = {}
    ;(settings || []).forEach((s: { key: string; value: string }) => { settingsMap[s.key] = s.value })

    results.has_tg_token = !!settingsMap.telegram_bot_token
    results.has_tg_channel = !!settingsMap.telegram_admin_channel
    results.tg_channel_value = settingsMap.telegram_admin_channel ? settingsMap.telegram_admin_channel.substring(0, 5) + '...' : '(empty)'
    results.has_line_token = !!settingsMap.line_channel_access_token
    results.line_token_length = settingsMap.line_channel_access_token?.length || 0
    results.default_theme = settingsMap.default_theme || '(not set)'
    results.all_keys = Object.keys(settingsMap)

    // Test read lotteries
    const { data: lotteries, error: lotErr } = await db.from('lotteries').select('id, name').eq('status', 'active').limit(3)
    results.active_lotteries = lotteries?.length || 0
    results.lotteries_error = lotErr?.message || null
    results.sample_lottery = lotteries?.[0]?.name || null

    // Test read line_groups
    const { data: groups, error: grpErr } = await db.from('line_groups').select('id, name, line_group_id').eq('is_active', true)
    results.active_line_groups = groups?.length || 0
    results.groups_error = grpErr?.message || null
    results.groups_have_id = groups?.filter((g: { line_group_id: string | null }) => !!g.line_group_id).length || 0

    // Test insert into results (dry run - insert then delete)
    const todayStr = today()
    const testLotteryId = lotteries?.[0]?.id
    if (testLotteryId) {
      const { data: insertTest, error: insertErr } = await db.from('results').insert({
        lottery_id: testLotteryId,
        draw_date: '1999-01-01',
        top_number: '999',
        bottom_number: '99',
        source_url: 'debug-test',
      }).select().single()

      results.insert_test = insertTest ? 'SUCCESS' : 'FAILED'
      results.insert_error = insertErr?.message || insertErr?.code || null

      // Clean up test row
      if (insertTest) {
        await db.from('results').delete().eq('id', insertTest.id)
        results.cleanup = 'deleted test row'
      }
    }

    // Test save setting (write + read back)
    const testKey = 'debug_test_' + Date.now()
    const { error: saveErr } = await db.from('bot_settings').insert({ key: testKey, value: 'test123' })
    const { data: readBack } = await db.from('bot_settings').select('value').eq('key', testKey).single()
    results.save_test = readBack?.value === 'test123' ? 'SUCCESS' : 'FAILED'
    results.save_error = saveErr?.message || null
    // Clean up
    await db.from('bot_settings').delete().eq('key', testKey)

    // Test UPDATE existing key
    const { data: updateTest, error: updateErr } = await db.from('bot_settings')
      .update({ value: 'updated_test' })
      .eq('key', 'telegram_admin_channel')
      .select()
    results.update_test = updateTest?.length ? `updated ${updateTest.length} rows` : 'FAILED (0 rows)'
    results.update_error = updateErr?.message || null

    // Read back to verify
    const { data: verifyUpdate } = await db.from('bot_settings').select('value').eq('key', 'telegram_admin_channel').single()
    results.tg_channel_after_update = verifyUpdate?.value || '(still empty)'

    // Restore original value (put back empty since we just tested)
    if (verifyUpdate?.value === 'updated_test') {
      await db.from('bot_settings').update({ value: '' }).eq('key', 'telegram_admin_channel')
    }

    results.today = todayStr
    results.env_supabase_url = !!process.env.NEXT_PUBLIC_SUPABASE_URL
    results.env_service_key = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  } catch (err) {
    results.exception = err instanceof Error ? err.message : String(err)
  }

  return NextResponse.json(results)
}
