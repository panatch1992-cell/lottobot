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

  if (!expired && expiresIn > ONE_DAY) return { refreshed: false, reason: `token valid for ${Math.floor(expiresIn / 3600)}h` }
  if (!LINE_AUTH_TOKEN) return { refreshed: false, reason: 'no token' }

  console.log(`[refresh] Token ${expired ? 'EXPIRED' : `expiring in ${Math.floor(expiresIn / 3600)}h`} — refreshing...`)

  // Method 1: LINE's Thrift refreshToken on AuthService
  try {
    const controller1 = new AbortController()
    setTimeout(() => controller1.abort(), 10000)
    const refreshRes = await fetch(LINE_THRIFT_API + '/RS4', {
      method: 'POST',
      headers: {
        ...LINE_APP_HEADER,
        'X-Line-Access': LINE_AUTH_TOKEN,
        'Content-Type': 'application/x-thrift',
        'Accept': 'application/x-thrift',
      },
      body: buildRefreshTokenThrift(),
      signal: controller1.signal,
    })

    if (refreshRes.ok) {
      const buf = Buffer.from(await refreshRes.arrayBuffer())
      const bodyStr = buf.toString('utf-8')
      const tokenMatch = bodyStr.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
      if (tokenMatch) {
        LINE_AUTH_TOKEN = tokenMatch[0]
        console.log('[refresh] ✅ Token refreshed via RS4!')
        return { refreshed: true, newExpiry: getTokenExpiry().expiresAt }
      }
    }
  } catch (err) {
    console.warn('[refresh] RS4 failed:', err.message)
  }

  // Method 2: LINE's v4 auth endpoint
  try {
    const controller2 = new AbortController()
    setTimeout(() => controller2.abort(), 10000)
    const refreshRes2 = await fetch(LINE_THRIFT_API + '/api/v4p/rs', {
      method: 'POST',
      headers: {
        ...LINE_APP_HEADER,
        'X-Line-Access': LINE_AUTH_TOKEN,
        'Content-Type': 'application/x-thrift',
        'Accept': 'application/x-thrift',
      },
      body: buildRefreshTokenThrift(),
      signal: controller2.signal,
    })

    if (refreshRes2.ok) {
      const buf = Buffer.from(await refreshRes2.arrayBuffer())
      const bodyStr = buf.toString('utf-8')
      const tokenMatch = bodyStr.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
      if (tokenMatch) {
        LINE_AUTH_TOKEN = tokenMatch[0]
        console.log('[refresh] ✅ Token refreshed via v4p!')
        return { refreshed: true, newExpiry: getTokenExpiry().expiresAt }
      }
    }
  } catch (err) {
    console.warn('[refresh] v4p failed:', err.message)
  }

  console.warn('[refresh] ❌ Could not refresh token')
  return { refreshed: false, reason: 'all refresh methods failed' }
}

function buildRefreshTokenThrift() {
  const parts = []
  parts.push(Buffer.from([0x82, 0x21, 0x01]))
  parts.push(writeString('refresh'))
  parts.push(writeUVarint(0))
  parts.push(Buffer.from([0x00]))
  return Buffer.concat(parts)
}

// Auto-refresh every 6 hours
setInterval(() => {
  refreshTokenIfNeeded()
    .then(r => console.log('[auto-refresh]', JSON.stringify(r)))
    .catch(e => console.error('[auto-refresh] error:', e.message))
}, 6 * 60 * 60 * 1000)

// Refresh on startup (delayed)
setTimeout(() => {
  refreshTokenIfNeeded()
    .then(r => console.log('[startup-refresh]', JSON.stringify(r)))
    .catch(e => console.error('[startup-refresh] error:', e.message))
}, 30000)

// ─── Thrift Compact Protocol Encoder ─────────────────────

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

