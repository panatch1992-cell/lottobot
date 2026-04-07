const express = require('express')

const app = express()

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.json({ limit: '1mb' }))

const PORT = process.env.PORT || 8080
const AUTH_TOKEN = process.env.UNOFFICIAL_AUTH_TOKEN || ''
let LINE_AUTH_TOKEN = process.env.LINE_AUTH_TOKEN || ''
const LINE_CHANNEL_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || ''

const LINE_THRIFT_API = 'https://gd2.line.naver.jp'
const LINE_OFFICIAL_API = 'https://api.line.me/v2/bot'

const LINE_APP_HEADER = {
  'User-Agent': 'Line/13.4.2',
  'X-Line-Application': 'DESKTOPWIN\t13.4.2\tWindows\t10.0',
  'X-Line-Carrier': 'wifi',
}

// ─── Auto Token Refresh ──────────────────────────────────
// JWT token มี exp ~7 วัน แต่ rexp ~1 ปี
// ระบบจะ refresh อัตโนมัติก่อนหมดอายุ 1 วัน

function decodeJwtPayload(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = Buffer.from(parts[1], 'base64').toString('utf-8')
    return JSON.parse(payload)
  } catch { return null }
}

function getTokenExpiry() {
  if (!LINE_AUTH_TOKEN) return { expired: true, expiresIn: 0 }
  const payload = decodeJwtPayload(LINE_AUTH_TOKEN)
  if (!payload || !payload.exp) return { expired: false, expiresIn: Infinity }
  const now = Math.floor(Date.now() / 1000)
  return {
    expired: now >= payload.exp,
    expiresIn: payload.exp - now,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    refreshExpiry: payload.rexp ? new Date(payload.rexp * 1000).toISOString() : null,
  }
}

async function refreshTokenIfNeeded() {
  const { expired, expiresIn } = getTokenExpiry()
  const ONE_DAY = 86400

  // Refresh if expired or expiring within 1 day
  if (!expired && expiresIn > ONE_DAY) return { refreshed: false, reason: `token valid for ${Math.floor(expiresIn / 3600)}h` }

  if (!LINE_AUTH_TOKEN) return { refreshed: false, reason: 'no token' }

  console.log(`[refresh] Token ${expired ? 'EXPIRED' : `expiring in ${Math.floor(expiresIn / 3600)}h`} — refreshing...`)

  try {
    // LINE token refresh: call issueV3TokenForPrimary with current token
    const refreshRes = await fetch(LINE_THRIFT_API + '/RS4', {
      method: 'POST',
      headers: {
        ...LINE_APP_HEADER,
        'X-Line-Access': LINE_AUTH_TOKEN,
        'Content-Type': 'application/x-thrift',
        'Accept': 'application/x-thrift',
      },
      body: buildRefreshTokenThrift(),
    })

    if (refreshRes.ok) {
      const body = await refreshRes.text()
      // Try to extract new token from response
      const tokenMatch = body.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
      if (tokenMatch) {
        LINE_AUTH_TOKEN = tokenMatch[0]
        console.log('[refresh] ✅ Token refreshed successfully!')
        return { refreshed: true, newExpiry: getTokenExpiry().expiresAt }
      }
    }

    // Alternative: try v4 auth refresh endpoint
    const refreshRes2 = await fetch(LINE_THRIFT_API + '/api/v4/auth/refreshToken', {
      method: 'POST',
      headers: {
        ...LINE_APP_HEADER,
        'X-Line-Access': LINE_AUTH_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: LINE_AUTH_TOKEN }),
    })

    if (refreshRes2.ok) {
      const data = await refreshRes2.json().catch(() => null)
      if (data?.accessToken || data?.authToken || data?.token) {
        LINE_AUTH_TOKEN = data.accessToken || data.authToken || data.token
        console.log('[refresh] ✅ Token refreshed via v4 auth!')
        return { refreshed: true, newExpiry: getTokenExpiry().expiresAt }
      }
    }

    console.warn('[refresh] ❌ Could not refresh — will use official fallback when expired')
    return { refreshed: false, reason: 'refresh endpoints did not return new token' }
  } catch (err) {
    console.error('[refresh] Error:', err.message)
    return { refreshed: false, reason: err.message }
  }
}

function buildRefreshTokenThrift() {
  // Minimal Thrift request for token refresh
  const parts = []
  parts.push(Buffer.from([0x82, 0x21, 0x01]))
  parts.push(writeString('refresh'))
  parts.push(writeVarint(0))
  parts.push(Buffer.from([0x00]))
  return Buffer.concat(parts)
}

// Auto-refresh every 6 hours
setInterval(async () => {
  const result = await refreshTokenIfNeeded()
  console.log('[auto-refresh]', JSON.stringify(result))
}, 6 * 60 * 60 * 1000)

