/**
 * LottoBot Unofficial Endpoint (Node.js + @evex/linejs)
 *
 * Uses @evex/linejs for both login and sending to ensure consistent
 * session handling (no V3_TOKEN_CLIENT_LOGGED_OUT).
 *
 * Endpoints:
 *   GET  /health        — status + token info
 *   POST /login         — email/password → PIN → token
 *   GET  /login/check   — poll login status
 *   POST /update-token  — set LINE_AUTH_TOKEN manually
 *   GET  /groups        — list joined groups
 *   POST /send          — send message (push_text / push_image_text / broadcast)
 *   POST /debug-send    — test send (no auth)
 *   GET  /test          — HTML test page
 */

import express from 'express'
import { loginWithPassword, loginWithAuthToken } from '@evex/linejs'

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
const AUTH_TOKEN = (process.env.UNOFFICIAL_AUTH_TOKEN || '').trim()
let LINE_AUTH_TOKEN = (process.env.LINE_AUTH_TOKEN || '').replace(/\s+/g, '').trim()
const LINE_CHANNEL_TOKEN = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()

// ─── Anti-Ban Protection Config ────────────────────
// Safe defaults for LINE personal account:
// - Max 500 msg/day (LINE flags ~1000+)
// - Max 50 msg/hour (burst protection)
// - Random 3-8 sec delay between sends
// - Circuit breaker: stop sending after 5 consecutive failures
const ANTI_BAN = {
  MAX_MSG_PER_DAY: parseInt(process.env.MAX_MSG_PER_DAY || '500'),
  MAX_MSG_PER_HOUR: parseInt(process.env.MAX_MSG_PER_HOUR || '50'),
  MAX_MSG_PER_MINUTE: parseInt(process.env.MAX_MSG_PER_MINUTE || '5'),
  MIN_DELAY_MS: parseInt(process.env.MIN_DELAY_MS || '3000'),
  MAX_DELAY_MS: parseInt(process.env.MAX_DELAY_MS || '8000'),
  CIRCUIT_BREAKER_THRESHOLD: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5'),
  CIRCUIT_BREAKER_COOLDOWN_MS: parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS || '300000'), // 5 min
}

// Rate limit counters (in-memory, reset on restart)
const rateCounters = {
  day: { count: 0, resetAt: Date.now() + 86400000 },
  hour: { count: 0, resetAt: Date.now() + 3600000 },
  minute: { count: 0, resetAt: Date.now() + 60000 },
}

// Circuit breaker state
const circuitBreaker = {
  failures: 0,
  openedAt: 0,
  isOpen: false,
}

// Sending queue for delay enforcement
let lastSendTime = 0

function resetCounterIfExpired(counter, windowMs) {
  if (Date.now() >= counter.resetAt) {
    counter.count = 0
    counter.resetAt = Date.now() + windowMs
  }
}

function checkRateLimit() {
  resetCounterIfExpired(rateCounters.day, 86400000)
  resetCounterIfExpired(rateCounters.hour, 3600000)
  resetCounterIfExpired(rateCounters.minute, 60000)

  if (rateCounters.day.count >= ANTI_BAN.MAX_MSG_PER_DAY) {
    return { allowed: false, reason: `Daily limit reached (${ANTI_BAN.MAX_MSG_PER_DAY}/day)` }
  }
  if (rateCounters.hour.count >= ANTI_BAN.MAX_MSG_PER_HOUR) {
    return { allowed: false, reason: `Hourly limit reached (${ANTI_BAN.MAX_MSG_PER_HOUR}/hour)` }
  }
  if (rateCounters.minute.count >= ANTI_BAN.MAX_MSG_PER_MINUTE) {
    return { allowed: false, reason: `Per-minute limit reached (${ANTI_BAN.MAX_MSG_PER_MINUTE}/min)` }
  }
  return { allowed: true }
}

function incrementCounters() {
  rateCounters.day.count++
  rateCounters.hour.count++
  rateCounters.minute.count++
}

function checkCircuitBreaker() {
  if (!circuitBreaker.isOpen) return { open: false }

  // Check if cooldown expired
  if (Date.now() - circuitBreaker.openedAt > ANTI_BAN.CIRCUIT_BREAKER_COOLDOWN_MS) {
    console.log('[circuit-breaker] Cooldown expired, closing breaker')
    circuitBreaker.isOpen = false
    circuitBreaker.failures = 0
    return { open: false }
  }

  const remainingMs = ANTI_BAN.CIRCUIT_BREAKER_COOLDOWN_MS - (Date.now() - circuitBreaker.openedAt)
  return { open: true, remainingMs }
}

