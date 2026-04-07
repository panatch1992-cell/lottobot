import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * POST /api/setup-unofficial
 *
 * One-click setup:
 * 1. อ่าน email/password ที่ลูกค้ากรอกจาก bot_settings
 * 2. ส่งไปให้ Render /login → ได้ authToken
 * 3. ส่ง authToken ไป Render /groups → ได้ group list
 * 4. Match กลุ่มกับ line_groups ใน DB → อัพเดท unofficial_group_id
 * 5. บันทึก authToken เข้า bot_settings
 *
 * Response: สรุปผลทุกขั้นตอน
 */
export async function POST(req: NextRequest) {
  const db = getServiceClient()
  const settings = await getSettings()
  const body = await req.json().catch(() => ({}))

  const steps: { step: string; status: 'ok' | 'fail' | 'skip'; detail: string }[] = []

  // ─── Step 1: ดึงข้อมูล credentials ─────────────────────

  const email = body.email || settings.line_bot_email || ''
  const password = body.password || settings.line_bot_password || ''
  const endpoint = (settings.unofficial_line_endpoint || process.env.UNOFFICIAL_LINE_ENDPOINT || '').replace(/\/+$/, '')
  const authHeader = settings.unofficial_line_token || process.env.UNOFFICIAL_LINE_TOKEN || ''

  if (!email || !password) {
    steps.push({ step: 'ดึงข้อมูล', status: 'fail', detail: 'ไม่มี email หรือ password — กรุณากรอกในหน้าตั้งค่าก่อน' })
    return NextResponse.json({ success: false, steps })
  }

  if (!endpoint) {
    steps.push({ step: 'ดึงข้อมูล', status: 'fail', detail: 'ไม่มี Unofficial Endpoint URL — กรอกในตั้งค่าขั้นสูง' })
    return NextResponse.json({ success: false, steps })
  }

  steps.push({ step: 'ดึงข้อมูล', status: 'ok', detail: `email: ${email.slice(0, 3)}***${email.slice(email.indexOf('@'))}` })

  // ─── Step 2: Login → ได้ authToken ─────────────────────

  let lineAuthToken = ''

  try {
    const loginRes = await fetch(`${endpoint}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: `Bearer ${authHeader}` } : {}),
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(30000),
    })

    const loginData = await loginRes.json().catch(() => ({ success: false, error: 'invalid response' }))

    if (loginData.success && loginData.authToken) {
      lineAuthToken = loginData.authToken
      steps.push({
        step: 'Login LINE',
        status: 'ok',
        detail: `ได้ Token (${lineAuthToken.slice(0, 8)}...${lineAuthToken.slice(-4)})`,
      })

      // บันทึก token เข้า DB
      await db.from('bot_settings')
        .upsert({ key: 'line_unofficial_auth_token', value: lineAuthToken, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    } else {
      steps.push({
        step: 'Login LINE',
        status: 'fail',
        detail: loginData.error || loginData.hint || `HTTP ${loginRes.status}`,
      })
      return NextResponse.json({ success: false, steps })
    }
  } catch (err) {
    steps.push({
      step: 'Login LINE',
      status: 'fail',
      detail: err instanceof Error ? err.message : 'Connection error',
    })
    return NextResponse.json({ success: false, steps })
  }

  // ─── Step 3: ดึง Group List ────────────────────────────

  let unofficialGroups: { id: string; name?: string }[] = []

  try {
    const groupRes = await fetch(`${endpoint}/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: `Bearer ${authHeader}` } : {}),
      },
      body: JSON.stringify({ authToken: lineAuthToken }),
      signal: AbortSignal.timeout(15000),
    })

    const groupData = await groupRes.json().catch(() => ({ success: false }))

    if (groupData.success && groupData.groups) {
      const raw = groupData.groups
      if (Array.isArray(raw)) {
        unofficialGroups = raw.map((g: string | { id: string; name?: string }) =>
          typeof g === 'string' ? { id: g } : g
        )
      } else if (typeof raw === 'object') {
        // อาจเป็น { memberMids: [...] } หรือรูปแบบอื่น
        const ids = raw.memberMids || raw.groupIds || Object.values(raw)
        if (Array.isArray(ids)) {
          unofficialGroups = ids.map((id: string) => ({ id: String(id) }))
        }
      }

      steps.push({
        step: 'ดึงกลุ่ม',
        status: unofficialGroups.length > 0 ? 'ok' : 'fail',
        detail: unofficialGroups.length > 0
          ? `พบ ${unofficialGroups.length} กลุ่ม`
          : 'ไม่พบกลุ่ม — ให้ลูกค้าเชิญบัญชี LINE เข้ากลุ่มก่อน',
      })
    } else {
      steps.push({
        step: 'ดึงกลุ่ม',
        status: 'fail',
        detail: groupData.error || 'ดึงกลุ่มไม่ได้',
      })
    }
  } catch (err) {
    steps.push({
      step: 'ดึงกลุ่ม',
      status: 'fail',
      detail: err instanceof Error ? err.message : 'Connection error',
    })
  }

  // ─── Step 4: Match + Update DB ─────────────────────────

  if (unofficialGroups.length > 0) {
    const { data: dbGroups } = await db.from('line_groups').select('id, name, line_group_id, unofficial_group_id')
    const existingGroups = dbGroups || []

    let matched = 0
    let created = 0

    for (const ug of unofficialGroups) {
      // ลอง match ด้วยชื่อ
      const nameMatch = ug.name
        ? existingGroups.find(eg => eg.name === ug.name && !eg.unofficial_group_id)
        : null

      if (nameMatch) {
        // อัพเดท unofficial_group_id
        await db.from('line_groups')
          .update({ unofficial_group_id: ug.id, updated_at: new Date().toISOString() })
          .eq('id', nameMatch.id)
        matched++
      } else {
        // เช็คว่ามี ID นี้อยู่แล้วไหม
        const existing = existingGroups.find(eg => eg.unofficial_group_id === ug.id)
        if (!existing) {
          // สร้างใหม่
          await db.from('line_groups').insert({
            name: ug.name || `กลุ่ม ${ug.id.slice(-6)}`,
            unofficial_group_id: ug.id,
            is_active: true,
          })
          created++
        }
      }
    }

    steps.push({
      step: 'อัพเดท DB',
      status: 'ok',
      detail: `match: ${matched} กลุ่ม, สร้างใหม่: ${created} กลุ่ม`,
    })
  }

  // ─── Step 5: ลบ password จาก DB (security) ─────────────

  await db.from('bot_settings')
    .update({ value: '***USED***', updated_at: new Date().toISOString() })
    .eq('key', 'line_bot_password')

  steps.push({
    step: 'ล้าง password',
    status: 'ok',
    detail: 'ลบ password ออกจาก DB แล้ว (เก็บไว้แค่ Token)',
  })

  // ─── สรุป ──────────────────────────────────────────────

  const allOk = steps.every(s => s.status === 'ok')

  return NextResponse.json({
    success: allOk,
    steps,
    summary: allOk
      ? 'ตั้งค่าเสร็จสมบูรณ์ — ระบบพร้อมส่งข้อความ!'
      : 'ตั้งค่ายังไม่เสร็จ — ดูรายละเอียดแต่ละขั้นตอน',
  })
}
