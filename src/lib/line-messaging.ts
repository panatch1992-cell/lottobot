// LINE Messaging API helper
// Docs: https://developers.line.biz/en/reference/messaging-api/

const LINE_API = 'https://api.line.me/v2/bot'

export async function pushTextMessage(
  channelAccessToken: string,
  to: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        to,
        messages: [{ type: 'text', text }],
      }),
    })

    if (res.ok) {
      return { success: true }
    }

    const data = await res.json().catch(() => ({}))
    return {
      success: false,
      error: data.message || `HTTP ${res.status}`,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// Send text + image together (image first, then text caption)
export async function pushImageAndText(
  channelAccessToken: string,
  to: string,
  imageUrl: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        to,
        messages: [
          {
            type: 'image',
            originalContentUrl: imageUrl,
            previewImageUrl: imageUrl,
          },
          { type: 'text', text },
        ],
      }),
    })

    if (res.ok) {
      return { success: true }
    }

    const data = await res.json().catch(() => ({}))
    return {
      success: false,
      error: data.message || `HTTP ${res.status}`,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getGroupSummary(
  channelAccessToken: string,
  groupId: string
): Promise<{ name?: string; memberCount?: number; error?: string }> {
  try {
    const res = await fetch(`${LINE_API}/group/${groupId}/summary`, {
      headers: { Authorization: `Bearer ${channelAccessToken}` },
    })
    if (!res.ok) {
      return { error: `HTTP ${res.status}` }
    }
    const data = await res.json()
    return { name: data.groupName, memberCount: data.memberCount }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function verifyChannelToken(
  channelAccessToken: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.line.me/v2/oauth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: channelAccessToken }),
    })
    const data = await res.json()
    if (res.ok && data.client_id) {
      return { valid: true }
    }
    return { valid: false, error: data.error_description || `HTTP ${res.status}` }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
