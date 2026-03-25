import { NextRequest, NextResponse } from 'next/server'
import { getLineOAuthUrl } from '@/lib/line-notify'

// GET /api/line/oauth?group_name=ชื่อกลุ่ม
// → Redirect ไปหน้า LINE Notify authorize
export async function GET(req: NextRequest) {
  const groupName = req.nextUrl.searchParams.get('group_name')
  if (!groupName) {
    return NextResponse.json({ error: 'group_name is required' }, { status: 400 })
  }

  try {
    // state = base64 ของชื่อกลุ่ม (ส่งกลับมาตอน callback)
    const state = Buffer.from(JSON.stringify({ name: groupName })).toString('base64url')
    const url = getLineOAuthUrl(state)
    return NextResponse.redirect(url)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'OAuth not configured' },
      { status: 500 }
    )
  }
}
