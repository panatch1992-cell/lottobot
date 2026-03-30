// จัดรูปแบบข้อความ (TG HTML + LINE plain text)
import type { Lottery, Result } from '@/types'

function spaced(num: string): string {
  return num.split('').join(' ')  // "034" → "0 3 4"
}

// แปลงตัวเลขเป็น emoji keycap: "167" → "1️⃣ 6️⃣ 7️⃣"
const KEYCAP: Record<string, string> = {
  '0': '0️⃣', '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣',
  '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣',
}

function emojiNum(num: string): string {
  return num.split('').map(d => KEYCAP[d] || d).join(' ')
}

function getSourceLabel(sourceUrl: string | null): string {
  if (!sourceUrl) return '🤖 auto'
  if (sourceUrl === 'manual') return '👤 กรอกมือ'
  if (sourceUrl.startsWith('stock://')) {
    const symbol = sourceUrl.replace('stock://', '')
    return `📈 ${symbol}`
  }
  if (sourceUrl.startsWith('browser://')) {
    try {
      return `🌐 ${new URL(sourceUrl.replace('browser://', '')).hostname}`
    } catch {
      return '🌐 browser'
    }
  }
  try {
    return `🤖 ${new URL(sourceUrl).hostname}`
  } catch {
    return `🤖 ${sourceUrl}`
  }
}

export function formatThaiDate(dateStr: string): string {
  const d = new Date(dateStr)
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
  const thaiYear = (d.getFullYear() + 543) % 100
  return `${d.getDate()} ${months[d.getMonth()]} ${thaiYear}`
}

export function formatResult(lottery: Lottery, result: Result) {
  const dateStr = formatThaiDate(result.draw_date)

  const sourceLabel = getSourceLabel(result.source_url)

  // Telegram (HTML)
  const tgLines = [
    `${lottery.flag} <b>${lottery.name}</b>`,
    `งวด ${dateStr} · ${sourceLabel}`,
  ]
  if (result.top_number) tgLines.push(`⬆️ บน : <code>${spaced(result.top_number)}</code>`)
  if (result.bottom_number) tgLines.push(`⬇️ ล่าง : <code>${spaced(result.bottom_number)}</code>`)
  if (result.full_number) tgLines.push(`🔢 เต็ม : <code>${spaced(result.full_number)}</code>`)

  // LINE Notify (plain text)
  const lineLines = [
    `\n${lottery.flag}${lottery.flag} ${lottery.name} ${lottery.flag}${lottery.flag}`,
    `งวดวันที่ ${dateStr}`,
  ]
  if (result.top_number) lineLines.push(`⬆️ บน : ${emojiNum(result.top_number)}`)
  if (result.bottom_number) lineLines.push(`⬇️ ล่าง : ${emojiNum(result.bottom_number)}`)
  if (result.full_number) lineLines.push(`🔢 เต็ม : ${emojiNum(result.full_number)}`)

  return { tg: tgLines.join('\n'), line: lineLines.join('\n') }
}

export function formatCountdown(lottery: Lottery, minutes: number) {
  const tg = [
    `${lottery.flag} <b>${lottery.name}</b>`,
    `⏰ <b>${minutes} นาทีสุดท้าย</b> ❗❗`,
    `ส่งโพย ➕ สลิปโอน`,
    `🏠 ส่งหลังบ้านได้เลยนะครับ`,
  ].join('\n')

  const line = [
    `\n${lottery.flag}${lottery.flag} ${lottery.name} ${lottery.flag}${lottery.flag}`,
    `⏰ ${minutes} นาทีสุดท้าย ❗❗`,
    `ส่งโพย ➕ สลิปโอน`,
    `🏠 ส่งหลังบ้านได้เลยนะครับ`,
  ].join('\n')

  return { tg, line }
}

export function formatStats(lottery: Lottery, results: Result[]) {
  const header = `${lottery.flag} สถิติหวย${lottery.name} ${lottery.flag}`
  const lines = results.map(r => {
    const d = formatThaiDate(r.draw_date)
    const num = [r.top_number, r.bottom_number].filter(Boolean).join('-')
    return `${d} ${lottery.flag} ${num}`
  })

  const tg = [`<b>${header}</b>`, ...lines].join('\n')
  const line = [`\n${header}`, ...lines].join('\n')

  return { tg, line }
}

export function formatTgAdminLog(
  lottery: Lottery,
  result: Result,
  lineGroupCount: number,
  durationMs: number
) {
  const dateStr = formatThaiDate(result.draw_date)
  const adminSourceLabel = getSourceLabel(result.source_url)

  const lines = [
    `${lottery.flag} <b>${lottery.name}</b>`,
    `งวด ${dateStr} · ${adminSourceLabel}`,
  ]
  if (result.top_number) lines.push(`⬆️ บน : <code>${spaced(result.top_number)}</code>`)
  if (result.bottom_number) lines.push(`⬇️ ล่าง : <code>${spaced(result.bottom_number)}</code>`)
  if (result.full_number) lines.push(`🔢 เต็ม : <code>${spaced(result.full_number)}</code>`)
  lines.push('──────')
  lines.push(`✓ ส่ง LINE แล้ว ${lineGroupCount} กลุ่ม (${(durationMs / 1000).toFixed(1)} วิ)`)

  return lines.join('\n')
}
