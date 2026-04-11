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

  // Step 2: ดึงกลุ่มจาก DB (เฉพาะ record ที่มี line_group_id — มาจาก OA webhook join)
  const { data: dbGroups } = await db.from('line_groups')
    .select('id, name, line_group_id, unofficial_group_id')
    .not('line_group_id', 'is', null)
  const existing = dbGroups || []

  // Step 3: Match ด้วย MID เท่านั้น (LOWER(line_group_id) === unofficial MID)
  // — ไม่ match ด้วยชื่อเด็ดขาด (เสี่ยงชื่อซ้ำ → แก้ผิดกลุ่ม)
  // — ไม่ insert record ใหม่ (รอ OA webhook join event เท่านั้น)
  let matched = 0
  let skipped = 0
  let unknown = 0
  const results: { name: string; mid: string; action: string }[] = []

  for (const ug of groups) {
    // หา DB record ที่ LOWER(line_group_id) ตรงกับ unofficial MID
    const match = existing.find(eg =>
      eg.line_group_id && eg.line_group_id.toLowerCase() === ug.id.toLowerCase()
    )

    if (!match) {
      unknown++
      results.push({ name: ug.name, mid: ug.id, action: 'ไม่พบใน DB (OA ยังไม่ join กลุ่มนี้)' })
      continue
    }

    // ถ้า unofficial_group_id ถูกอยู่แล้ว → skip
    if (match.unofficial_group_id === ug.id) {
      skipped++
      results.push({ name: ug.name, mid: ug.id, action: 'ตรงอยู่แล้ว' })
      continue
    }

    // Update unofficial_group_id ให้ตรง
    await db.from('line_groups')
      .update({ unofficial_group_id: ug.id, updated_at: new Date().toISOString() })
      .eq('id', match.id)
    matched++
    results.push({ name: ug.name, mid: ug.id, action: `sync → "${match.name}"` })
  }

  return NextResponse.json({
    success: true,
    summary: `พบ ${groups.length} กลุ่ม — sync: ${matched}, ตรงอยู่แล้ว: ${skipped}, ไม่รู้จัก: ${unknown}`,
    groups: results,
  })
}