function recordSendResult(success) {
  if (success) {
    if (circuitBreaker.failures > 0) {
      console.log('[circuit-breaker] Send succeeded, resetting failure counter')
      circuitBreaker.failures = 0
    }
  } else {
    circuitBreaker.failures++
    console.warn(`[circuit-breaker] Failure ${circuitBreaker.failures}/${ANTI_BAN.CIRCUIT_BREAKER_THRESHOLD}`)
    if (circuitBreaker.failures >= ANTI_BAN.CIRCUIT_BREAKER_THRESHOLD) {
      console.error('[circuit-breaker] 🚨 THRESHOLD REACHED — Opening breaker for cooldown')
      circuitBreaker.isOpen = true
      circuitBreaker.openedAt = Date.now()
    }
  }
}

// Random delay with jitter
async function humanLikeDelay() {
  const now = Date.now()
  const timeSinceLastSend = now - lastSendTime
  const minDelay = ANTI_BAN.MIN_DELAY_MS
  const maxDelay = ANTI_BAN.MAX_DELAY_MS

  // Random delay within range
  const targetDelay = minDelay + Math.floor(Math.random() * (maxDelay - minDelay))

  // If less time passed than targetDelay, wait the rest
  const waitMs = Math.max(0, targetDelay - timeSinceLastSend)
  if (waitMs > 0) {
    await new Promise(r => setTimeout(r, waitMs))
  }
  lastSendTime = Date.now()
}

const LINE_OFFICIAL_API = 'https://api.line.me/v2/bot'

// ─── Global linejs client ───────────────────────────

let client = null
let clientReady = false
let clientInitPromise = null

async function initClient() {
  if (!LINE_AUTH_TOKEN) {
    console.warn('[init] No LINE_AUTH_TOKEN, client not initialized')
    return
  }
  try {
    console.log('[init] Initializing linejs client with auth token...')
    client = await loginWithAuthToken(LINE_AUTH_TOKEN, {
      device: 'DESKTOPWIN',
    })
    clientReady = true
    console.log('[init] ✅ Client ready')
  } catch (err) {
    console.error('[init] ❌ Client init failed:', err.message)
    clientReady = false
    client = null
  }
}

async function ensureClient() {
  if (clientReady && client) return client
  if (clientInitPromise) {
    await clientInitPromise
    return clientReady ? client : null
  }
  clientInitPromise = initClient()
  await clientInitPromise
  clientInitPromise = null
  return clientReady ? client : null
}

// Init on startup (delayed to let server start listening first)
setTimeout(() => ensureClient().catch(e => console.error('[init] error:', e.message)), 2000)

// ─── JWT helpers ────────────────────────────────────

function decodeJwtPayload(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = Buffer.from(parts[1], 'base64').toString('utf-8')
    return JSON.parse(payload)
  } catch {
    return null
  }
}

function getTokenExpiry() {
  if (!LINE_AUTH_TOKEN) return { expired: true, expiresIn: 0 }
  const payload = decodeJwtPayload(LINE_AUTH_TOKEN)
  if (!payload || typeof payload.exp !== 'number') {
    return { expired: false, expiresIn: Infinity }
  }
  const now = Math.floor(Date.now() / 1000)
  return {
    expired: now >= payload.exp,
    expiresIn: payload.exp - now,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    refreshExpiry: typeof payload.rexp === 'number' ? new Date(payload.rexp * 1000).toISOString() : null,
  }
}

// ─── Send helpers ───────────────────────────────────

function getMidType(mid) {
  if (!mid) return 0
  const prefix = mid.charAt(0).toLowerCase()
  if (prefix === 'c') return 2
  if (prefix === 'r') return 1
  return 0
}

