import { NextRequest, NextResponse } from 'next/server'
import { exchangeLineOAuthCode, testLineNotifyToken } from '@/lib/line-notify'
import { getServiceClient } from '@/lib/supabase'

// GET /api/line/callback?code=xxx&state=xxx
// LINE Notify redirect กลับมาหลัง user กดอนุญาต
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/settings?line_error=missing_params`)
  }

  // Decode state → ชื่อกลุ่ม
  let groupName = 'กลุ่ม LINE'
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
    groupName = decoded.name || groupName
  } catch {
    // ใช้ชื่อ default
  }

  // Exchange code → access_token
  const result = await exchangeLineOAuthCode(code)
  if ('error' in result) {
    return NextResponse.redirect(
      `${baseUrl}/settings?line_error=${encodeURIComponent(result.error)}`
    )
  }

  // Verify token works
  const test = await testLineNotifyToken(result.access_token)
  if (!test.ok) {
    return NextResponse.redirect(
      `${baseUrl}/settings?line_error=${encodeURIComponent('Token ไม่สามารถใช้งานได้')}`
    )
  }

  // Save to DB
  const db = getServiceClient()
  const { error: dbError } = await db.from('line_groups').insert({
    name: groupName,
    line_notify_token: result.access_token,
    is_active: true,
  })

  if (dbError) {
    return NextResponse.redirect(
      `${baseUrl}/settings?line_error=${encodeURIComponent(dbError.message)}`
    )
  }

  return NextResponse.redirect(`${baseUrl}/settings?line_success=${encodeURIComponent(groupName)}`)
}