// Detect MID type from prefix
// c = GROUP(2), r = ROOM(1), u = USER(0)
function getMidType(mid) {
  if (!mid) return 0
  const prefix = mid.charAt(0).toLowerCase()
  if (prefix === 'c') return 2 // GROUP
  if (prefix === 'r') return 1 // ROOM
  return 0 // USER
}

// Build TCompact sendMessage payload
// TalkService.sendMessage(1: i32 seq, 2: Message message)
// Message struct fields:
//   1: string _from
//   2: string to
//   3: MIDType toType (i32 enum: USER=0, ROOM=1, GROUP=2)
//   10: string text
//   15: ContentType contentType (i32)
function buildSendMessageThrift(seq, to, text, contentType = 0) {
  const parts = []
  const toType = getMidType(to)

  // Method header
  parts.push(Buffer.from([0x82, 0x21, 0x01])) // protocol=compact, version=1, type=CALL
  parts.push(writeString('sendMessage'))
  parts.push(writeUVarint(seq)) // seqid (unsigned varint)

  // Args field 1: seq (i32) - delta=1, type=5(i32)
  parts.push(Buffer.from([0x15]))
  parts.push(writeVarint(0))

  // Args field 2: message (struct) - delta=1, type=12(struct)
  parts.push(Buffer.from([0x1c]))

  // --- Inside Message struct ---

  // Message.to (field 2, string) - delta=2 from 0, type=8(string)
  parts.push(Buffer.from([0x28]))
  parts.push(writeString(to))

  // Message.toType (field 3, i32) - delta=1 from 2, type=5(i32)
  parts.push(Buffer.from([0x15]))
  parts.push(writeVarint(toType))

  // Message.text (field 10, string) - delta=7 from 3, type=8(string)
  parts.push(Buffer.from([0x78])) // delta=7, type=8
  parts.push(writeString(text))

  // Message.contentType (field 15, i32) - delta=5 from 10, type=5(i32)
  parts.push(Buffer.from([0x55]))
  parts.push(writeVarint(contentType))

  // End Message struct
  parts.push(Buffer.from([0x00]))
  // End args struct
  parts.push(Buffer.from([0x00]))

  return Buffer.concat(parts)
}

// ─── Send via Unofficial (Thrift) ────────────────────────

