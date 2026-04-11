import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, getSettings } from '@/lib/supabase'
import { formatCountdown, formatStats, formatNextLottery, formatClosing } from '@/lib/formatter'
import { sendToTelegram } from '@/lib/telegram'
import { pushTextMessage, pushImageAndText, flagMonthlyLimitHit } from '@/lib/messaging-service'
import { nowBangkok, today, timeToMinutes, sleep } from '@/lib/utils'
import { validateCronConfig, alertConfigIssues } from '@/lib/config-guard'
import { getShuffledLuckyImageUrls } from '@/lib/huaypnk-scraper'
import type { Lottery, LineGroup, Result } from '@/types'

export const dynamic = 'force-dynamic'

// ─── Flow ข้อความก่อนหวยออก ─────────────────────────────
// 1. 📢 บอกรายการหวยต่อไป (30 นาทีก่อนปิด)
// 2. 📊 สถิติหวยนั้นๆ (29 นาทีก่อนปิด)
// 3. 🖼️ รูปสุ่มจากเว็บ (28 นาทีก่อนปิด)
// 4. ⏰ เตือน 20 นาที + ลิงก์แอดไลน์
// 5. ⏰ เตือน 10 นาที + ลิงก์แอดไลน์
// 6. ⏰ เตือน 5 นาที + ลิงก์แอดไลน์
// 7. 🔒 ปิดรับ (0 นาที)
// 8. 🎯 ผลหวย (handled by cron/scrape)

const FLOW_STEPS = [
  { type: 'next_lottery', minutesBefore: 30 },
  { type: 'stats', minutesBefore: 29 },
  { type: 'random_image', minutesBefore: 28 },
  { type: 'countdown', minutesBefore: 20 },
  { type: 'countdown', minutesBefore: 10 },
  { type: 'countdown', minutesBefore: 5 },
  { type: 'closing', minutesBefore: 0 },
]

// ─── Scrape random images from web ──────────────────────
// ใช้ huaypnk-scraper (shared cache + cheerio parser + label matching)
// แทน regex-based scraper เพื่อหลีกเลี่ยงการ fetch ซ้ำและผลลัพธ์ที่คลาดเคลื่อน
async function scrapeRandomImages(url: string, count: number): Promise<string[]> {
  try {
    return await getShuffledLuckyImageUrls(count, url)
  } catch (err) {
    console.error(`[countdown] scrapeRandomImages error: ${err instanceof Error ? err.message : err}`)
    return []
  }
}

// ─── Check if already sent ──────────────────────────────

async function alreadySent(
  db: ReturnType<typeof getServiceClient>,
  lotteryId: string,
  msgType: string,
  todayStr: string,
  tag: string,
  groupId?: string,
): Promise<boolean> {
  let query = db.from('send_logs')
    .select('id')
    .eq('lottery_id', lotteryId)
    .eq('msg_type', msgType)
    .eq('status', 'sent')
    .gte('created_at', todayStr)
    .like('error_message', `%${tag}%`)

  if (groupId) {
    query = query.eq('line_group_id', groupId)
  } else {
    query = query.eq('channel', 'telegram')
  }

  const { data } = await query
  return (data || []).length > 0
}

// ─── Log send ───────────────────────────────────────────

async function logSend(
  db: ReturnType<typeof getServiceClient>,
  lotteryId: string,
  channel: string,
  msgType: string,
  success: boolean,
  tag: string,
  error?: string,
  groupId?: string,
) {
  await db.from('send_logs').insert({
    lottery_id: lotteryId,
    line_group_id: groupId || null,
    channel,
    msg_type: msgType,
    status: success ? 'sent' : 'failed',
    sent_at: new Date().toISOString(),
    error_message: success ? tag : `${tag}: ${error}`,
  })
}

// ─── Send to all LINE groups ────────────────────────────

