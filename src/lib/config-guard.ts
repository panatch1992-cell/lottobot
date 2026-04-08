/**
 * config-guard.ts — Required-field validation for cron jobs
 *
 * ทุก cron ต้องเรียก assertConfig() ก่อนทำงาน
 * ถ้า config ขาด → fail ทันที + แจ้ง Telegram
 */

import { sendToTelegram } from '@/lib/telegram'
import { getSettings } from '@/lib/supabase'

export interface ConfigIssue {
  field: string
  severity: 'error' | 'warn'
  message: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function validateCronConfig(cronName: string): Promise<{ ok: boolean; issues: ConfigIssue[] }> {
  const settings = await getSettings()
  const issues: ConfigIssue[] = []

  // ─── Required for all crons ────────────────────────
  if (!settings.unofficial_line_endpoint && !process.env.UNOFFICIAL_LINE_ENDPOINT) {
    issues.push({ field: 'unofficial_line_endpoint', severity: 'error', message: 'Unofficial endpoint URL ไม่ได้ตั้งค่า' })
  }

  // ─── Telegram (for admin logging) ──────────────────
  if (!settings.telegram_bot_token) {
    issues.push({ field: 'telegram_bot_token', severity: 'warn', message: 'Telegram Bot Token ไม่ได้ตั้งค่า (admin log จะไม่ทำงาน)' })
  }
  if (!settings.telegram_admin_channel) {
    issues.push({ field: 'telegram_admin_channel', severity: 'warn', message: 'Telegram Admin Channel ไม่ได้ตั้งค่า' })
  }

  return {
    ok: !issues.some(i => i.severity === 'error'),
    issues,
  }
}

/**
 * ตรวจสอบว่ากลุ่ม LINE มี unofficial_group_id หรือไม่
 * ถ้าไม่มีแม้แต่กลุ่มเดียว → แจ้งเตือน
 */
export async function validateLineGroups(
  groups: { id: string; name: string; line_group_id: string | null; unofficial_group_id?: string | null }[],
): Promise<ConfigIssue[]> {
  const issues: ConfigIssue[] = []

  if (groups.length === 0) {
    issues.push({ field: 'line_groups', severity: 'warn', message: 'ไม่มีกลุ่ม LINE ที่ active' })
    return issues
  }

  const noId = groups.filter(g => !g.unofficial_group_id && !g.line_group_id)
  const noUnofficial = groups.filter(g => !g.unofficial_group_id && g.line_group_id)

  if (noId.length > 0) {
    issues.push({
      field: 'unofficial_group_id',
      severity: 'error',
      message: `${noId.length} กลุ่มไม่มี ID เลย: ${noId.map(g => g.name).join(', ')}`,
    })
  }

  if (noUnofficial.length > 0) {
    issues.push({
      field: 'unofficial_group_id',
      severity: 'warn',
      message: `${noUnofficial.length} กลุ่มมีแค่ official ID (จะใช้ fallback): ${noUnofficial.map(g => g.name).join(', ')}`,
    })
  }

  return issues
}

/**
 * แจ้งเตือน config ผิดพลาดผ่าน Telegram (ส่งครั้งเดียวต่อวัน)
 */
const alertedToday = new Set<string>()

export async function alertConfigIssues(cronName: string, issues: ConfigIssue[]) {
  const errors = issues.filter(i => i.severity === 'error')
  if (errors.length === 0) return

  const key = `${cronName}_${new Date().toISOString().slice(0, 10)}`
  if (alertedToday.has(key)) return
  alertedToday.add(key)

  const settings = await getSettings()
  if (!settings.telegram_bot_token || !settings.telegram_admin_channel) return

  const msg = [
    `🚨 <b>Config Error: ${cronName}</b>`,
    '',
    ...errors.map(e => `❌ <code>${e.field}</code>: ${e.message}`),
    '',
    '→ แก้ไขที่หน้า /settings',
  ].join('\n')

  await sendToTelegram(settings.telegram_bot_token, settings.telegram_admin_channel, msg)
}
