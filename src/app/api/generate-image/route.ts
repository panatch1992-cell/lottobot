// LottoBot — Generate lottery result PNG image
// Uses next/og ImageResponse (Satori) — works on Vercel Edge Runtime, zero native deps
// Font: Fredoka (bubbly/rounded Google Font) for sticker-like numbers

import { ImageResponse } from 'next/og'
import { buildResultImageJSX, type ResultImageData } from '@/lib/generate-result-image'

export const runtime = 'edge'

// Load Fredoka Bold font for bubbly sticker-style numbers
async function loadBubbleFont() {
  const res = await fetch('https://fonts.gstatic.com/s/sniglet/v17/cIf9MaFLtkE3UjaJxCmrYGkHgIs.ttf')
  return res.arrayBuffer()
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

    const [jsx, fontData] = await Promise.all([
      Promise.resolve(buildResultImageJSX(body)),
      loadBubbleFont(),
    ])

    return new ImageResponse(jsx, {
      width: 800,
      height: 600,
      fonts: [{ name: 'Sniglet', data: fontData, weight: 800, style: 'normal' }],
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

  const [jsx, fontData] = await Promise.all([
    Promise.resolve(buildResultImageJSX(data)),
    loadBubbleFont(),
  ])

  return new ImageResponse(jsx, {
    width: 800,
    height: 600,
    fonts: [{ name: 'Sniglet', data: fontData, weight: 800, style: 'normal' }],
  })
}