async function sendViaUnofficial(to, text) {
  if (!LINE_AUTH_TOKEN) {
    return { success: false, error: 'LINE_AUTH_TOKEN not configured' }
  }

  // Auto-refresh if token expired
  const { expired } = getTokenExpiry()
  if (expired) {
    console.log('[send] Token expired — refreshing...')
    await refreshTokenIfNeeded()
    const after = getTokenExpiry()
    if (after.expired) {
      return { success: false, error: 'Token expired — refresh failed. ต้องใช้ token ใหม่' }
    }
  }

  try {
    const payload = buildSendMessageThrift(0, to, text)
    const toType = getMidType(to)

    console.log(`[unofficial] Sending to ${to.slice(-8)} (type=${toType}) text=${text.slice(0, 50)}...`)

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 15000)

    const res = await fetch(LINE_THRIFT_API + '/S4', {
      method: 'POST',
      headers: {
        ...LINE_APP_HEADER,
        'X-Line-Access': LINE_AUTH_TOKEN,
        'Content-Type': 'application/x-thrift',
        'Accept': 'application/x-thrift',
      },
      body: payload,
      signal: controller.signal,
    })

    const resBuffer = Buffer.from(await res.arrayBuffer())

    if (resBuffer.length === 0) {
      return { success: false, error: 'Empty response from LINE' }
    }

    // Check for error strings in Thrift response body
    const bodyStr = resBuffer.toString('utf-8', 0, Math.min(resBuffer.length, 500))
    const errorPatterns = [
      'AUTHENTICATION_DIVERTED_MIGRATION',
      'AUTHENTICATION_FAILED',
      'INVALID_SESSION',
      'NOT_AUTHORIZED',
      'ABUSE_BLOCK',
      'NOT_FOUND',
      'INTERNAL_ERROR',
      'E_ILLEGAL_ARGUMENT',
    ]
    const foundError = errorPatterns.find(p => bodyStr.includes(p))
    if (foundError) {
      console.error(`[unofficial] ❌ Thrift error: ${foundError}`)
      return { success: false, error: `LINE error: ${foundError}` }
    }

    // Check TCompact header for EXCEPTION type
    if (resBuffer.length >= 3 && resBuffer[0] === 0x82) {
      const msgType = (resBuffer[1] >> 5) & 0x03
      if (msgType === 2) { // EXCEPTION
        console.error('[unofficial] ❌ Thrift EXCEPTION')
        return { success: false, error: `Thrift EXCEPTION: ${bodyStr.slice(0, 200)}` }
      }
    }

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` }
    }

    // ─── Delivery Proof Validation ─────────────────────
    // Success response should contain:
    // 1. Thrift REPLY type (msgType=1) in header
    // 2. Response body > 10 bytes (contains message struct back)
    // 3. The 'to' MID echoed back in response
    const isReply = resBuffer.length >= 3 && resBuffer[0] === 0x82 &&
      (((resBuffer[1] >> 5) & 0x03) === 1)
    const hasContent = resBuffer.length > 10
    const echoedMid = bodyStr.includes(to.slice(-10))

    if (!isReply) {
      console.warn(`[unofficial] ⚠️ Response is not REPLY type (${resBuffer.length}b)`)
      return { success: false, error: 'No REPLY in response — message may not be delivered' }
    }

    if (!hasContent) {
      console.warn(`[unofficial] ⚠️ Response too short (${resBuffer.length}b)`)
      return { success: false, error: 'Response too short — no delivery proof' }
    }

    console.log(`[unofficial] ✅ Sent to ${to.slice(-8)} (${resBuffer.length}b, reply=${isReply}, echo=${echoedMid})`)
    return { success: true, via: 'unofficial', proof: { bytes: resBuffer.length, reply: isReply, echo: echoedMid } }
  } catch (err) {
    const errMsg = err.name === 'AbortError' ? 'Timeout (15s)' : err.message
    return { success: false, error: `Unofficial: ${errMsg}` }
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

    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { success: false, error: `Official HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}` }
    }
    // LINE official API returns {} on success, error body on failure
    if (body.message) {
      return { success: false, error: `Official: ${body.message}` }
    }
    console.log(`[official] ✅ Sent to ${to.slice(-8)}`)
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

// ─── Get Groups (ดึงรายการกลุ่มจาก LINE) ────────────────

function buildGetGroupsThrift() {
  // TalkService.getGroupIdsJoined() — method to get list of group MIDs
  const parts = []
  parts.push(Buffer.from([0x82, 0x21, 0x01])) // protocol=compact, version=1, type=CALL
  parts.push(writeString('getGroupIdsJoined'))
  parts.push(writeUVarint(0)) // seqid
  parts.push(Buffer.from([0x00])) // end args
  return Buffer.concat(parts)
}

function buildGetGroupThrift(groupId) {
  // TalkService.getGroup(2: string groupMid)
  const parts = []
  parts.push(Buffer.from([0x82, 0x21, 0x01]))
  parts.push(writeString('getGroup'))
  parts.push(writeUVarint(0))
  // Field 2: groupMid (string) - field id 2, type 8
  parts.push(Buffer.from([0x28])) // delta=2, type=8
  parts.push(writeString(groupId))
  parts.push(Buffer.from([0x00])) // end args
  return Buffer.concat(parts)
}

// Extract strings from Thrift binary response
function extractStringsFromThrift(buf) {
  const strings = []
  let i = 0
  while (i < buf.length - 1) {
    // Look for string-like patterns: length byte(s) followed by printable chars
    // Group MIDs are 33 chars starting with 'c'
    if (buf[i] === 0x21 || buf[i] === 33) { // length 33
      const str = buf.toString('utf-8', i + 1, i + 1 + 33)
      if (/^c[0-9a-f]{32}$/.test(str)) {
        strings.push(str)
        i += 34
        continue
      }
    }
    i++
  }
  // Also try varint-encoded lengths
  i = 0
  while (i < buf.length) {
    // Check for 'c' followed by hex chars (group MID pattern)
    if (buf[i] === 0x63) { // 'c'
      const str = buf.toString('utf-8', i, i + 33)
      if (/^c[0-9a-f]{32}$/.test(str) && !strings.includes(str)) {
        strings.push(str)
      }
    }
    i++
  }
  return strings
}

// Extract group name from getGroup response
function extractGroupName(buf) {
  // Group name is typically in field 2 (name) of Group struct
  // Look for readable Thai/English text strings
  const str = buf.toString('utf-8')
  // Find strings between readable boundaries
  const matches = str.match(/[\u0E00-\u0E7F\w\s]{2,50}/g) || []
  // Filter out method names and common patterns
  return matches.find(m =>
    !m.includes('getGroup') &&
    !m.includes('sendMessage') &&
    m.length > 1
  ) || null
}

app.get('/groups', async (req, res) => {
  if (!checkAuth(req, res)) return

  if (!LINE_AUTH_TOKEN) {
    return res.status(400).json({ success: false, error: 'No unofficial token' })
  }

  try {
    // Step 1: Get list of group MIDs
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 15000)

    const groupsRes = await fetch(LINE_THRIFT_API + '/S4', {
      method: 'POST',
      headers: {
        ...LINE_APP_HEADER,
        'X-Line-Access': LINE_AUTH_TOKEN,
        'Content-Type': 'application/x-thrift',
        'Accept': 'application/x-thrift',
      },
      body: buildGetGroupsThrift(),
      signal: controller.signal,
    })

    const buf = Buffer.from(await groupsRes.arrayBuffer())
    const groupIds = extractStringsFromThrift(buf)

    console.log(`[groups] Found ${groupIds.length} groups:`, groupIds)

    // Step 2: Get name for each group
    const groups = []
    for (const gid of groupIds) {
      try {
        const ctrl = new AbortController()
        setTimeout(() => ctrl.abort(), 10000)

        const gRes = await fetch(LINE_THRIFT_API + '/S4', {
          method: 'POST',
          headers: {
            ...LINE_APP_HEADER,
            'X-Line-Access': LINE_AUTH_TOKEN,
            'Content-Type': 'application/x-thrift',
            'Accept': 'application/x-thrift',
          },
          body: buildGetGroupThrift(gid),
          signal: ctrl.signal,
        })

        const gBuf = Buffer.from(await gRes.arrayBuffer())
        const name = extractGroupName(gBuf)
        groups.push({ id: gid, name: name || '(unknown)' })
      } catch {
        groups.push({ id: gid, name: '(error fetching name)' })
      }
    }

    res.json({ success: true, count: groups.length, groups })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── Test Page (เปิดจาก browser มือถือ) ─────────────────

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
.btn-send:disabled{background:#555;color:#999}
#result{margin-top:12px;padding:12px;border-radius:8px;font-size:14px;display:none;word-break:break-all}
.ok{background:#1b4332;border:1px solid #22a867}
.fail{background:#3d0000;border:1px solid #dc3545}
.loading{background:#1a1a2e;border:1px solid #e89b1c;color:#e89b1c}
</style></head><body>
<h2>🧪 LottoBot Unofficial Test</h2>

<div class="card">
  <div class="status"><div class="dot ${tokenStatus.expired ? 'red' : 'green'}"></div>
    <span>Token: ${tokenStatus.expired ? '❌ หมดอายุ' : '✅ ใช้ได้ (' + Math.floor(tokenStatus.expiresIn / 3600) + 'h)'}</span></div>
  <div class="status"><div class="dot ${LINE_AUTH_TOKEN ? 'green' : 'red'}"></div>
    <span>Unofficial: ${LINE_AUTH_TOKEN ? '✅' : '❌'}</span></div>
  <div class="status"><div class="dot ${LINE_CHANNEL_TOKEN ? 'green' : 'yellow'}"></div>
    <span>Official fallback: ${LINE_CHANNEL_TOKEN ? '✅' : '⚠️ ไม่มี'}</span></div>
</div>

<div class="card">
  <button class="btn-send" style="background:#c9a84c" onclick="loadGroups()">📋 ดึงรายการกลุ่ม LINE</button>
  <div id="groups" style="margin-top:8px"></div>
</div>

<div class="card">
  <label>Group MID (to)</label>
  <input id="to" placeholder="กดดึงรายการกลุ่มด้านบน แล้วกดเลือก" />
  <label>ข้อความ</label>
  <textarea id="text">🧪 ทดสอบ LottoBot unofficial</textarea>
  <button class="btn-send" onclick="testSend()">📤 ส่งทดสอบ</button>
  <div id="result"></div>
</div>

<script>
async function loadGroups() {
  const btn = event.target
  const div = document.getElementById('groups')
  btn.disabled = true; btn.textContent = '⏳ กำลังดึง...'
  div.innerHTML = '<p style="color:#e89b1c;font-size:13px">กำลังดึงกลุ่มจาก LINE... (อาจใช้เวลา 10-30 วินาที)</p>'
  try {
    const res = await fetch('/groups')
    const data = await res.json()
    if (data.groups && data.groups.length > 0) {
      div.innerHTML = data.groups.map(g =>
        '<div style="background:#0f3460;border-radius:8px;padding:10px;margin:6px 0;cursor:pointer" onclick="selectGroup(\\'' + g.id + '\\')">' +
        '<div style="font-weight:600">' + (g.name || '?') + '</div>' +
        '<div style="font-size:11px;color:#aaa;font-family:monospace;word-break:break-all">' + g.id + '</div></div>'
      ).join('')
    } else {
      div.innerHTML = '<p style="color:#dc3545">ไม่พบกลุ่ม — บัญชีนี้อาจไม่ได้อยู่ในกลุ่มใดๆ</p>'
    }
  } catch (e) {
    div.innerHTML = '<p style="color:#dc3545">❌ ' + e.message + '</p>'
  }
  btn.disabled = false; btn.textContent = '📋 ดึงรายการกลุ่ม LINE'
}

function selectGroup(id) {
  document.getElementById('to').value = id
}

async function testSend() {
  const to = document.getElementById('to').value.trim()
  const text = document.getElementById('text').value.trim()
  const btn = document.querySelector('.btn-send:last-of-type')
  const result = document.getElementById('result')
  if (!to || !text) { alert('กรอก MID + ข้อความ'); return }
  btn.disabled = true; btn.textContent = '⏳ กำลังส่ง...'
  result.style.display = 'block'; result.className = 'loading'; result.textContent = 'กำลังส่ง...'
  try {
    const res = await fetch('/debug-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, text })
    })
    const data = await res.json()
    if (data.sendResult?.success) {
      result.className = 'ok'
      result.innerHTML = '✅ ส่งสำเร็จ!<br>via: ' + (data.sendResult.via || 'unofficial') +
        '<br>toType: ' + data.diagnostics?.toTypeLabel
    } else {
      result.className = 'fail'
      result.innerHTML = '❌ ส่งไม่สำเร็จ<br>error: ' + (data.sendResult?.error || JSON.stringify(data))
    }
  } catch (e) {
    result.className = 'fail'; result.textContent = '❌ ' + e.message
  }
  btn.disabled = false; btn.textContent = '📤 ส่งทดสอบ'
}
</script>
</body></html>`)
})

