// Telegram Bot API helper
// ใช้ HTML parse mode (ไม่ใช่ Markdown)

interface TelegramResponse {
  ok: boolean
  result?: unknown
  description?: string
}

export async function sendToTelegram(
  botToken: string,
  chatId: string,
  html: string
): Promise<{ success: boolean; error?: string }> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
      }),
    })

    const data: TelegramResponse = await res.json()

    if (!data.ok) {
      return { success: false, error: data.description || 'Telegram API error' }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function testTelegramBot(botToken: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
    const data = await res.json()
    if (data.ok) {
      return { ok: true, username: data.result.username }
    }
    return { ok: false, error: data.description }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
