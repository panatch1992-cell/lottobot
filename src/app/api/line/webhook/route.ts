import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { getGroupSummary } from '@/lib/line-messaging'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient()

    // Get channel secret for signature verification (via REST API)
    const settings = await getSettings()

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
        console.error('LINE webhook: Invalid signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
      }
    }

    const parsed = JSON.parse(body)
    const events = parsed.events || []

    for (const event of events) {
      console.log('LINE webhook event:', event.type, event.source?.type, event.source?.groupId)

      // Bot joined a group
      if (event.type === 'join' && event.source?.type === 'group') {
        const groupId = event.source.groupId

        // Get group info
        let groupName = `กลุ่ม ${groupId.slice(-6)}`

        if (channelToken) {
          try {
            const info = await getGroupSummary(channelToken, groupId)
            if (info.name) groupName = info.name
          } catch (e) {
            console.error('LINE webhook: getGroupSummary error', e)
          }
        }

        // Check if group already exists
        const { data: existing } = await db
          .from('line_groups')
          .select('id')
          .eq('line_group_id', groupId)
          .maybeSingle()

        if (!existing) {
          const { error: insertErr } = await db.from('line_groups').insert({
            name: groupName,
            line_group_id: groupId,
            is_active: true,
          })
          if (insertErr) {
            console.error('LINE webhook: insert error', insertErr.message)
          }
        } else {
          // Reactivate if previously left
          await db.from('line_groups')
            .update({ is_active: true, name: groupName, updated_at: new Date().toISOString() })
            .eq('line_group_id', groupId)
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

// LINE sends a verification GET request + diagnostic info
export async function GET() {
  try {
    const db = getServiceClient()

    // Check settings (via REST API)
    const settings = await getSettings()

    // Check groups
    const { data: groups } = await db.from('line_groups').select('*').order('updated_at', { ascending: false }).limit(10)

    return NextResponse.json({
      status: 'ok',
      webhook: 'active',
      hasSecret: !!settings.line_channel_secret,
      hasToken: !!settings.line_channel_access_token,
      groups: (groups || []).map(g => ({
        name: g.name,
        line_group_id: g.line_group_id ? `...${g.line_group_id.slice(-8)}` : null,
        is_active: g.is_active,
        updated_at: g.updated_at,
      })),
    })
  } catch (err) {
    return NextResponse.json({ status: 'ok', error: err instanceof Error ? err.message : 'unknown' })
  }
}