// ─── Health ──────────────────────────────────────────────

app.get('/health', (_req, res) => {
  const tokenStatus = getTokenExpiry()
  res.json({
    ok: true,
    service: 'lottobot-unofficial-endpoint',
    hasAuthToken: !!AUTH_TOKEN,
    hasLineToken: !!LINE_CHANNEL_TOKEN,
    hasUnofficialToken: !!LINE_AUTH_TOKEN,
    mode: LINE_AUTH_TOKEN ? 'unofficial (primary)' : 'official only',
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

// Manual refresh
app.post('/refresh', async (req, res) => {
  if (!checkAuth(req, res)) return
  const result = await refreshTokenIfNeeded()
  res.json(result)
})

// ─── Update token (สำหรับกรณีต้องเปลี่ยน token ใหม่) ────

app.post('/update-token', (req, res) => {
  if (!checkAuth(req, res)) return
  const { token } = req.body || {}
  if (!token) return res.status(400).json({ success: false, error: 'token is required' })

  LINE_AUTH_TOKEN = token
  const expiry = getTokenExpiry()
  console.log(`[update-token] Token updated! Expires: ${expiry.expiresAt}`)
  res.json({ success: true, expiry })
})

// ─── Debug: test send + diagnostics ─────────────────────

app.post('/debug-send', async (req, res) => {
  // No auth required — diagnostic endpoint for /test page

  const { to, text } = req.body || {}
  if (!to) return res.status(400).json({ error: 'to is required' })

  const testText = text || `🧪 LottoBot test ${new Date().toLocaleString('th-TH')}`
  const tokenStatus = getTokenExpiry()
  const toType = getMidType(to)

  console.log(`[debug-send] to=${to}, toType=${toType}, tokenExpired=${tokenStatus.expired}`)

  const result = await sendViaUnofficial(to, testText)

  res.json({
    sendResult: result,
    diagnostics: {
      to: to.slice(-8),
      toType,
      toTypeLabel: ['USER', 'ROOM', 'GROUP'][toType] || 'UNKNOWN',
      tokenExpired: tokenStatus.expired,
      tokenExpiresAt: tokenStatus.expiresAt,
      tokenExpiresIn: `${Math.floor(tokenStatus.expiresIn / 3600)}h`,
    },
  })
})

// ─── Send endpoint ───────────────────────────────────────

app.post('/send', async (req, res) => {
  if (!checkAuth(req, res)) return

  const { mode, to, officialTo, text, imageUrl } = req.body || {}
  if (!mode) return res.status(400).json({ success: false, error: 'mode is required' })

  const officialGroupId = officialTo || to

  if (mode === 'push_text') {
    if (!to || !text) return res.status(400).json({ success: false, error: 'push_text requires: to, text' })

    // 1. Try unofficial (Thrift) — primary
    if (LINE_AUTH_TOKEN) {
      const result = await sendViaUnofficial(to, text)
      if (result.success) return res.json(result)
      console.warn('[send] unofficial failed:', result.error, '→ fallback official')
    }

    // 2. Fallback to official
    if (LINE_CHANNEL_TOKEN && officialGroupId) {
      const result = await sendViaOfficial(officialGroupId, [{ type: 'text', text }])
      return result.success ? res.json(result) : res.status(502).json(result)
    }

    return res.status(502).json({ success: false, error: 'No working LINE credentials' })
  }

  if (mode === 'push_image_text') {
    if (!to || !imageUrl || !text) return res.status(400).json({ success: false, error: 'push_image_text requires: to, imageUrl, text' })

    // 1. Try unofficial (text only)
    if (LINE_AUTH_TOKEN) {
      const result = await sendViaUnofficial(to, text)
      if (result.success) return res.json(result)
      console.warn('[send] unofficial failed:', result.error, '→ fallback official')
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
  console.log(`  mode: ${LINE_AUTH_TOKEN ? 'UNOFFICIAL (primary)' : 'Official only'}`)
  console.log(`  unofficial token: ${LINE_AUTH_TOKEN ? 'YES' : 'NO'}`)
  console.log(`  official token: ${LINE_CHANNEL_TOKEN ? 'YES' : 'NO'}`)
})
