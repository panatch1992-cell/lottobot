/**
 * GET /api/lucky-image
 *
 * Proxy รูปเลขเด็ดจาก huaypnk.com/top เพื่อหลีกเลี่ยง hotlink protection
 * เมื่อ LINE server ดึงรูป จะผ่านมาที่นี่ก่อน แล้วส่งต่อจาก huaypnk.com
 *
 * Query params (เลือก 1 อย่าง):
 *   ?lottery_name=ลาวสตาร์   สุ่มรูปที่ match หวยนั้น (ถ้าไม่พบ → สุ่มทั้งหมด)
 *   ?url=https://...          proxy URL ที่ระบุตรงๆ (ใช้เมื่อ pre-picked แล้ว)
 *
 * Response:
 *   image/*  (proxied binary)     ถ้าสำเร็จ
 *   302 redirect                  ถ้า proxy ล้มเหลวแต่มี URL
 *   404 JSON                      ถ้าหาไม่เจอเลย
 */

import { NextRequest, NextResponse } from 'next/server'
import { scrapeLuckyImages } from '@/lib/huaypnk-scraper'
import axios from 'axios'

export const dynamic = 'force-dynamic'

const PROXY_TIMEOUT_MS = 10_000
const PROXY_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function proxyImage(targetUrl: string): Promise<NextResponse> {
  try {
    const { data, headers } = await axios.get<ArrayBuffer>(targetUrl, {
      responseType: 'arraybuffer',
      timeout: PROXY_TIMEOUT_MS,
      headers: {
        'User-Agent': PROXY_UA,
        'Referer': 'https://www.huaypnk.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
    })

    const contentType = (headers['content-type'] as string) || 'image/jpeg'

    return new NextResponse(data as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch {
    // proxy ล้มเหลว → redirect ตรงให้ client ไปเอาเอง
    return NextResponse.redirect(targetUrl, { status: 302 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const directUrl = searchParams.get('url')
  const lotteryName = searchParams.get('lottery_name') || undefined

  // ─── Mode 1: proxy URL ที่ระบุมาตรงๆ ─────────────────
  if (directUrl) {
    return proxyImage(directUrl)
  }

  // ─── Mode 2: ค้นหาจาก huaypnk.com แล้ว proxy ─────────
  const images = await scrapeLuckyImages(lotteryName)
  if (images.length === 0) {
    return NextResponse.json(
      { error: 'ไม่พบรูปภาพจาก huaypnk.com/top' },
      { status: 404 },
    )
  }

  const picked = images[Math.floor(Math.random() * images.length)]
  return proxyImage(picked.imageUrl)
}