async function sendViaUnofficial(to, text) {
  // ─── Anti-ban checks ─────────────────────────────

  // 1. Circuit breaker check
  const breaker = checkCircuitBreaker()
  if (breaker.open) {
    const remainingSec = Math.ceil(breaker.remainingMs / 1000)
    return {
      success: false,
      error: `Circuit breaker OPEN (too many failures). Cooldown: ${remainingSec}s`,
      circuitBreaker: true,
    }
  }

  // 2. Rate limit check
  const rateCheck = checkRateLimit()
  if (!rateCheck.allowed) {
    console.warn(`[anti-ban] Rate limit: ${rateCheck.reason}`)
    return { success: false, error: rateCheck.reason, rateLimited: true }
  }

  // 3. Client ready check
  const c = await ensureClient()
  if (!c) return { success: false, error: 'Client not initialized' }

  // 4. Human-like delay (random 3-8 sec between sends)
  await humanLikeDelay()

  // ─── Actual send ────────────────────────────────
  try {
    console.log(`[unofficial] Sending to ${to.slice(-8)} (type=${getMidType(to)}) text=${text.slice(0, 50)}`)
    const res = await c.base.talk.sendMessage({ to, text })

    // Success — update counters + breaker
    incrementCounters()
    recordSendResult(true)

    console.log(`[unofficial] ✅ Sent, messageId=${res?.id || '?'} | Today: ${rateCounters.day.count}/${ANTI_BAN.MAX_MSG_PER_DAY}`)
    return { success: true, via: 'unofficial', messageId: res?.id }
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`[unofficial] ❌ Send failed: ${msg}`)

    // Check for LINE-specific ban signals
    if (msg.includes('ABUSE_BLOCK') || msg.includes('AUTHENTICATION_FAILED')) {
      console.error('[anti-ban] 🚨 LINE ban signal detected! Opening circuit breaker immediately')
      circuitBreaker.failures = ANTI_BAN.CIRCUIT_BREAKER_THRESHOLD
      circuitBreaker.isOpen = true
      circuitBreaker.openedAt = Date.now()
    } else {
      recordSendResult(false)
    }

    return { success: false, error: msg }
  }
}

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
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { success: false, error: `Official HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}` }
    }
    if (body.message) return { success: false, error: `Official: ${body.message}` }
    console.log(`[official] ✅ Sent to ${to.slice(-8)}`)
    return { success: true, via: 'official' }
  } catch (err) {
    return { success: false, error: `Official: ${err.message}` }
  }
}

// ─── Auth guard ─────────────────────────────────────

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

// ─── Login sessions ─────────────────────────────────

const loginSessions = new Map()

// ─── Routes ─────────────────────────────────────────

app.get('/health', (_req, res) => {
  const tokenStatus = getTokenExpiry()
  const payload = decodeJwtPayload(LINE_AUTH_TOKEN)
  res.json({
    ok: true,
    service: 'lottobot-unofficial-endpoint',
    runtime: 'node + @evex/linejs',
    hasAuthToken: !!AUTH_TOKEN,
    hasLineToken: !!LINE_CHANNEL_TOKEN,
    hasUnofficialToken: !!LINE_AUTH_TOKEN,
    clientReady,
    mode: clientReady ? 'unofficial (primary)' : (LINE_CHANNEL_TOKEN ? 'official only' : 'none'),
    tokenDebug: LINE_AUTH_TOKEN ? {
      length: LINE_AUTH_TOKEN.length,
      parts: LINE_AUTH_TOKEN.split('.').length,
      decoded: payload ? { aid: payload.aid, exp: payload.exp, cmode: payload.cmode, ctype: payload.ctype } : 'FAILED_TO_DECODE',
    } : null,
    token: LINE_AUTH_TOKEN ? {
      expired: tokenStatus.expired,
      expiresIn: isFinite(tokenStatus.expiresIn) ? `${Math.floor(tokenStatus.expiresIn / 3600)}h` : 'unknown',
      expiresAt: tokenStatus.expiresAt,
      refreshExpiry: tokenStatus.refreshExpiry,
    } : null,
    antiBan: {
      config: ANTI_BAN,
      counters: {
        day: { sent: rateCounters.day.count, limit: ANTI_BAN.MAX_MSG_PER_DAY, remaining: ANTI_BAN.MAX_MSG_PER_DAY - rateCounters.day.count },
        hour: { sent: rateCounters.hour.count, limit: ANTI_BAN.MAX_MSG_PER_HOUR, remaining: ANTI_BAN.MAX_MSG_PER_HOUR - rateCounters.hour.count },
        minute: { sent: rateCounters.minute.count, limit: ANTI_BAN.MAX_MSG_PER_MINUTE, remaining: ANTI_BAN.MAX_MSG_PER_MINUTE - rateCounters.minute.count },
      },
      circuitBreaker: {
        isOpen: circuitBreaker.isOpen,
        failures: circuitBreaker.failures,
        threshold: ANTI_BAN.CIRCUIT_BREAKER_THRESHOLD,
        cooldownRemainingMs: circuitBreaker.isOpen ? Math.max(0, ANTI_BAN.CIRCUIT_BREAKER_COOLDOWN_MS - (Date.now() - circuitBreaker.openedAt)) : 0,
      },
    },
    now: new Date().toISOString(),
  })
})

