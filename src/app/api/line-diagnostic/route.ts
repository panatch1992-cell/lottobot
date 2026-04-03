import { NextRequest, NextResponse } from 'next/server'
import { getSettings } from '@/lib/supabase'
import { getLineQuotaFromAPI, checkLineQuota, verifyChannelToken } from '@/lib/line-messaging'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const settings = await getSettings()
  const token = settings.line_channel_access_token

  if (!token) {
    return NextResponse.json({ error: 'No LINE token configured' })
  }

  // 1. Verify token
  const tokenCheck = await verifyChannelToken(token)

  // 2. Get quota from API
  const quotaAPI = await getLineQuotaFromAPI(token)

  // 3. Internal quota check (daily budget)
  const internalQuota = await checkLineQuota()

  // 4. Try to get bot info
  let botInfo = null
  try {
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token}` },
    })
    botInfo = await res.json()
  } catch (e) {
    botInfo = { error: e instanceof Error ? e.message : 'failed' }
  }

  // 5. Try a test push to see exact error
  const testGroupId = req.nextUrl.searchParams.get('group_id')
  let pushTest = null
  if (testGroupId) {
    try {
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: testGroupId,
          messages: [{ type: 'text', text: '🔧 LINE diagnostic test' }],
        }),
      })
      const status = res.status
      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => { headers[k] = v })
      const body = await res.json().catch(() => res.text())
      pushTest = { status, headers, body }
    } catch (e) {
      pushTest = { error: e instanceof Error ? e.message : 'failed' }
    }
  }

  // 6. Check number of group members (to understand target reach)
  let groupInfo = null
  if (testGroupId) {
    try {
      const res = await fetch(`https://api.line.me/v2/bot/group/${testGroupId}/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      groupInfo = await res.json()
    } catch (e) {
      groupInfo = { error: e instanceof Error ? e.message : 'failed' }
    }
  }

  return NextResponse.json({
    token_valid: tokenCheck.valid,
    bot_info: botInfo,
    quota_api: quotaAPI,
    internal_quota: internalQuota,
    push_test: pushTest,
    group_info: groupInfo,
    hint: !testGroupId
      ? 'เพิ่ม &group_id=LINE_GROUP_ID เพื่อทดสอบส่งจริง + ดู error details'
      : undefined,
  })
}
