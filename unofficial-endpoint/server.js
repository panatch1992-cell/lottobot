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

// LINE internal API config
// authToken ได้จาก LINEJS login หรือ LINE app extraction
const LINE_AUTH_TOKEN = process.env.LINE_AUTH_TOKEN || ''
const LINE_INTERNAL_API = 'https://gd2.line.naver.jp'
const LINE_OFFICIAL_API = 'https://api.line.me/v2/bot'
const LINE_CHANNEL_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || ''

const LINE_HEADERS = {
  'User-Agent': 'Line/13.4.0 iPad8,6 17.0',
  'X-Line-Application': 'IOSIPAD\t13.4.0\tiOS\t17.0',
  'X-Line-Carrier': 'wifi',
  'Content-Type': 'application/json',
}

// ─── Auth guard ──────────────────────────────────────────

function unauthorized(res, message = 'Unauthorized') {
  return res.status(401).json({ success: false, error: message })
}

function badRequest(res, message) {
  return res.status(400).json({ success: false, error: message })
}

function checkAuth(req, res) {
  if (!AUTH_TOKEN) return true
  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (bearer !== AUTH_TOKEN) {
    unauthorized(res, 'Invalid auth token')
    return false
  }
  return true
}

// ─── LINE Internal API (Unofficial — no quota) ──────────

async function sendViaUnofficial(to, messages) {
  if (!LINE_AUTH_TOKEN) {
    return { success: false, error: 'LINE_AUTH_TOKEN not configured' }
  }

  try {
    for (const msg of messages) {
      const payload = {
        to: to,
        contentType: msg.type === 'image' ? 1 : 0,
        text: msg.text || '',
      }

      if (msg.type === 'image' && msg.originalContentUrl) {
        payload.contentMetadata = {
          PREVIEW_URL: msg.originalContentUrl,
          DOWNLOAD_URL: msg.originalContentUrl,
          PUBLIC: 'TRUE',
        }
      }

      const res = await fetch(`${LINE_INTERNAL_API}/S4`, {
        method: 'POST',
        headers: {
          ...LINE_HEADERS,
          'X-Line-Access': LINE_AUTH_TOKEN,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { success: false, error: `Unofficial HTTP ${res.status}: ${body.slice(0, 200)}` }
      }
    }
    return { success: true, via: 'unofficial' }
  } catch (err) {
    return { success: false, error: `Unofficial: ${err.message}` }
  }
}

// ─── LINE Official API (Fallback — has quota) ────────────

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

// ─── Smart Send: unofficial first → fallback official ────

async function smartSend(to, officialTo, messages) {
  // 1. Try unofficial first (if configured)
  if (LINE_AUTH_TOKEN && to) {
    const result = await sendViaUnofficial(to, messages)
    if (result.success) return result
    console.warn(`[unofficial failed] ${result.error} → trying official`)
  }

  // 2. Fallback to official
  const target = officialTo || to
  if (LINE_CHANNEL_TOKEN && target) {
    return sendViaOfficial(target, messages)
  }

  return { success: false, error: 'No LINE credentials configured (neither unofficial nor official)' }
}

// ─── Endpoints ───────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'lottobot-unofficial-endpoint',
    hasAuthToken: !!AUTH_TOKEN,
    hasLineToken: !!LINE_CHANNEL_TOKEN,
    hasUnofficialToken: !!LINE_AUTH_TOKEN,
    mode: LINE_AUTH_TOKEN ? 'unofficial (primary) + official (fallback)' : 'official only',
    now: new Date().toISOString(),
  })
})

app.post('/send', async (req, res) => {
  if (!checkAuth(req, res)) return

  const { mode, to, officialTo, text, imageUrl } = req.body || {}
  if (!mode) return badRequest(res, 'mode is required')

  let messages
  let result

  switch (mode) {
    case 'push_text': {
      if (!to || !text) return badRequest(res, 'push_text requires: to, text')
      messages = [{ type: 'text', text }]
      result = await smartSend(to, officialTo, messages)
      break
    }

    case 'push_image_text': {
      if (!to || !imageUrl || !text) return badRequest(res, 'push_image_text requires: to, imageUrl, text')
      messages = [
        { type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl },
        { type: 'text', text },
      ]
      result = await smartSend(to, officialTo, messages)
      break
    }

    case 'broadcast_text': {
      if (!text) return badRequest(res, 'broadcast_text requires: text')
      if (LINE_CHANNEL_TOKEN) {
        result = await sendViaOfficial(null, [{ type: 'text', text }])
        // override for broadcast
        try {
          const broadcastRes = await fetch(`${LINE_OFFICIAL_API}/message/broadcast`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${LINE_CHANNEL_TOKEN}`,
            },
            body: JSON.stringify({ messages: [{ type: 'text', text }] }),
          })
          result = { success: broadcastRes.ok, via: 'official_broadcast' }
        } catch (err) {
          result = { success: false, error: err.message }
        }
      } else {
        result = { success: false, error: 'Broadcast requires official token' }
      }
      break
    }

    case 'broadcast_image_text': {
      if (!imageUrl || !text) return badRequest(res, 'broadcast_image_text requires: imageUrl, text')
      try {
        const broadcastRes = await fetch(`${LINE_OFFICIAL_API}/message/broadcast`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${LINE_CHANNEL_TOKEN}`,
          },
          body: JSON.stringify({
            messages: [
              { type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl },
              { type: 'text', text },
            ],
          }),
        })
        result = { success: broadcastRes.ok, via: 'official_broadcast' }
      } catch (err) {
        result = { success: false, error: err.message }
      }
      break
    }

    default:
      return badRequest(res, `unsupported mode: ${mode}`)
  }

  if (!result.success) {
    return res.status(502).json(result)
  }
  return res.json(result)
})

app.listen(PORT, () => {
  console.log(`[unofficial-endpoint] listening on :${PORT}`)
  console.log(`  mode: ${LINE_AUTH_TOKEN ? 'UNOFFICIAL (primary) + Official (fallback)' : 'Official only'}`)
  console.log(`  unofficial token: ${LINE_AUTH_TOKEN ? 'YES' : 'NO'}`)
  console.log(`  official token: ${LINE_CHANNEL_TOKEN ? 'YES' : 'NO'}`)
})
