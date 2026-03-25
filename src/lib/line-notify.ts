// LINE Notify helper (fallback ถ้า n8n ล่ม)
// Rate limit: 1,000 msg/hour ต่อ token

const LINE_NOTIFY_API = 'https://notify-api.line.me/api/notify'

export async function sendLineNotify(
  token: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(LINE_NOTIFY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${token}`,
      },
      body: new URLSearchParams({ message }),
    })

    const data = await res.json()

    if (res.ok && data.status === 200) {
      return { success: true }
    }

    return { success: false, error: data.message || `HTTP ${res.status}` }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function testLineNotifyToken(
  token: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://notify-api.line.me/api/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    return { ok: data.status === 200, error: data.message }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
