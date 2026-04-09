/**
 * line-reply.ts — LINE Reply API (ฟรี 100% ไม่จำกัด!)
 *
 * ใช้ Reply API ตอบกลับข้อความใน webhook — ไม่เสีย quota
 * Flow: trigger "." ส่งเข้ากลุ่ม → OA webhook รับ → reply ด้วยผลหวย
 */

const LINE_API = 'https://api.line.me/v2/bot/message/reply'

export type LineMessage = {
  type: 'text'
  text: string
} | {
  type: 'image'
  originalContentUrl: string
  previewImageUrl: string
}

export type ReplyResult = {
  success: boolean
  error?: string
}

/**
 * ส่ง Reply กลับ LINE — ฟรี 100%!
 * replyToken มีอายุ ~30 วินาที ต้องตอบเร็ว
 * ส่งได้สูงสุด 5 messages ต่อ 1 reply
 */
export async function replyMessage(
  channelAccessToken: string,
  replyToken: string,
  messages: LineMessage[],
): Promise<ReplyResult> {
  if (!channelAccessToken) {
    return { success: false, error: 'No channel access token' }
  }
  if (!replyToken) {
    return { success: false, error: 'No reply token' }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(LINE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: messages.slice(0, 5), // LINE limit 5 messages per reply
      }),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { success: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }

    return { success: true }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'Timeout (10s)' }
    }
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
