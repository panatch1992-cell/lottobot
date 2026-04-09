/**
 * /api/line/login — PIN Login proxy to Render
 *
 * POST: เริ่ม login (email/password → PIN)
 * GET:  poll สถานะ (session → waiting/success/timeout)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function getEndpointConfig() {
  const settings = await getSettings()
  const endpoint = (settings.unofficial_line_endpoint || '').replace(/\/+$/, '')
  const token = settings.unofficial_line_token || ''
  return { endpoint, token }
}

// POST: start login
export async function POST(req: NextRequest) {
  const { endpoint, token } = await getEndpointConfig()
  if (!endpoint) {
    return NextResponse.json({ success: false, error: 'Unofficial endpoint ยังไม่ได้ตั้งค่า' })
  }

  const body = await req.json().catch(() => ({}))
  const { email, password } = body

  if (!email || !password) {
    return NextResponse.json({ success: false, error: 'กรุณากรอก email และ password' })
  }

  try {
    const res = await fetch(`${endpoint}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(20000),
    })

    const data = await res.json()

    // If direct login success (no PIN), update DB + sync groups
    if (data.success && !data.needPin && data.token) {
      await onLoginSuccess(data.token, email)
    }

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Connection error',
    })
  }
}

// GET: poll for login result
export async function GET(req: NextRequest) {
  const { endpoint, token } = await getEndpointConfig()
  if (!endpoint) {
    return NextResponse.json({ status: 'error', error: 'No endpoint' })
  }

  const sessionId = req.nextUrl.searchParams.get('session')
  if (!sessionId) {
    return NextResponse.json({ status: 'error', error: 'session required' })
  }

  try {
    const res = await fetch(`${endpoint}/login/check?session=${sessionId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(10000),
    })

    const data = await res.json()

    // If success, update DB + sync groups
    if (data.status === 'success' && data.token) {
      const settings = await getSettings()
      const email = settings.line_bot_email || ''
      await onLoginSuccess(data.token, email)
    }

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      error: err instanceof Error ? err.message : 'Connection error',
    })
  }
}

// After login success: save token to DB + sync groups
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function onLoginSuccess(authToken: string, _email: string) {
  const db = getServiceClient()
  const { endpoint, token } = await getEndpointConfig()

  // Save token to DB
  await db.from('bot_settings')
    .upsert({ key: 'line_unofficial_auth_token', value: authToken, updated_at: new Date().toISOString() }, { onConflict: 'key' })

  // Sync groups from unofficial endpoint
  if (endpoint) {
    try {
      const groupRes = await fetch(`${endpoint}/groups`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(30000),
      })
      const groupData = await groupRes.json()

      if (groupData.groups && Array.isArray(groupData.groups)) {
        for (const g of groupData.groups) {
          const gid = typeof g === 'string' ? g : g.id
          const gname = typeof g === 'string' ? null : g.name

          // Check if group already exists
          const { data: existing } = await db.from('line_groups')
            .select('id')
            .eq('unofficial_group_id', gid)
            .maybeSingle()

          if (!existing) {
            // Try match by name
            if (gname) {
              const { data: nameMatch } = await db.from('line_groups')
                .select('id')
                .eq('name', gname)
                .is('unofficial_group_id', null)
                .maybeSingle()

              if (nameMatch) {
                await db.from('line_groups')
                  .update({ unofficial_group_id: gid, updated_at: new Date().toISOString() })
                  .eq('id', nameMatch.id)
                continue
              }
            }

            // Create new
            await db.from('line_groups').insert({
              name: gname || `กลุ่ม ${gid.slice(-6)}`,
              unofficial_group_id: gid,
              is_active: true,
            })
          }
        }
      }
    } catch {
      // group sync failed, not critical
    }
  }

  // Clear password from DB for security
  await db.from('bot_settings')
    .update({ value: '', updated_at: new Date().toISOString() })
    .eq('key', 'line_bot_password')
}
