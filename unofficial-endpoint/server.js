const express = require('express')

const app = express()

// CORS — allow Dashboard to call /health and /send
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
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || ''
const LINE_API = 'https://api.line.me/v2/bot'

function unauthorized(res, message = 'Unauthorized') {
  return res.status(401).json({ success: false, error: message })
}

function badRequest(res, message) {
  return res.status(400).json({ success: false, error: message })
}

async function callLine(path, payload) {
  if (!LINE_TOKEN) {
    return { success: false, error: 'LINE_CHANNEL_ACCESS_TOKEN is not configured' }
  }

  try {
    const res = await fetch(`${LINE_API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_TOKEN}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { success: false, error: `LINE HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}` }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'lottobot-unofficial-endpoint',
    hasAuthToken: !!AUTH_TOKEN,
    hasLineToken: !!LINE_TOKEN,
    now: new Date().toISOString(),
  })
})

app.post('/send', async (req, res) => {
  // Optional auth guard
  if (AUTH_TOKEN) {
    const header = req.headers.authorization || ''
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (bearer !== AUTH_TOKEN) {
      return unauthorized(res, 'Invalid unofficial auth token')
    }
  }

  const { mode, to, text, imageUrl } = req.body || {}

  if (!mode) return badRequest(res, 'mode is required')

  let result

  switch (mode) {
    case 'push_text': {
      if (!to || !text) return badRequest(res, 'push_text requires: to, text')
      result = await callLine('/message/push', {
        to,
        messages: [{ type: 'text', text }],
      })
      break
    }

    case 'push_image_text': {
      if (!to || !imageUrl || !text) return badRequest(res, 'push_image_text requires: to, imageUrl, text')
      result = await callLine('/message/push', {
        to,
        messages: [
          { type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl },
          { type: 'text', text },
        ],
      })
      break
    }

    case 'broadcast_text': {
      if (!text) return badRequest(res, 'broadcast_text requires: text')
      result = await callLine('/message/broadcast', {
        messages: [{ type: 'text', text }],
      })
      break
    }

    case 'broadcast_image_text': {
      if (!imageUrl || !text) return badRequest(res, 'broadcast_image_text requires: imageUrl, text')
      result = await callLine('/message/broadcast', {
        messages: [
          { type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl },
          { type: 'text', text },
        ],
      })
      break
    }

    default:
      return badRequest(res, `unsupported mode: ${mode}`)
  }

  if (!result.success) {
    return res.status(502).json({ success: false, error: result.error })
  }

  return res.json({ success: true })
})

app.post('/login', async (req, res) => {
  // Auth guard
  if (AUTH_TOKEN) {
    const header = req.headers.authorization || ''
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (bearer !== AUTH_TOKEN) {
      return unauthorized(res, 'Invalid auth token')
    }
  }

  const { email, password } = req.body || {}
  if (!email || !password) return badRequest(res, 'email and password required')

  try {
    // LINE internal login API
    const loginRes = await fetch('https://gd2.line.naver.jp/api/v4p/rs', {
      method: 'POST',
      headers: {
        'User-Agent': 'Line/12.0.0 iPad8,6 16.0',
        'X-Line-Application': 'IOSIPAD\t12.0.0\tiOS\t16.0',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        type: '1',
        identityProvider: 'LINE',
        identifier: email,
        password: password,
        keepLoggedIn: 'true',
        accessLocation: '127.0.0.1',
        systemName: 'LottoBot',
        e2eeVersion: '0',
      }).toString(),
    })

    const text = await loginRes.text()
    let data
    try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 500) } }

    if (loginRes.ok && data?.result?.authToken) {
      return res.json({
        success: true,
        authToken: data.result.authToken,
        message: 'Login สำเร็จ — เก็บ authToken ไว้ใน LINE_AUTH_TOKEN env',
      })
    }

    return res.status(401).json({
      success: false,
      error: 'Login failed',
      detail: data,
      hint: 'เช็ค email/password หรือต้อง verify ผ่าน LINE app บนมือถือ',
    })
  } catch (err) {
    return res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
})

app.post('/groups', async (req, res) => {
  // Auth guard
  if (AUTH_TOKEN) {
    const header = req.headers.authorization || ''
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (bearer !== AUTH_TOKEN) {
      return unauthorized(res, 'Invalid auth token')
    }
  }

  const { authToken } = req.body || {}
  if (!authToken) return badRequest(res, 'authToken required')

  try {
    const groupRes = await fetch('https://gd2.line.naver.jp/api/v4p/rs', {
      headers: {
        'User-Agent': 'Line/12.0.0 iPad8,6 16.0',
        'X-Line-Application': 'IOSIPAD\t12.0.0\tiOS\t16.0',
        'X-Line-Access': authToken,
      },
    })

    const data = await groupRes.json().catch(() => ({}))
    return res.json({ success: true, groups: data })
  } catch (err) {
    return res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
})

app.listen(PORT, () => {
  console.log(`[unofficial-endpoint] listening on :${PORT}`)
})
