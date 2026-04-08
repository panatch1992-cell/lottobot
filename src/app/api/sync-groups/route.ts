import { NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * POST /api/sync-groups
 *
 * ดึง unofficial group MIDs จาก Render /groups
 * แล้ว match + อัพเดท unofficial_group_id ใน DB อัตโนมัติ
 *
 * ใช้หลังจากได้ token ใหม่ — ไม่ต้อง login ใหม่
 */
export async function POST() {
  const db = getServiceClient()
  const settings = await getSettings()

  const endpoint = (settings.unofficial_line_endpoint || process.env.UNOFFICIAL_LINE_ENDPOINT || '').replace(/\/+$/, '')
  const authHeader = settings.unofficial_line_token || process.env.UNOFFICIAL_LINE_TOKEN || ''

  if (!endpoint) {
    return NextResponse.json({ success: false, error: 'Unofficial endpoint not configured' })
  }

  // Step 1: ดึงกลุ่มจาก Render /groups
  let groups: { id: string; name: string }[] = []
  try {
    const res = await fetch(`${endpoint}/groups`, {
      headers: authHeader ? { Authorization: `Bearer ${authHeader}` } : {},
      signal: AbortSignal.timeout(30000),
    })

    const data = await res.json().catch(() => null)
    if (!data?.success || !data?.groups) {
      return NextResponse.json({
        success: false,
        error: data?.error || 'ดึงกลุ่มไม่ได้ — token อาจหมดอายุหรือถูก logout',
      })
    }
    groups = data.groups
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Connection error',
    })
  }

  if (groups.length === 0) {
    return NextResponse.json({ success: false, error: 'ไม่พบกลุ่ม — บัญชี LINE อาจไม่ได้อยู่ในกลุ่มใดๆ' })
  }

  // Step 2: ดึงกลุ่มจาก DB
  const { data: dbGroups } = await db.from('line_groups').select('id, name, line_group_id, unofficial_group_id')
  const existing = dbGroups || []

  // Step 3: Match + Update
  let matched = 0
  let created = 0
  const results: { name: string; mid: string; action: string }[] = []

  for (const ug of groups) {
    // เช็คว่ามี MID นี้อยู่แล้วไหม
    const alreadyExists = existing.find(eg => eg.unofficial_group_id === ug.id)
    if (alreadyExists) {
      results.push({ name: ug.name, mid: ug.id, action: 'มีอยู่แล้ว' })
      continue
    }

    // Match ด้วยชื่อ
    const nameMatch = existing.find(eg =>
      eg.name && ug.name &&
      (eg.name.includes(ug.name) || ug.name.includes(eg.name)) &&
      !eg.unofficial_group_id
    )

    if (nameMatch) {
      await db.from('line_groups')
        .update({ unofficial_group_id: ug.id, updated_at: new Date().toISOString() })
        .eq('id', nameMatch.id)
      matched++
      results.push({ name: ug.name, mid: ug.id, action: `match "${nameMatch.name}"` })
    } else {
      // สร้างใหม่
      await db.from('line_groups').insert({
        name: ug.name || `กลุ่ม ${ug.id.slice(-6)}`,
        unofficial_group_id: ug.id,
        is_active: true,
      })
      created++
      results.push({ name: ug.name, mid: ug.id, action: 'สร้างใหม่' })
    }
  }

  return NextResponse.json({
    success: true,
    summary: `พบ ${groups.length} กลุ่ม — match: ${matched}, สร้างใหม่: ${created}`,
    groups: results,
  })
}
