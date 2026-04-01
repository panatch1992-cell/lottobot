// LottoBot — Generate lottery result PNG image
// Uses next/og ImageResponse (Satori) — works on Vercel Edge Runtime
// Fonts: Multiple bubble/rounded fonts from Google Fonts

import { ImageResponse } from 'next/og'
import { buildResultImageJSX, type ResultImageData } from '@/lib/generate-result-image'

export const runtime = 'edge'

// Font URLs from Google Fonts gstatic CDN
const FONT_URLS: Record<string, string> = {
  sniglet: 'https://fonts.gstatic.com/s/sniglet/v17/cIf9MaFLtkE3UjaJxCmrYGkHgIs.ttf',
  mali: 'https://fonts.gstatic.com/s/mali/v10/N0bV2SRONuN4QOLlKlRaJdbWgdY.ttf',
  itim: 'https://fonts.gstatic.com/s/itim/v14/0nknC9ziJOYewARKkc7ZdwU.ttf',
  mitr: 'https://fonts.gstatic.com/s/mitr/v11/pxiLypw5ucZF8fMZFJDUc1NECPY.ttf',
  fredoka: 'https://fonts.gstatic.com/s/fredoka/v14/X7nP4b87HvSqjb_WIi2yDCRwoQ_k7367_B-i2yQag0-mac3O8SL5U_tC.ttf',
  baloo2: 'https://fonts.gstatic.com/s/baloo2/v21/wXK0E3kTposypRyd51ncAFk.ttf',
  luckiestguy: 'https://fonts.gstatic.com/s/luckiestguy/v22/_gP_1RrxsjcxVvHOseld-RQBinCsBKEP.ttf',
  comfortaa: 'https://fonts.gstatic.com/s/comfortaa/v45/1Pt_g8LJRfWJmhDAuUsSQamb1W0lwk4S4WjNPrQVIT9c2c8.ttf',
  varelaround: 'https://fonts.gstatic.com/s/varelaround/v20/w8gdH283Tvk__Lua32TysjIYcaSKs860.ttf',
  quicksand: 'https://fonts.gstatic.com/s/quicksand/v31/6xK-dSZaM9iE8KbpRA_LJ3z8mH9BOJvgkP8o58m-wi40.ttf',
  kanit: 'https://fonts.gstatic.com/s/kanit/v15/nKKU-Go6G5tXcr4-ORWnVaFrNlJzIu4.ttf',
  prompt: 'https://fonts.gstatic.com/s/prompt/v10/-W_8XJnvUD7dzB2CA9oYRHciFg.ttf',
  bubblegum: 'https://fonts.gstatic.com/s/bubblegum sans/v20/AYCSpXb_Z9EORv1M5QTjEzMEteaAxIsp.ttf',
}

// Font display names for themes
const FONT_NAMES: Record<string, string> = {
  sniglet: 'Sniglet',
  mali: 'มะลิ (Mali)',
  itim: 'ไอติม (Itim)',
  mitr: 'มิตร (Mitr)',
  fredoka: 'Fredoka',
  baloo2: 'Baloo 2',
  luckiestguy: 'Luckiest Guy',
  comfortaa: 'Comfortaa',
  varelaround: 'Varela Round',
  quicksand: 'Quicksand',
  kanit: 'คณิต (Kanit)',
  prompt: 'Prompt',
}

async function loadFont(fontId: string): Promise<ArrayBuffer> {
  const url = FONT_URLS[fontId] || FONT_URLS.sniglet
  const res = await fetch(url)
  return res.arrayBuffer()
}

function getFontFamily(data: ResultImageData): string {
  // Theme-specific fonts
  if (data.theme === 'outline') return data.font_style || 'mali'
  if (data.theme === 'darkminimal') return data.font_style || 'mitr'
  if (data.theme === 'shopee') return data.font_style || 'sniglet'
  return data.font_style || 'sniglet'
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
