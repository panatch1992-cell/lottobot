// LottoBot — Generate lottery result PNG image
// Uses next/og ImageResponse (Satori) — works on Vercel Edge Runtime, zero native deps

import { ImageResponse } from 'next/og'
import { buildResultImageJSX, type ResultImageData } from '@/lib/generate-result-image'

export const runtime = 'edge'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ResultImageData

    // Validate required fields
    if (!body.lottery_name || !body.date) {
      return new Response(
        JSON.stringify({ error: 'lottery_name and date are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!body.top_number && !body.bottom_number && !body.full_number) {
      return new Response(
        JSON.stringify({ error: 'At least one of top_number, bottom_number, or full_number is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const jsx = buildResultImageJSX(body)

    return new ImageResponse(jsx, {
      width: 800,
      height: 600,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('generate-image error:', message)
    return new Response(
      JSON.stringify({ error: 'Failed to generate image', detail: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// GET for quick testing in browser
export async function GET(request: Request) {
  const url = new URL(request.url)
  const lottery_name = url.searchParams.get('lottery_name') || 'หวยลาว'
  const flag = url.searchParams.get('flag') || '🇱🇦'
  const date = url.searchParams.get('date') || '29 มี.ค. 69'
  const top_number = url.searchParams.get('top_number') || '034'
  const bottom_number = url.searchParams.get('bottom_number') || '45'
  const full_number = url.searchParams.get('full_number') || ''

  const data: ResultImageData = {
    lottery_name,
    flag,
    date,
    top_number: top_number || undefined,
    bottom_number: bottom_number || undefined,
    full_number: full_number || undefined,
  }

  const jsx = buildResultImageJSX(data)

  return new ImageResponse(jsx, {
    width: 800,
    height: 600,
  })
}