// Refresh on startup
setTimeout(() => refreshTokenIfNeeded().then(r => console.log('[startup-refresh]', JSON.stringify(r))), 5000)

// ─── Thrift Compact Protocol Encoder ─────────────────────
// LINE uses TCompactProtocol for internal API
// We only need sendMessage which is method ID 0 on TalkService

function writeVarint(value) {
  const bytes = []
  value = (value << 1) ^ (value >> 31) // zigzag encode for signed
  while ((value & ~0x7f) !== 0) {
    bytes.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  bytes.push(value & 0x7f)
  return Buffer.from(bytes)
}

function writeUVarint(value) {
  const bytes = []
  while ((value & ~0x7f) !== 0) {
    bytes.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  bytes.push(value & 0x7f)
  return Buffer.from(bytes)
}

function writeString(str) {
  const buf = Buffer.from(str, 'utf-8')
  return Buffer.concat([writeUVarint(buf.length), buf])
}

function writeByte(val) {
  return Buffer.from([val & 0xff])
}

// Build TCompact sendMessage payload
// TalkService.sendMessage(seq: i32, message: Message)
// Message struct: { to: string(2), text: string(10), contentType: i32(15) }
function buildSendMessageThrift(seq, to, text, contentType = 0) {
  const parts = []

  // Method header: sendMessage, CALL, seqid
  // Compact protocol method call: [protocol_id, version, type, method_name, seqid]
  parts.push(Buffer.from([0x82, 0x21, 0x01])) // protocol_id=0x82, version=1, type=CALL
  parts.push(writeString('sendMessage')) // method name
  parts.push(writeVarint(seq)) // sequence id

  // Field 1: seq (i32) - field delta 1, type 5 (i32)
  parts.push(Buffer.from([0x15])) // delta=1, type=5(i32)
  parts.push(writeVarint(0)) // seq = 0

  // Field 2: message (struct) - field delta 1, type 12 (struct)
  parts.push(Buffer.from([0x1c])) // delta=1, type=12(struct)

  // Message.to (field 2, string) - field id 2, type 8 (string)
  parts.push(Buffer.from([0x28])) // delta=2, type=8(string)
  parts.push(writeString(to))

  // Message.text (field 10, string) - field id 10
  // delta from 2 to 10 = 8
  parts.push(Buffer.from([0x88])) // delta=8, type=8(string)
  parts.push(writeString(text))

  // Message.contentType (field 15, i32)
  // delta from 10 to 15 = 5
  parts.push(Buffer.from([0x55])) // delta=5, type=5(i32)
  parts.push(writeVarint(contentType))

  // End of Message struct
  parts.push(Buffer.from([0x00]))

  // End of args struct
  parts.push(Buffer.from([0x00]))

  return Buffer.concat(parts)
}

// ─── Send via Unofficial (Thrift) ────────────────────────

async function sendViaUnofficial(to, text) {
  if (!LINE_AUTH_TOKEN) {
    return { success: false, error: 'LINE_AUTH_TOKEN not configured' }
  }

  // Auto-refresh if expired
  const { expired } = getTokenExpiry()
  if (expired) {
    console.log('[send] Token expired — refreshing before send...')
    await refreshTokenIfNeeded()
  }

  try {
    const payload = buildSendMessageThrift(0, to, text)

    const res = await fetch(LINE_THRIFT_API + '/S4', {
      method: 'POST',
      headers: {
        ...LINE_APP_HEADER,
        'X-Line-Access': LINE_AUTH_TOKEN,
        'Content-Type': 'application/x-thrift',
        'Accept': 'application/x-thrift',
      },
      body: payload,
    })

    if (res.ok) {
      return { success: true, via: 'unofficial' }
    }

    const body = await res.text().catch(() => '')
    return { success: false, error: `Thrift HTTP ${res.status}: ${body.slice(0, 200)}` }
  } catch (err) {
    return { success: false, error: `Unofficial: ${err.message}` }
  }
}

// ─── Send via Official (Fallback) ────────────────────────

async function sendViaOfficial(to, messages) {
  if (!LINE_CHANNEL_TOKEN) {
    return { success: false, error: 'LINE_CHANNEL_ACCESS_TOKEN not configured' }
  }

  try {
    const res = await fetch(`${LINE_OFFICIAL_API}/message/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_TOKEN}`,
      },
      body: JSON.stringify({ to, messages }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { success: false, error: `Official HTTP ${res.status}: ${body.slice(0, 200)}` }
    }
    return { success: true, via: 'official' }
  } catch (err) {
    return { success: false, error: `Official: ${err.message}` }
  }
}

// ─── Auth guard ──────────────────────────────────────────

function checkAuth(req, res) {
  if (!AUTH_TOKEN) return true
  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (bearer !== AUTH_TOKEN) {
    res.status(401).json({ success: false, error: 'Invalid auth token' })
    return false
  }
  return true
}

// ─── Health ──────────────────────────────────────────────

app.get('/health', (_req, res) => {
  const tokenStatus = getTokenExpiry()
  res.json({
    ok: true,
    service: 'lottobot-unofficial-endpoint',
    hasAuthToken: !!AUTH_TOKEN,
    hasLineToken: !!LINE_CHANNEL_TOKEN,
    hasUnofficialToken: !!LINE_AUTH_TOKEN,
    mode: LINE_AUTH_TOKEN ? 'unofficial (primary) + official (fallback)' : 'official only',
    token: LINE_AUTH_TOKEN ? {
      expired: tokenStatus.expired,
      expiresIn: `${Math.floor(tokenStatus.expiresIn / 3600)}h`,
      expiresAt: tokenStatus.expiresAt,
      refreshExpiry: tokenStatus.refreshExpiry,
      autoRefresh: 'every 6h',
    } : null,
    now: new Date().toISOString(),
  })
})

// Manual refresh trigger
app.post('/refresh', async (req, res) => {
  if (!checkAuth(req, res)) return
  const result = await refreshTokenIfNeeded()
  res.json(result)
})

// ─── Send endpoint ───────────────────────────────────────

app.post('/send', async (req, res) => {
  if (!checkAuth(req, res)) return

  const { mode, to, officialTo, text, imageUrl } = req.body || {}
  if (!mode) return res.status(400).json({ success: false, error: 'mode is required' })

  const officialGroupId = officialTo || to

  // For text messages: try unofficial first
  if (mode === 'push_text') {
    if (!to || !text) return res.status(400).json({ success: false, error: 'push_text requires: to, text' })

    // 1. Try unofficial (Thrift)
    if (LINE_AUTH_TOKEN) {
      const result = await sendViaUnofficial(to, text)
      if (result.success) return res.json(result)
      console.warn('[unofficial failed]', result.error, '→ trying official')
    }

    // 2. Fallback to official
    if (LINE_CHANNEL_TOKEN && officialGroupId) {
      const result = await sendViaOfficial(officialGroupId, [{ type: 'text', text }])
      return result.success ? res.json(result) : res.status(502).json(result)
    }

    return res.status(502).json({ success: false, error: 'No working LINE credentials' })
  }

  // For image+text: try unofficial text only, then official for full message
  if (mode === 'push_image_text') {
    if (!to || !imageUrl || !text) return res.status(400).json({ success: false, error: 'push_image_text requires: to, imageUrl, text' })

    // 1. Try unofficial (text only — Thrift image is complex)
    if (LINE_AUTH_TOKEN) {
      const fullText = `${text}`
      const result = await sendViaUnofficial(to, fullText)
      if (result.success) return res.json(result)
      console.warn('[unofficial failed]', result.error, '→ trying official')
    }

    // 2. Fallback to official (image + text)
    if (LINE_CHANNEL_TOKEN && officialGroupId) {
      const result = await sendViaOfficial(officialGroupId, [
        { type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl },
        { type: 'text', text },
      ])
      return result.success ? res.json(result) : res.status(502).json(result)
    }

    return res.status(502).json({ success: false, error: 'No working LINE credentials' })
  }

  // Broadcast modes (official only)
  if (mode === 'broadcast_text' || mode === 'broadcast_image_text') {
    if (!LINE_CHANNEL_TOKEN) return res.status(502).json({ success: false, error: 'Broadcast requires official token' })

    const messages = mode === 'broadcast_text'
      ? [{ type: 'text', text }]
      : [
          { type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl },
          { type: 'text', text },
        ]

    try {
      const broadcastRes = await fetch(`${LINE_OFFICIAL_API}/message/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_CHANNEL_TOKEN}` },
        body: JSON.stringify({ messages }),
      })
      const result = { success: broadcastRes.ok, via: 'official_broadcast' }
      return broadcastRes.ok ? res.json(result) : res.status(502).json(result)
    } catch (err) {
      return res.status(502).json({ success: false, error: err.message })
    }
  }

  return res.status(400).json({ success: false, error: `unsupported mode: ${mode}` })
})

app.listen(PORT, () => {
  console.log(`[unofficial-endpoint] listening on :${PORT}`)
  console.log(`  mode: ${LINE_AUTH_TOKEN ? 'UNOFFICIAL (Thrift) + Official (fallback)' : 'Official only'}`)
  console.log(`  unofficial token: ${LINE_AUTH_TOKEN ? 'YES' : 'NO'}`)
  console.log(`  official token: ${LINE_CHANNEL_TOKEN ? 'YES' : 'NO'}`)
})