// Reset anti-ban counters (admin endpoint)
app.post('/anti-ban/reset', (req, res) => {
  if (!checkAuth(req, res)) return
  rateCounters.day = { count: 0, resetAt: Date.now() + 86400000 }
  rateCounters.hour = { count: 0, resetAt: Date.now() + 3600000 }
  rateCounters.minute = { count: 0, resetAt: Date.now() + 60000 }
  circuitBreaker.failures = 0
  circuitBreaker.isOpen = false
  circuitBreaker.openedAt = 0
  console.log('[anti-ban] Counters + circuit breaker reset manually')
  res.json({ success: true, message: 'Anti-ban state reset' })
})

app.post('/login', async (req, res) => {
  if (!checkAuth(req, res)) return

  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email and password required' })
  }

  console.log(`[login] Starting login for ${email.slice(0, 3)}***`)

  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const session = { status: 'waiting', createdAt: Date.now() }
  loginSessions.set(sessionId, session)
  setTimeout(() => loginSessions.delete(sessionId), 300000)

  let pinResolver = null
  const pinPromise = new Promise(resolve => { pinResolver = resolve })

  // Start login in background
  ;(async () => {
    try {
      const newClient = await loginWithPassword(
        {
          email,
          password,
          onPincodeRequest(pin) {
            console.log(`[login] PIN received: ${pin}`)
            if (pinResolver) pinResolver(pin)
          },
        },
        { device: 'DESKTOPWIN' }
      )

      const token = newClient.base.authToken
      if (token) {
        LINE_AUTH_TOKEN = token
        client = newClient
        clientReady = true
        session.status = 'success'
        session.token = token
        console.log(`[login] ✅ Login success, token obtained`)
      } else {
        session.status = 'error'
        session.error = 'No token received'
      }
    } catch (err) {
      session.status = 'error'
      session.error = err?.message || String(err)
      console.error(`[login] ❌ Failed: ${session.error}`)
    }
  })()

  // Wait for PIN (max 15 seconds)
  const pinResult = await Promise.race([
    pinPromise,
    new Promise(resolve => setTimeout(() => resolve(null), 15000)),
  ])

  if (pinResult) {
    return res.json({
      success: true,
      needPin: true,
      pinCode: pinResult,
      sessionId,
      message: `กรุณาเปิด LINE app แล้วกด verify PIN: ${pinResult}`,
    })
  }

  // No PIN — check status
  if (session.status === 'success') {
    return res.json({
      success: true,
      needPin: false,
      token: session.token,
      expiry: getTokenExpiry(),
    })
  }

  if (session.status === 'error') {
    return res.json({ success: false, error: session.error })
  }

  return res.json({
    success: true,
    needPin: true,
    pinCode: null,
    sessionId,
    message: 'รอ PIN จาก LINE...',
  })
})

app.get('/login/check', (req, res) => {
  const sessionId = req.query.session
  if (!sessionId) return res.status(400).json({ status: 'error', error: 'session required' })

  const session = loginSessions.get(sessionId)
  if (!session) return res.json({ status: 'expired', error: 'Session not found' })

  if (session.status === 'success' && session.token) {
    return res.json({ status: 'success', token: session.token, expiry: getTokenExpiry() })
  }
  if (session.status === 'error') {
    return res.json({ status: 'error', error: session.error })
  }

  const elapsed = Math.floor((Date.now() - session.createdAt) / 1000)
  if (elapsed > 240) {
    session.status = 'timeout'
    return res.json({ status: 'timeout', error: 'ไม่ได้ verify ภายในเวลาที่กำหนด' })
  }

  return res.json({ status: 'waiting', elapsed, message: 'รอ verify ที่ LINE app...' })
})

