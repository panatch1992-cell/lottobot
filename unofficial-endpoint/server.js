const http = require('http')

const PORT = process.env.PORT || 8080
const AUTH_TOKEN = process.env.UNOFFICIAL_AUTH_TOKEN || ''
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || ''
const LINE_API = 'https://api.line.me/v2/bot'

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function unauthorized(res, message = 'Unauthorized') {
  return writeJson(res, 401, { success: false, error: message })
}

function badRequest(res, message) {
  return writeJson(res, 400, { success: false, error: message })
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

function health(res) {
  return writeJson(res, 200, {
    ok: true,
    service: 'lottobot-unofficial-endpoint',
    hasAuthToken: !!AUTH_TOKEN,
    hasLineToken: !!LINE_TOKEN,
    now: new Date().toISOString(),
  })
}

async function parseJsonBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
    if (Buffer.concat(chunks).length > 1024 * 1024) {
      throw new Error('payload too large')
    }
  }

  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

async function handleSend(req, res) {
  let body
  try {
    body = await parseJsonBody(req)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid body'
    return badRequest(res, message === 'payload too large' ? 'request body too large (max 1mb)' : 'invalid JSON body')
  }

  // Optional auth guard
  if (AUTH_TOKEN) {
    const header = req.headers.authorization || ''
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (bearer !== AUTH_TOKEN) {
      return unauthorized(res, 'Invalid unofficial auth token')
    }
  }

  const { mode, to, text, imageUrl } = body || {}

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
    return writeJson(res, 502, { success: false, error: result.error })
  }

  return writeJson(res, 200, { success: true })
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    return health(res)
  }

  if (req.method === 'POST' && requestUrl.pathname === '/send') {
    return handleSend(req, res)
  }

  return writeJson(res, 404, { success: false, error: 'Not Found' })
})

server.listen(PORT, () => {
  console.log(`[unofficial-endpoint] listening on :${PORT}`)
})