async function sendToLineGroups(
  db: ReturnType<typeof getServiceClient>,
  lottery: Lottery,
  groups: LineGroup[],
  text: string,
  msgType: string,
  tag: string,
  todayStr: string,
  imageUrl?: string,
) {
  const lineToken = 'unused' // backward compat
  let sentCount = 0

  for (const group of groups) {
    const unofficialId = (group as unknown as { unofficial_group_id?: string }).unofficial_group_id || ''
    const officialId = group.line_group_id || ''
    const primaryId = unofficialId || officialId
    if (!primaryId) continue

    // Skip if already sent to this group
    if (await alreadySent(db, lottery.id, msgType, todayStr, tag, group.id)) continue

    let result
    if (imageUrl) {
      result = await pushImageAndText(lineToken, primaryId, imageUrl, text, officialId)
    } else {
      result = await pushTextMessage(lineToken, primaryId, text, officialId)
    }

    if (!result.success && result.error?.includes('monthly limit')) {
      await flagMonthlyLimitHit()
    }

    await logSend(db, lottery.id, 'line', msgType, result.success, tag, result.error, group.id)
    if (result.success) sentCount++

    await sleep(500 + Math.floor(Math.random() * 1000))
  }

  return sentCount
}

// ─── Main handler ───────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  const testMode = req.nextUrl.searchParams.get('test') === '1'
  if (!testMode && secret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getServiceClient()
  const now = nowBangkok()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const todayStr = today()

  // ─── Config Guard ──────────────────────────────────────
  const configCheck = await validateCronConfig('countdown')
  if (!configCheck.ok) {
    await alertConfigIssues('countdown', configCheck.issues)
    return NextResponse.json({ error: 'Config issues', issues: configCheck.issues })
  }

  const settings = await getSettings()

  if (settings.send_countdown !== 'true') {
    return NextResponse.json({ sent: 0, skipped: 'countdown disabled' })
  }

  const addFriendLink = settings.line_add_friend_link || ''
  const randomImageUrl = settings.random_image_url || 'https://www.huaypnk.com/top'

  const { data: lotteries } = await db.from('lotteries').select('*').eq('status', 'active')
  const { data: groups } = await db.from('line_groups').select('*').eq('is_active', true)
  const activeGroups = (groups || []) as LineGroup[]

  const sent: string[] = []

  for (const lottery of (lotteries || []) as Lottery[]) {
    const closeTime = lottery.close_time || lottery.result_time
    if (!closeTime) continue
    const closeMinutes = timeToMinutes(closeTime)

    for (const step of FLOW_STEPS) {
      const triggerAt = closeMinutes - step.minutesBefore

      // ตรงเวลา? (ภายใน 1 นาที)
      if (nowMinutes < triggerAt || nowMinutes > triggerAt + 1) continue

      const tag = `${step.type}_${step.minutesBefore}min`
      const tgSent = await alreadySent(db, lottery.id, step.type, todayStr, tag)

      // ─── Step 1: 📢 บอกรายการหวยต่อไป ──────
      if (step.type === 'next_lottery') {
        const closeTimeStr = closeTime.slice(0, 5) // "HH:MM"
        const formatted = formatNextLottery(lottery, closeTimeStr)

        if (!tgSent && settings.telegram_bot_token && settings.telegram_admin_channel) {
          const r = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, formatted.tg)
          await logSend(db, lottery.id, 'telegram', step.type, r.success, tag, r.error)
        }

        await sendToLineGroups(db, lottery, activeGroups, formatted.line, step.type, tag, todayStr)
        sent.push(`${lottery.name} (📢 next)`)
      }

      // ─── Step 2: 📊 สถิติ ──────────────────
      if (step.type === 'stats') {
        const statsCount = Number(settings.stats_count) || 10
        const { data: results } = await db.from('results')
          .select('*')
          .eq('lottery_id', lottery.id)
          .order('draw_date', { ascending: false })
          .limit(statsCount)

        if (results && results.length > 0) {
          const formatted = formatStats(lottery, results as Result[])

          if (!tgSent && settings.telegram_bot_token && settings.telegram_admin_channel) {
            const r = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, formatted.tg)
            await logSend(db, lottery.id, 'telegram', step.type, r.success, tag, r.error)
          }

          await sendToLineGroups(db, lottery, activeGroups, formatted.line, step.type, tag, todayStr)
          sent.push(`${lottery.name} (📊 stats)`)
        }
      }

      // ─── Step 3: 🖼️ รูปสุ่มจากเว็บ ────────
      if (step.type === 'random_image') {
        const images = await scrapeRandomImages(randomImageUrl, activeGroups.length + 5)

        if (images.length > 0) {
          const lineToken = 'unused'
          let imgIdx = 0
          const baseUrl =
            process.env.NEXT_PUBLIC_SITE_URL ||
            (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://lottobot-chi.vercel.app')

          for (const group of activeGroups) {
            const unofficialId = (group as unknown as { unofficial_group_id?: string }).unofficial_group_id || ''
            const officialId = group.line_group_id || ''
            const primaryId = unofficialId || officialId
            if (!primaryId) continue

            if (await alreadySent(db, lottery.id, step.type, todayStr, tag, group.id)) continue

            // แต่ละกลุ่มรูปไม่ซ้ำ
            const imgUrl = images[imgIdx % images.length]
            imgIdx++

            // ใช้ proxy route เพื่อ relay รูปจาก huaypnk.com → ป้องกัน hotlink block
            const proxiedUrl = `${baseUrl}/api/lucky-image?url=${encodeURIComponent(imgUrl)}`

            // ใช้ custom_link ของกลุ่ม ถ้ามี ไม่งั้นใช้ URL หลัก
            const groupLink = group.custom_link || randomImageUrl
            const caption = `🎰 ${lottery.flag} ${lottery.name}\n🔗 ${groupLink}`

            const result = await pushImageAndText(lineToken, primaryId, proxiedUrl, caption, officialId)
            if (!result.success && result.error?.includes('monthly limit')) {
              await flagMonthlyLimitHit()
            }
            await logSend(db, lottery.id, 'line', step.type, result.success, tag, result.error, group.id)

            await sleep(500 + Math.floor(Math.random() * 1000))
          }

          sent.push(`${lottery.name} (🖼️ image)`)
        } else {
          // ไม่พบรูป → log 1 แถว เพื่อ observability (ไม่กระทบ flow อื่น)
          await logSend(db, lottery.id, 'line', step.type, false, tag, 'no_image_found')
        }
      }

      // ─── Steps 4-6: ⏰ Countdown ──────────
      if (step.type === 'countdown') {
        const formatted = formatCountdown(lottery, step.minutesBefore, addFriendLink)

        if (!tgSent && settings.telegram_bot_token && settings.telegram_admin_channel) {
          const r = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, formatted.tg)
          await logSend(db, lottery.id, 'telegram', step.type, r.success, tag, r.error)
        }

        await sendToLineGroups(db, lottery, activeGroups, formatted.line, step.type, tag, todayStr)
        sent.push(`${lottery.name} (⏰ ${step.minutesBefore}min)`)
      }

      // ─── Step 7: 🔒 ปิดรับ ────────────────
      if (step.type === 'closing') {
        const formatted = formatClosing(lottery)

        if (!tgSent && settings.telegram_bot_token && settings.telegram_admin_channel) {
          const r = await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, formatted.tg)
          await logSend(db, lottery.id, 'telegram', step.type, r.success, tag, r.error)
        }

        await sendToLineGroups(db, lottery, activeGroups, formatted.line, step.type, tag, todayStr)
        sent.push(`${lottery.name} (🔒 closed)`)
      }

      // Step 8: 🎯 ผลหวย — handled by cron/scrape
    }
  }

  return NextResponse.json({
    sent: sent.length,
    steps: sent,
    timestamp: new Date().toISOString(),
  })
}
