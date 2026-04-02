// LottoBot — Generate lottery result PNG image
// Uses next/og ImageResponse (Satori) — works on Vercel Edge Runtime
// Fonts: Multiple bubble/rounded fonts from Google Fonts

import { ImageResponse } from 'next/og'
import { buildResultImageJSX, type ResultImageData } from '@/lib/generate-result-image'

export const runtime = 'edge'

// Font URLs from Google Fonts gstatic CDN
// Thai Playful + International Bubble/Rounded fonts
const FONT_URLS: Record<string, string> = {
  // === Thai Playful/Cute ===
  mali: 'https://fonts.gstatic.com/s/mali/v10/N0bV2SRONuN4QOLlKlRaJdbWgdY.ttf',
  itim: 'https://fonts.gstatic.com/s/itim/v14/0nknC9ziJOYewARKkc7ZdwU.ttf',
  mitr: 'https://fonts.gstatic.com/s/mitr/v11/pxiLypw5ucZF8fMZFJDUc1NECPY.ttf',
  kanit: 'https://fonts.gstatic.com/s/kanit/v15/nKKU-Go6G5tXcr4-ORWnVaFrNlJzIu4.ttf',
  prompt: 'https://fonts.gstatic.com/s/prompt/v10/-W_8XJnvUD7dzB2CA9oYRHciFg.ttf',
  sriracha: 'https://fonts.gstatic.com/s/sriracha/v14/0nkrC9D4IuYBgWcI9NbRQwCDnqp_.ttf',
  kodchasan: 'https://fonts.gstatic.com/s/kodchasan/v17/1cXxaUPOAJv9sG4I-DJWjXGAq8Sk1PoH.ttf',
  k2d: 'https://fonts.gstatic.com/s/k2d/v11/J7aRnpF2V0EjdZ1NtLYS6w.ttf',
  chonburi: 'https://fonts.gstatic.com/s/chonburi/v12/8AtqGs-wOpGRTBq66IWaFr3biAfZ.ttf',
  baijamjuree: 'https://fonts.gstatic.com/s/baijamjuree/v12/LDIqapSCOBt_aeQQ7ftydoaMWcjKm7sp8g.ttf',
  charm: 'https://fonts.gstatic.com/s/charm/v12/7cHmv4oii5K0MeYnC8s6vanB.ttf',
  charmonman: 'https://fonts.gstatic.com/s/charmonman/v18/MjQDmiR3vP_nuxDv47jiWJGovLdh6OE.ttf',
  // === International Bubble/Rounded ===
  sniglet: 'https://fonts.gstatic.com/s/sniglet/v17/cIf9MaFLtkE3UjaJxCmrYGkHgIs.ttf',
  fredoka: 'https://fonts.gstatic.com/s/fredoka/v14/X7nP4b87HvSqjb_WIi2yDCRwoQ_k7367_B-i2yQag0-mac3O8SL5U_tC.ttf',
  baloo2: 'https://fonts.gstatic.com/s/baloo2/v21/wXK0E3kTposypRyd51ncAFk.ttf',
  luckiestguy: 'https://fonts.gstatic.com/s/luckiestguy/v22/_gP_1RrxsjcxVvHOseld-RQBinCsBKEP.ttf',
  comfortaa: 'https://fonts.gstatic.com/s/comfortaa/v45/1Pt_g8LJRfWJmhDAuUsSQamb1W0lwk4S4WjNPrQVIT9c2c8.ttf',
  varelaround: 'https://fonts.gstatic.com/s/varelaround/v20/w8gdH283Tvk__Lua32TysjIYcaSKs860.ttf',
  quicksand: 'https://fonts.gstatic.com/s/quicksand/v31/6xK-dSZaM9iE8KbpRA_LJ3z8mH9BOJvgkP8o58m-wi40.ttf',
  nunito: 'https://fonts.gstatic.com/s/nunito/v26/XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTQ3j6zbXWjgevT5.ttf',
  poppins: 'https://fonts.gstatic.com/s/poppins/v21/pxiByp8kv8JHgFVrLDD4Z1xlFQ.ttf',
}


async function loadFont(fontId: string): Promise<ArrayBuffer> {
  // Check built-in fonts first
  const builtInUrl = FONT_URLS[fontId.toLowerCase()]
  if (builtInUrl) {
    const res = await fetch(builtInUrl)
    return res.arrayBuffer()
  }

  // Custom Google Font — try to load via CSS API then extract .ttf URL
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontId)}:wght@700&display=swap`
    const cssRes = await fetch(cssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    const cssText = await cssRes.text()
    const ttfMatch = cssText.match(/src:\s*url\(([^)]+\.ttf)\)/)
    if (ttfMatch) {
      const fontRes = await fetch(ttfMatch[1])
      return fontRes.arrayBuffer()
    }
  } catch {
    // fallback to sniglet
  }

  // Final fallback
  const fallback = await fetch(FONT_URLS.sniglet)
  return fallback.arrayBuffer()
}

function getFontFamily(data: ResultImageData): string {
  const font = data.font_style || ''
  // Custom font: "custom:FontName"
  if (font.startsWith('custom:')) return font.replace('custom:', '')
  // Theme-specific defaults
  if (!font || font === 'rounded' || font === 'sharp' || font === 'outline') {
    if (data.theme === 'outline') return 'mali'
    if (data.theme === 'darkminimal') return 'mitr'
    if (data.theme === 'shopee') return 'sniglet'
    return 'sniglet'
  }
  return font
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ResultImageData
    if (!body.lottery_name || !body.date) {
      return new Response(JSON.stringify({ error: 'lottery_name and date are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (!body.top_number && !body.bottom_number && !body.full_number) {
      return new Response(JSON.stringify({ error: 'At least one number is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const fontId = getFontFamily(body)
    const [jsx, fontData] = await Promise.all([
      Promise.resolve(buildResultImageJSX(body)),
      loadFont(fontId),
    ])
    const fontName = fontId.charAt(0).toUpperCase() + fontId.slice(1)

    return new ImageResponse(jsx, {
      width: 800,
      height: 600,
      fonts: [{ name: fontName, data: fontData, weight: 700, style: 'normal' }],
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('generate-image error:', message)
    return new Response(JSON.stringify({ error: 'Failed to generate image', detail: message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const data: ResultImageData = {
    lottery_name: url.searchParams.get('lottery_name') || 'หวยลาว',
    flag: url.searchParams.get('flag') || '🇱🇦',
    date: url.searchParams.get('date') || '29 มี.ค. 69',
    top_number: url.searchParams.get('top_number') || undefined,
    bottom_number: url.searchParams.get('bottom_number') || undefined,
    full_number: url.searchParams.get('full_number') || undefined,
    theme: url.searchParams.get('theme') || undefined,
    font_style: url.searchParams.get('font_style') || undefined,
    digit_size: url.searchParams.get('digit_size') || undefined,
    layout: url.searchParams.get('layout') || undefined,
  }

  const fontId = getFontFamily(data)
  const [jsx, fontData] = await Promise.all([
    Promise.resolve(buildResultImageJSX(data)),
    loadFont(fontId),
  ])
  const fontName = fontId.charAt(0).toUpperCase() + fontId.slice(1)

  return new ImageResponse(jsx, {
    width: 800,
    height: 600,
    fonts: [{ name: fontName, data: fontData, weight: 700, style: 'normal' }],
  })
}
