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

// ─── LINE Notify OAuth ───

const LINE_OAUTH_AUTHORIZE = 'https://notify-bot.line.me/oauth/authorize'
const LINE_OAUTH_TOKEN = 'https://notify-bot.line.me/oauth/token'

export function getLineOAuthUrl(state: string): string {
  const clientId = process.env.LINE_NOTIFY_CLIENT_ID
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
  if (!clientId || !baseUrl) {
    throw new Error('LINE_NOTIFY_CLIENT_ID and NEXT_PUBLIC_BASE_URL are required')
  }
  const redirectUri = `${baseUrl}/api/line/callback`
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'notify',
    state,
  })
  return `${LINE_OAUTH_AUTHORIZE}?${params}`
}

export async function exchangeLineOAuthCode(
  code: string
): Promise<{ access_token: string } | { error: string }> {
  const clientId = process.env.LINE_NOTIFY_CLIENT_ID
  const clientSecret = process.env.LINE_NOTIFY_CLIENT_SECRET
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
  if (!clientId || !clientSecret || !baseUrl) {
    return { error: 'LINE OAuth env vars not configured' }
  }
  const redirectUri = `${baseUrl}/api/line/callback`
  try {
    const res = await fetch(LINE_OAUTH_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    const data = await res.json()
    if (res.ok && data.access_token) {
      return { access_token: data.access_token }
    }
    return { error: data.message || `HTTP ${res.status}` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
