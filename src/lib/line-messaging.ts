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

// สร้าง Flex Message สำหรับผลหวย แล้วส่งไปกลุ่ม
export async function pushFlexResult(
  channelAccessToken: string,
  to: string,
  params: {
    name: string
    flag: string
    date: string
    top_number?: string
    bottom_number?: string
    full_number?: string
    theme?: string
  }
): Promise<{ success: boolean; error?: string }> {
  const { name, flag, date, top_number, bottom_number, full_number, theme } = params

  // Pastel colors matching LINE Emoji sticker style
  const digitColors = [
    { bg: '#FFD1DC', text: '#D4526E', border: '#F8A5B8' },  // pink
    { bg: '#B8E0FF', text: '#4A90C4', border: '#8CC8F0' },  // blue
    { bg: '#C1F0C1', text: '#4CAF50', border: '#8ED88E' },  // green
    { bg: '#FFE5B4', text: '#CC8400', border: '#FFD080' },  // orange
    { bg: '#E0C8FF', text: '#8B5DBF', border: '#C89EFF' },  // purple
    { bg: '#FFFACD', text: '#B8960C', border: '#FFE44D' },  // yellow
    { bg: '#FFB8C6', text: '#C0475D', border: '#FF8CA3' },  // rose
    { bg: '#B8F0E8', text: '#2D8B7B', border: '#80DCC8' },  // teal
  ]

  const themes: Record<string, { bg: string; accent: string; digitBg: string; digitText: string; title: string; sub: string }> = {
    macaroon: { bg: '#FFFFFF', accent: '#FFD1DC', digitBg: '', digitText: '', title: '#4a4a4a', sub: '#999999' },
    candy: { bg: '#FFF5F5', accent: '#FF6B8A', digitBg: '#FF6B8A', digitText: '#FFFFFF', title: '#E53E3E', sub: '#FC8181' },
    ocean: { bg: '#EBF8FF', accent: '#3182CE', digitBg: '#3182CE', digitText: '#FFFFFF', title: '#2B6CB0', sub: '#63B3ED' },
    gold: { bg: '#FFFBEB', accent: '#F59E0B', digitBg: '#F59E0B', digitText: '#FFFFFF', title: '#92400E', sub: '#D97706' },
    dark: { bg: '#1A202C', accent: '#E53E3E', digitBg: '#E53E3E', digitText: '#FFFFFF', title: '#F7FAFC', sub: '#A0AEC0' },
  }
  const t = themes[theme || 'macaroon'] || themes.macaroon

  function makeDigits(num: string, startIdx: number) {
    return num.split('').map((d, i) => {
      const c = digitColors[(startIdx + i) % digitColors.length]
      return {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'text', text: d, size: '3xl', weight: 'bold', align: 'center', color: c.text,
        }],
        width: '56px', height: '56px', cornerRadius: '28px',
        backgroundColor: c.bg,
        borderWidth: '2px', borderColor: c.border,
        justifyContent: 'center', alignItems: 'center', margin: 'md',
      }
    })
  }

  const bodyContents: Record<string, unknown>[] = [
    { type: 'text', text: `${flag} ${name} ${flag}`, weight: 'bold', size: 'md', align: 'center', color: t.title },
    { type: 'text', text: `งวดวันที่ ${date}`, size: 'xs', align: 'center', color: t.sub, margin: 'sm' },
    { type: 'separator', margin: 'lg', color: (t.accent || '#eee') + '40' },
  ]

  if (top_number) {
    bodyContents.push(
      { type: 'text', text: '⬆️ เลขบน', size: 'xs', color: t.sub, align: 'center', margin: 'lg' },
      { type: 'box', layout: 'horizontal', contents: makeDigits(top_number, 0), justifyContent: 'center', margin: 'sm' },
    )
  }
  if (bottom_number) {
    bodyContents.push(
      { type: 'text', text: '⬇️ เลขล่าง', size: 'xs', color: t.sub, align: 'center', margin: 'lg' },
      { type: 'box', layout: 'horizontal', contents: makeDigits(bottom_number, 3), justifyContent: 'center', margin: 'sm' },
    )
  }
  if (full_number) {
    bodyContents.push(
      { type: 'text', text: '🔢 เลขเต็ม', size: 'xs', color: t.sub, align: 'center', margin: 'lg' },
      { type: 'box', layout: 'horizontal', contents: makeDigits(full_number, 0), justifyContent: 'center', margin: 'sm' },
    )
  }
  bodyContents.push({ type: 'text', text: 'LottoBot', size: 'xxs', align: 'center', color: t.sub + '80', margin: 'xl' })

  const flexMsg = {
    type: 'flex',
    altText: `${flag} ${name} — ${top_number ? 'บน: ' + top_number : ''} ${bottom_number ? 'ล่าง: ' + bottom_number : ''}`.trim(),
    contents: {
      type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', contents: bodyContents, backgroundColor: t.bg, paddingAll: '20px' },
    },
  }

  try {
    const res = await fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${channelAccessToken}` },
      body: JSON.stringify({ to, messages: [flexMsg] }),
    })
    if (res.ok) return { success: true }
    const data = await res.json().catch(() => ({}))
    return { success: false, error: data.message || `HTTP ${res.status}` }
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
