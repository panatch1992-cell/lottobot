import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getGroupSummary } from '@/lib/line-messaging'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient()

    // Get channel secret for signature verification
    const { data: settingsData } = await db.from('bot_settings').select('key, value')
    const settings: Record<string, string> = {}
    ;(settingsData || []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value })

    const channelSecret = settings.line_channel_secret
    const channelToken = settings.line_channel_access_token

    // Verify signature
    const body = await req.text()
    const signature = req.headers.get('x-line-signature')

    if (channelSecret && signature) {
      const hash = crypto
        .createHmac('SHA256', channelSecret)
        .update(body)
        .digest('base64')
      if (hash !== signature) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
      }
    }

    const parsed = JSON.parse(body)
    const events = parsed.events || []

    for (const event of events) {
      // Bot joined a group
      if (event.type === 'join' && event.source?.type === 'group') {
        const groupId = event.source.groupId

        // Get group info
        let groupName = `กลุ่ม ${groupId.slice(-6)}`
        let memberCount = 0

        if (channelToken) {
          const info = await getGroupSummary(channelToken, groupId)
          if (info.name) groupName = info.name
          if (info.memberCount) memberCount = info.memberCount
        }

        // Check if group already exists
        const { data: existing } = await db
          .from('line_groups')
          .select('id')
          .eq('line_group_id', groupId)
          .maybeSingle()

        if (!existing) {
          await db.from('line_groups').insert({
            name: groupName,
            line_group_id: groupId,
            member_count: memberCount,
            is_active: true,
          })
        }
      }

      // Bot left/was removed from group
      if (event.type === 'leave' && event.source?.type === 'group') {
        const groupId = event.source.groupId
        await db
          .from('line_groups')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('line_group_id', groupId)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('LINE webhook error:', err)
    return NextResponse.json({ ok: true }) // Always return 200 to LINE
  }
}

// LINE sends a verification GET request
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