app.post('/update-token', async (req, res) => {
  if (!checkAuth(req, res)) return
  const { token } = req.body || {}
  if (!token) return res.status(400).json({ success: false, error: 'token is required' })

  LINE_AUTH_TOKEN = token
  clientReady = false
  client = null

  try {
    await initClient()
    return res.json({ success: clientReady, expiry: getTokenExpiry(), clientReady })
  } catch (err) {
    return res.json({ success: false, error: err.message })
  }
})

app.get('/groups', async (req, res) => {
  if (!checkAuth(req, res)) return

  const c = await ensureClient()
  if (!c) return res.status(500).json({ success: false, error: 'Client not ready' })

  try {
    const mids = await c.base.talk.getAllChatMids({
      request: { withMemberChats: true, withInvitedChats: false },
      syncReason: 'INTERNAL',
    })
    console.log('[groups] mids:', JSON.stringify(mids).slice(0, 300))

    const groupIds = Array.isArray(mids?.memberChatMids) ? mids.memberChatMids : []
    const groups = []

    if (groupIds.length > 0) {
      try {
        const chatsRes = await c.base.talk.getChats({
          chatMids: groupIds,
          withMembers: false,
          withInvitees: false,
        })
        const chats = chatsRes?.chats || []
        for (const chat of chats) {
          groups.push({ id: chat.chatMid, name: chat.chatName || '(unnamed)' })
        }
      } catch (err) {
        console.error('[groups] getChats failed:', err.message)
        for (const gid of groupIds) groups.push({ id: gid, name: '(name unavailable)' })
      }
    }

    res.json({ success: true, count: groups.length, groups })
  } catch (err) {
    console.error('[groups] Error:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/send', async (req, res) => {
  if (!checkAuth(req, res)) return

  const { mode, to, officialTo, text, imageUrl } = req.body || {}
  if (!mode) return res.status(400).json({ success: false, error: 'mode is required' })

  const officialGroupId = officialTo || to

  if (mode === 'push_text') {
    if (!to || !text) return res.status(400).json({ success: false, error: 'push_text requires: to, text' })

    const result = await sendViaUnofficial(to, text)
    if (result.success) return res.json(result)
    console.warn(`[send] unofficial failed: ${result.error} → fallback official`)

    if (LINE_CHANNEL_TOKEN && officialGroupId) {
      const off = await sendViaOfficial(officialGroupId, [{ type: 'text', text }])
      return off.success ? res.json(off) : res.status(502).json(off)
    }
    return res.status(502).json({ success: false, error: result.error })
  }

  if (mode === 'push_image_text') {
    if (!to || !imageUrl || !text) return res.status(400).json({ success: false, error: 'push_image_text requires: to, imageUrl, text' })

    const result = await sendViaUnofficial(to, text)
    if (result.success) return res.json(result)

    if (LINE_CHANNEL_TOKEN && officialGroupId) {
      const off = await sendViaOfficial(officialGroupId, [
        { type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl },
        { type: 'text', text },
      ])
      return off.success ? res.json(off) : res.status(502).json(off)
    }
    return res.status(502).json({ success: false, error: result.error })
  }

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
      return broadcastRes.ok
        ? res.json({ success: true, via: 'official_broadcast' })
        : res.status(502).json({ success: false, error: `HTTP ${broadcastRes.status}` })
    } catch (err) {
      return res.status(502).json({ success: false, error: err.message })
    }
  }

  return res.status(400).json({ success: false, error: `unsupported mode: ${mode}` })
})

app.post('/debug-send', async (req, res) => {
  const { to, text } = req.body || {}
  if (!to) return res.status(400).json({ error: 'to is required' })
  const testText = text || `🧪 LottoBot test ${new Date().toLocaleString('th-TH')}`
  const result = await sendViaUnofficial(to, testText)
  res.json({
    sendResult: result,
    diagnostics: {
      to: to.slice(-8),
      toType: getMidType(to),
      toTypeLabel: ['USER', 'ROOM', 'GROUP'][getMidType(to)] || 'UNKNOWN',
      clientReady,
      tokenStatus: getTokenExpiry(),
    },
  })
})

app.get('/test', (_req, res) => {
  const tokenStatus = getTokenExpiry()
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LottoBot Test</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#1a1a2e;color:#eee;padding:16px;max-width:500px;margin:0 auto}
h2{color:#c9a84c;margin-bottom:12px}
.card{background:#16213e;border-radius:12px;padding:16px;margin-bottom:12px}
.status{display:flex;align-items:center;gap:8px;margin:6px 0}
.dot{width:10px;height:10px;border-radius:50%}
.green{background:#22a867}.red{background:#dc3545}.yellow{background:#e89b1c}
label{display:block;color:#aaa;font-size:13px;margin:8px 0 4px}
input,textarea{width:100%;padding:10px;border-radius:8px;border:1px solid #333;background:#0f3460;color:#fff;font-size:15px}
textarea{height:80px;resize:vertical}
button{width:100%;padding:12px;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;margin-top:8px}
.btn-send{background:#22a867;color:#fff}
.btn-load{background:#c9a84c;color:#000}
#result,#groups{margin-top:12px;padding:12px;border-radius:8px;font-size:14px}
.ok{background:#1b4332;border:1px solid #22a867}
.fail{background:#3d0000;border:1px solid #dc3545}
</style></head><body>
<h2>🧪 LottoBot Unofficial Test (Node + linejs)</h2>
<div class="card">
  <div class="status"><div class="dot ${clientReady ? 'green' : 'red'}"></div>
    <span>Client: ${clientReady ? '✅ พร้อมใช้' : '❌ ยังไม่พร้อม'}</span></div>
  <div class="status"><div class="dot ${!tokenStatus.expired && LINE_AUTH_TOKEN ? 'green' : 'red'}"></div>
    <span>Token: ${!LINE_AUTH_TOKEN ? '❌ ไม่มี' : tokenStatus.expired ? '❌ หมดอายุ' : '✅ ใช้ได้'}</span></div>
</div>
<div class="card">
  <button class="btn-load" onclick="loadGroups()">📋 ดึงรายการกลุ่ม LINE</button>
  <div id="groups"></div>
</div>
<div class="card">
  <label>Group MID (to)</label>
  <input id="to" placeholder="c..." />
  <label>ข้อความ</label>
  <textarea id="text">🧪 ทดสอบ LottoBot unofficial</textarea>
  <button class="btn-send" onclick="testSend()">📤 ส่งทดสอบ</button>
  <div id="result" style="display:none"></div>
</div>
<script>
async function loadGroups() {
  const div = document.getElementById('groups')
  div.innerHTML = '⏳ กำลังดึง...'
  try {
    const res = await fetch('/groups')
    const data = await res.json()
    if (data.success && data.groups?.length > 0) {
      div.innerHTML = data.groups.map(g =>
        '<div style="background:#0f3460;padding:8px;margin:4px 0;border-radius:6px;cursor:pointer" onclick="document.getElementById(\\'to\\').value=\\'' + g.id + '\\'">' +
        '<div>' + g.name + '</div><div style="font-size:10px;color:#aaa;font-family:monospace">' + g.id + '</div></div>'
      ).join('')
    } else {
      div.innerHTML = '<div class="fail">❌ ' + (data.error || 'ไม่พบกลุ่ม') + '</div>'
    }
  } catch (e) {
    div.innerHTML = '<div class="fail">❌ ' + e.message + '</div>'
  }
}
async function testSend() {
  const to = document.getElementById('to').value.trim()
  const text = document.getElementById('text').value.trim()
  const result = document.getElementById('result')
  result.style.display = 'block'
  result.className = ''
  result.textContent = '⏳ กำลังส่ง...'
  try {
    const res = await fetch('/debug-send', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({to, text})
    })
    const data = await res.json()
    if (data.sendResult?.success) {
      result.className = 'ok'
      result.innerHTML = '✅ ส่งสำเร็จ via ' + (data.sendResult.via || 'unofficial')
    } else {
      result.className = 'fail'
      result.innerHTML = '❌ ' + (data.sendResult?.error || 'failed')
    }
  } catch (e) {
    result.className = 'fail'
    result.textContent = '❌ ' + e.message
  }
}
</script>
</body></html>`)
})

app.listen(PORT, () => {
  console.log(`[unofficial-endpoint] listening on :${PORT}`)
  console.log(`  mode: ${LINE_AUTH_TOKEN ? 'UNOFFICIAL (primary)' : 'Official only'}`)
  console.log(`  unofficial token: ${LINE_AUTH_TOKEN ? 'YES' : 'NO'}`)
  console.log(`  official token: ${LINE_CHANNEL_TOKEN ? 'YES' : 'NO'}`)
})
