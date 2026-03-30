import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import type { LineGroup } from '@/types'

const LINE_API = 'https://api.line.me/v2/bot'

// สร้าง Flex Message สำหรับผลหวย
function buildLotteryFlexMessage(params: {
  name: string
  flag: string
  date: string
  top_number: string
  bottom_number: string
  theme?: string
}) {
  const { name, flag, date, top_number, bottom_number, theme } = params

  // Theme colors
  const themes: Record<string, { bg: string; accent: string; digitBg: string; digitText: string; titleColor: string; dateColor: string }> = {
    macaroon: { bg: '#FFFFFF', accent: '#FFD1DC', digitBg: '#FFD1DC', digitText: '#D4526E', titleColor: '#4a4a4a', dateColor: '#999999' },
    candy: { bg: '#FFF5F5', accent: '#FF6B8A', digitBg: '#FF6B8A', digitText: '#FFFFFF', titleColor: '#E53E3E', dateColor: '#FC8181' },
    ocean: { bg: '#EBF8FF', accent: '#3182CE', digitBg: '#3182CE', digitText: '#FFFFFF', titleColor: '#2B6CB0', dateColor: '#63B3ED' },
    gold: { bg: '#FFFBEB', accent: '#F59E0B', digitBg: '#F59E0B', digitText: '#FFFFFF', titleColor: '#92400E', dateColor: '#D97706' },
    dark: { bg: '#1A202C', accent: '#E53E3E', digitBg: '#E53E3E', digitText: '#FFFFFF', titleColor: '#F7FAFC', dateColor: '#A0AEC0' },
  }

  const t = themes[theme || 'macaroon'] || themes.macaroon

  // Pastel colors matching LINE Emoji sticker style
  const digitColors = [
    { bg: '#FFD1DC', text: '#D4526E', border: '#F8A5B8' },
    { bg: '#B8E0FF', text: '#4A90C4', border: '#8CC8F0' },
    { bg: '#C1F0C1', text: '#4CAF50', border: '#8ED88E' },
    { bg: '#FFE5B4', text: '#CC8400', border: '#FFD080' },
    { bg: '#E0C8FF', text: '#8B5DBF', border: '#C89EFF' },
    { bg: '#FFFACD', text: '#B8960C', border: '#FFE44D' },
    { bg: '#FFB8C6', text: '#C0475D', border: '#FF8CA3' },
    { bg: '#B8F0E8', text: '#2D8B7B', border: '#80DCC8' },
  ]

  // Build digit bubbles for top number
  const topDigits = top_number.split('').map((d, i) => {
    const c = theme === 'macaroon' ? digitColors[i % digitColors.length] : { bg: t.digitBg, text: t.digitText, border: t.digitBg }
    return {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'text',
        text: d,
        size: '3xl',
        weight: 'bold',
        align: 'center',
        color: c.text,
      }],
      width: '56px',
      height: '56px',
      cornerRadius: '28px',
      backgroundColor: c.bg,
      borderWidth: '2px',
      borderColor: c.border,
      justifyContent: 'center',
      alignItems: 'center',
      margin: 'md',
    }
  })

  // Build digit bubbles for bottom number
  const bottomDigits = bottom_number.split('').map((d, i) => {
    const idx = i + 3
    const c = theme === 'macaroon' ? digitColors[idx % digitColors.length] : { bg: t.digitBg, text: t.digitText, border: t.digitBg }
    return {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'text',
        text: d,
        size: '3xl',
        weight: 'bold',
        align: 'center',
        color: c.text,
      }],
      width: '56px',
      height: '56px',
      cornerRadius: '28px',
      backgroundColor: c.bg,
      borderWidth: '2px',
      borderColor: c.border,
      justifyContent: 'center',
      alignItems: 'center',
      margin: 'md',
    }
  })

  return {
    type: 'flex',
    altText: `${flag} ${name} — บน: ${top_number} ล่าง: ${bottom_number}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          // Title
          {
            type: 'text',
            text: `${flag} ${name} ${flag}`,
            weight: 'bold',
            size: 'md',
            align: 'center',
            color: t.titleColor,
          },
          // Date
          {
            type: 'text',
            text: `งวดวันที่ ${date}`,
            size: 'xs',
            align: 'center',
            color: t.dateColor,
            margin: 'sm',
          },
          // Separator
          { type: 'separator', margin: 'lg', color: t.accent + '40' },
          // Top label
          {
            type: 'text',
            text: '⬆️ เลขบน',
            size: 'xs',
            color: t.dateColor,
            align: 'center',
            margin: 'lg',
          },
          // Top digits
          {
            type: 'box',
            layout: 'horizontal',
            contents: topDigits,
            justifyContent: 'center',
            margin: 'sm',
          },
          // Bottom label
          {
            type: 'text',
            text: '⬇️ เลขล่าง',
            size: 'xs',
            color: t.dateColor,
            align: 'center',
            margin: 'lg',
          },
          // Bottom digits
          {
            type: 'box',
            layout: 'horizontal',
            contents: bottomDigits,
            justifyContent: 'center',
            margin: 'sm',
          },
          // Footer
          {
            type: 'text',
            text: 'LottoBot',
            size: 'xxs',
            align: 'center',
            color: t.dateColor + '80',
            margin: 'xl',
          },
        ],
        backgroundColor: t.bg,
        paddingAll: '20px',
      },
    },
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient()
    const body = await req.json()

    const { data: settingsData } = await db.from('bot_settings').select('key, value')
    const settings: Record<string, string> = {}
    ;(settingsData || []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value })

    const lineToken = settings.line_channel_access_token
    if (!lineToken) {
      return NextResponse.json({ error: 'ไม่มี LINE Channel Access Token' }, { status: 400 })
    }

    // Get active LINE groups
    const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
    if (!groups || groups.length === 0) {
      return NextResponse.json({ error: 'ไม่มีกลุ่ม LINE ที่ active' }, { status: 400 })
    }

    const flexMsg = buildLotteryFlexMessage({
      name: body.name || 'ลาว TV',
      flag: body.flag || '🇱🇦',
      date: body.date || new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }),
      top_number: body.top_number || '167',
      bottom_number: body.bottom_number || '69',
      theme: body.theme || settings.default_theme || 'macaroon',
    })

    const results = []
    for (const group of groups as LineGroup[]) {
      if (!group.line_group_id) continue
      const res = await fetch(`${LINE_API}/message/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${lineToken}`,
        },
        body: JSON.stringify({
          to: group.line_group_id,
          messages: [flexMsg],
        }),
      })
      const ok = res.ok
      const err = ok ? null : await res.json().catch(() => ({}))
      results.push({ group: group.name, success: ok, error: err?.message })
    }

    return NextResponse.json({ success: true, results, flex_json: flexMsg })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
