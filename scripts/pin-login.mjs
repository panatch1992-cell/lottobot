/**
 * LINE PIN Login — Node.js (raw Thrift compact protocol)
 *
 * ล็อกอินด้วย email/password → PIN verify → ได้ authToken
 * Usage: node scripts/pin-login.mjs
 */

import { createInterface } from 'readline'

const LINE_API = 'https://gd2.line.naver.jp'
const APP_HEADER = {
  'User-Agent': 'Line/13.4.2',
  'X-Line-Application': 'DESKTOPWIN\t13.4.2\tWindows\t10.0',
  'X-Line-Carrier': 'wifi',
  'Content-Type': 'application/x-thrift',
  'Accept': 'application/x-thrift',
}

// ─── Thrift Compact Protocol Helpers ─────────────────

function writeVarint(value) {
  const bytes = []
  value = (value << 1) ^ (value >> 31)
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

function writeBool(val) {
  return Buffer.from([val ? 0x01 : 0x02])
}

// ─── Build loginZ Thrift payload ─────────────────────
// AuthService.loginZ(2: LoginRequest loginRequest)
// LoginRequest fields:
//   1: i32 e2eeVersion
//   2: i32 type (1=ID_CREDENTIAL)
//   3: i32 identityProvider (1=LINE)
//   4: string identifier (email)
//   5: string password
//   6: bool keepLoggedIn
//   7: string accessLocation
//   8: string systemName
//   9: string certificate
//  10: string verifier

function buildLoginRequest(email, password, certificate = '', verifier = '') {
  const parts = []

  // Method header: loginZ
  parts.push(Buffer.from([0x82, 0x21, 0x01])) // compact, version=1, CALL
  parts.push(writeString('loginZ'))
  parts.push(writeUVarint(0)) // seqid

  // Args field 2: loginRequest (struct) - delta=2, type=12(struct)
  parts.push(Buffer.from([0x2c]))

  // LoginRequest fields:
  // field 1: e2eeVersion (i32) = 0, delta=1, type=5
  parts.push(Buffer.from([0x15]))
  parts.push(writeVarint(0))

  // field 2: type (i32) = 1 (ID_CREDENTIAL), delta=1, type=5
  parts.push(Buffer.from([0x15]))
  parts.push(writeVarint(1))

  // field 3: identityProvider (i32) = 1 (LINE), delta=1, type=5
  parts.push(Buffer.from([0x15]))
  parts.push(writeVarint(1))

  // field 4: identifier (string) = email, delta=1, type=8
  parts.push(Buffer.from([0x18]))
  parts.push(writeString(email))

  // field 5: password (string), delta=1, type=8
  parts.push(Buffer.from([0x18]))
  parts.push(writeString(password))

  // field 6: keepLoggedIn (bool) = true, delta=1, type=1(true)
  parts.push(Buffer.from([0x11])) // delta=1, type=1 (bool true)

  // field 7: accessLocation (string), delta=1, type=8
  parts.push(Buffer.from([0x18]))
  parts.push(writeString('127.0.0.1'))

  // field 8: systemName (string), delta=1, type=8
  parts.push(Buffer.from([0x18]))
  parts.push(writeString('LottoBot'))

  // field 9: certificate (string), delta=1, type=8
  if (certificate) {
    parts.push(Buffer.from([0x18]))
    parts.push(writeString(certificate))
  } else {
    parts.push(Buffer.from([0x18]))
    parts.push(writeString(''))
  }

  // field 10: verifier (string), delta=1, type=8
  if (verifier) {
    parts.push(Buffer.from([0x18]))
    parts.push(writeString(verifier))
  }

  // End LoginRequest struct
  parts.push(Buffer.from([0x00]))
  // End args struct
  parts.push(Buffer.from([0x00]))

  return Buffer.concat(parts)
}

// Build confirmVerifier request
function buildLoginWithVerifier(verifier) {
  const parts = []
  parts.push(Buffer.from([0x82, 0x21, 0x01]))
  parts.push(writeString('loginZ'))
  parts.push(writeUVarint(0))

  // Args field 2: loginRequest (struct)
  parts.push(Buffer.from([0x2c]))

  // field 1: e2eeVersion = 0
  parts.push(Buffer.from([0x15]))
  parts.push(writeVarint(0))

  // field 2: type = 1
  parts.push(Buffer.from([0x15]))
  parts.push(writeVarint(1))

  // field 10: verifier (field id 10, from field 2 delta=8, type=8)
  // Use absolute field encoding for jump > 15
  parts.push(Buffer.from([0x08])) // type=8(string), delta=0 means full field header follows
  parts.push(writeVarint(10)) // field id in zigzag

  // Wait... let me use a different approach: skip fields 3-9 and write field 10 directly
  // Actually for compact protocol, if delta > 15, we write: 0x08 then field_id as i16
  // But simpler: just write all fields

  parts.push(writeString(verifier))

  parts.push(Buffer.from([0x00]))
  parts.push(Buffer.from([0x00]))

  return Buffer.concat(parts)
}

// ─── Parse Thrift Response ───────────────────────────

function extractStrings(buf) {
  const strings = []
  let i = 0
  while (i < buf.length - 2) {
    // Look for string patterns
    const len = buf[i]
    if (len > 0 && len < 200 && i + 1 + len <= buf.length) {
      const candidate = buf.toString('utf-8', i + 1, i + 1 + len)
      if (/^[\x20-\x7e\u0E00-\u0E7F]+$/.test(candidate) && candidate.length > 3) {
        strings.push(candidate)
      }
    }
    i++
  }
  return strings
}

function findToken(buf) {
  const str = buf.toString('utf-8')
  const match = str.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
  return match ? match[0] : null
}

function findPinCode(strings) {
  for (const s of strings) {
    if (/^\d{6}$/.test(s)) return s
  }
  return null
}

function findVerifier(buf) {
  const strings = extractStrings(buf)
  // Verifier is usually a long hex or base64 string
  for (const s of strings) {
    if (s.length > 40 && s.length < 300 && /^[A-Za-z0-9+/=_-]+$/.test(s)) {
      return s
    }
  }
  return null
}

function findError(buf) {
  const str = buf.toString('utf-8', 0, Math.min(buf.length, 500))
  const errors = [
    'AUTHENTICATION_FAILED', 'INVALID_IDENTITY_CREDENTIAL',
    'NOT_FOUND', 'ABUSE_BLOCK', 'INTERNAL_ERROR',
    'INVALID_SESSION', 'AUTHENTICATION_DIVERTED_MIGRATION',
  ]
  return errors.find(e => str.includes(e)) || null
}

// ─── Readline helper ─────────────────────────────────

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

// ─── Main Login Flow ─────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════')
  console.log('  🔑 LINE PIN Login (LottoBot)')
  console.log('═══════════════════════════════════════')
  console.log()

  const email = process.argv[2] || await ask('📧 Email: ')
  const password = process.argv[3] || await ask('🔑 Password: ')

  if (!email || !password) {
    console.log('❌ กรุณาใส่ email และ password')
    process.exit(1)
  }

  console.log()
  console.log('⏳ กำลัง login...')

  // Step 1: Send login request
  const loginPayload = buildLoginRequest(email, password)

  const res = await fetch(LINE_API + '/RS4', {
    method: 'POST',
    headers: APP_HEADER,
    body: loginPayload,
  })

  const resBuf = Buffer.from(await res.arrayBuffer())

  // Check for errors
  const error = findError(resBuf)
  if (error) {
    console.log(`❌ Login ไม่สำเร็จ: ${error}`)
    console.log()
    if (error === 'AUTHENTICATION_FAILED' || error === 'INVALID_IDENTITY_CREDENTIAL') {
      console.log('💡 ตรวจสอบ email และ password ว่าถูกต้อง')
    }
    process.exit(1)
  }

  // Check if we got a token directly
  const directToken = findToken(resBuf)
  if (directToken) {
    console.log('✅ Login สำเร็จ! (ไม่ต้อง PIN)')
    console.log()
    console.log('─────────────────────────────────')
    console.log('AUTH TOKEN:')
    console.log(directToken)
    console.log('─────────────────────────────────')
    process.exit(0)
  }

  // Need PIN verification
  const allStrings = extractStrings(resBuf)
  const pinCode = findPinCode(allStrings)
  const verifier = findVerifier(resBuf)

  if (pinCode) {
    console.log()
    console.log('╔═══════════════════════════════════╗')
    console.log(`║     PIN: ${pinCode}                    ║`)
    console.log('║  👆 กรุณาเปิด LINE app แล้วกด     ║')
    console.log('║     verify ที่มือถือ               ║')
    console.log('╚═══════════════════════════════════╝')
    console.log()
  } else {
    console.log('⚠️ ไม่พบ PIN code ใน response')
    console.log('Response strings:', allStrings.slice(0, 10))
  }

  if (!verifier) {
    console.log('❌ ไม่พบ verifier — login flow ไม่สมบูรณ์')
    console.log('Response size:', resBuf.length, 'bytes')
    process.exit(1)
  }

  console.log('⏳ รอ verify ที่มือถือ... (timeout 120 วินาที)')

  // Step 2: Poll with verifier until token is received
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000))

    try {
      const verifyPayload = buildLoginWithVerifier(verifier)
      const verifyRes = await fetch(LINE_API + '/RS4', {
        method: 'POST',
        headers: APP_HEADER,
        body: verifyPayload,
        signal: AbortSignal.timeout(10000),
      })

      const verifyBuf = Buffer.from(await verifyRes.arrayBuffer())
      const token = findToken(verifyBuf)

      if (token) {
        console.log()
        console.log('✅ Login สำเร็จ!')
        console.log()
        console.log('═══════════════════════════════════════')
        console.log('AUTH TOKEN:')
        console.log(token)
        console.log('═══════════════════════════════════════')
        console.log()
        console.log('📋 วิธีใช้:')
        console.log('  1. ไป Render Dashboard → Environment')
        console.log('  2. อัพเดท LINE_AUTH_TOKEN = <token ด้านบน>')
        console.log('  3. Manual Deploy')
        process.exit(0)
      }

      const verifyError = findError(verifyBuf)
      if (verifyError && verifyError !== 'AUTHENTICATION_FAILED') {
        console.log(`❌ Error: ${verifyError}`)
        break
      }
    } catch {
      // timeout — keep polling
    }

    process.stdout.write('.')
  }

  console.log()
  console.log('❌ Timeout — ไม่ได้ verify ภายใน 120 วินาที')
  process.exit(1)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
