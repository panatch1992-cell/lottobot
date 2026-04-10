'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { LineGroup } from '@/types'

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin text-3xl">⚙️</div></div>}>
      <SettingsContent />
    </Suspense>
  )
}

function SettingsContent() {
  const searchParams = useSearchParams()
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [groups, setGroups] = useState<LineGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [systemCheck, setSystemCheck] = useState<{ overall: string; checks: { name: string; status: string; detail: string }[] } | null>(null)
  const [checking, setChecking] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [setupResult, setSetupResult] = useState<{ success: boolean; steps: { step: string; status: string; detail: string }[]; summary?: string; pinCode?: string; sessionId?: string } | null>(null)
  const [settingUp, setSettingUp] = useState(false)

  useEffect(() => { loadSettings() }, [searchParams])

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      const map: Record<string, string> = {}
      ;(data.settings || []).forEach((s: { key: string; value: string }) => { map[s.key] = s.value })
      setSettings(map)
      setGroups(data.groups || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  async function saveSetting(key: string, value: string) {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      setSettings(prev => ({ ...prev, [key]: value }))
    } catch { /* ignore */ }
    setSaving(false)
  }

  async function saveMultiple(pairs: { key: string; value: string }[]) {
    setSaving(true)
    setStatus('')
    for (const { key, value } of pairs) {
      if (!value.trim()) continue
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      }).catch(() => {})
      setSettings(prev => ({ ...prev, [key]: value }))
    }
    setSaving(false)
    setStatus('✅ บันทึกเรียบร้อย')
    setTimeout(() => setStatus(''), 3000)
  }

  async function toggleGroup(id: string, current: boolean) {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_group', id, is_active: !current }),
    })
    setGroups(prev => prev.map(g => g.id === id ? { ...g, is_active: !current } : g))
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin text-3xl">⚙️</div></div>
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">⚙️ ตั้งค่า</h2>

      {/* ═══ 1. ตรวจสอบระบบ ═══ */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">🔍 ตรวจสอบระบบ</h3>
          {systemCheck && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              systemCheck.overall === 'ok' ? 'bg-green-100 text-green-700'
                : systemCheck.overall === 'warn' ? 'bg-amber-100 text-amber-700'
                : 'bg-red-100 text-red-700'
            }`}>
              {systemCheck.overall === 'ok' ? '✅ พร้อมใช้งาน' : systemCheck.overall === 'warn' ? '⚠️ มีข้อสังเกต' : '❌ มีปัญหา'}
            </span>
          )}
        </div>

        <button
          onClick={async () => {
            setChecking(true)
            setSystemCheck(null)
            try {
              const res = await fetch(`/api/system-check?t=${Date.now()}`)
              setSystemCheck(await res.json())
            } catch {
              setSystemCheck({ overall: 'error', checks: [{ name: 'ระบบ', status: 'error', detail: 'เรียก API ไม่ได้' }] })
            }
            setChecking(false)
          }}
          disabled={checking}
          className="btn-primary text-sm w-full disabled:opacity-50"
        >
          {checking ? '🔍 กำลังตรวจสอบ...' : '🔍 ตรวจสอบระบบทั้งหมด'}
        </button>

        {systemCheck && (
          <div className="space-y-1.5">
            {systemCheck.checks.map((c, i) => (
              <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
                c.status === 'ok' ? 'bg-green-50' : c.status === 'warn' ? 'bg-amber-50' : 'bg-red-50'
              }`}>
                <span className="shrink-0 mt-0.5">{c.status === 'ok' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'}</span>
                <div className="min-w-0">
                  <span className="font-medium">{c.name}</span>
                  <p className="text-text-secondary break-all">{c.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ 2. ตั้งค่าบัญชี LINE Bot ═══ */}
      <div className="card space-y-3">
        <h3 className="font-semibold">📱 ตั้งค่าบัญชี LINE Bot</h3>

        {/* ─── วาง Token จาก PC ─── */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
          <p className="text-sm font-medium text-amber-700">🔑 วาง Token จาก PC</p>
          <p className="text-xs text-amber-600">รัน PIN Login บน PC → copy token → วางที่นี่ → ระบบอัพเดทให้อัตโนมัติ</p>
          <textarea
            value={settings._pasteToken || ''}
            onChange={e => setSettings(prev => ({ ...prev, _pasteToken: e.target.value }))}
            placeholder="วาง token ที่ได้จาก PIN Login (eyJ...)"
            className="input text-xs font-mono h-16 resize-none"
          />
          <button
            onClick={async () => {
              const token = (settings._pasteToken || '').trim()
              if (!token || !token.startsWith('eyJ')) {
                alert('❌ Token ไม่ถูกต้อง — ต้องเริ่มด้วย eyJ...')
                return
              }
              setSaving(true)
              setStatus('⏳ กำลังอัพเดท...')
              try {
                // 1. Update token on Render via /update-token
                const endpoint = settings.unofficial_line_endpoint || ''
                const authToken = settings.unofficial_line_token || ''
                if (endpoint) {
                  const updateRes = await fetch(`${endpoint}/update-token`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                    },
                    body: JSON.stringify({ token }),
                  })
                  const updateData = await updateRes.json()
                  if (!updateData.success) {
                    alert(`❌ อัพเดท Render ไม่สำเร็จ: ${updateData.error || 'unknown error'}`)
                    setSaving(false)
                    setStatus('')
                    return
                  }
                }

                // 2. Save token to DB
                await fetch('/api/settings', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ key: 'line_unofficial_auth_token', value: token }),
                })

                // 3. Sync groups
                if (endpoint) {
                  try {
                    const groupRes = await fetch(`${endpoint}/groups`, {
                      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
                    })
                    const groupData = await groupRes.json()
                    if (groupData.groups?.length > 0) {
                      setStatus(`✅ Token อัพเดทแล้ว! พบ ${groupData.groups.length} กลุ่ม — กำลัง sync...`)
                      // Sync via API
                      await fetch('/api/sync-groups', { method: 'POST' })
                    }
                  } catch { /* group sync optional */ }
                }

                setSettings(prev => ({ ...prev, _pasteToken: '', line_unofficial_auth_token: token.slice(0, 20) + '...' }))
                setStatus('✅ Token อัพเดทสำเร็จ! Render + DB อัพเดทแล้ว')
                loadSettings()
              } catch {
                alert('❌ เกิดข้อผิดพลาด')
              }
              setSaving(false)
            }}
            disabled={saving || !(settings._pasteToken || '').trim().startsWith('eyJ')}
            className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors w-full"
          >
            {saving ? '⏳ กำลังอัพเดท...' : '📋 อัพเดท Token'}
          </button>
          {status && <p className="text-xs text-center">{status}</p>}
        </div>

        <div className="relative flex items-center gap-2 my-1">
          <div className="flex-1 border-t border-gray-200"></div>
          <span className="text-xs text-text-secondary">หรือ กรอก email/password</span>
          <div className="flex-1 border-t border-gray-200"></div>
        </div>

        {(settings.line_bot_password === '***USED***' || settings.line_unofficial_auth_token) && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700">
            <p className="font-medium">✅ ตั้งค่าเรียบร้อยแล้ว</p>
            <p>บัญชี: {settings.line_bot_email || '-'} | เบอร์: {settings.line_bot_phone || '-'}</p>
            <p>Token: ได้รับแล้ว | ระบบ refresh อัตโนมัติ</p>
            <p className="text-amber-600 mt-1">💡 ถ้า token หมดอายุ/session หลุด → login ใหม่ด้านล่าง</p>
          </div>
        )}

        <div className="pt-2">
          <p className="text-xs text-text-secondary font-medium mb-2">🔑 Login ใหม่ (PIN Login)</p>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1">
          <p className="font-medium">📋 ขั้นตอน:</p>
          <p>1. กรอก Email + Password ของบัญชี LINE ด้านล่าง</p>
          <p>2. กด <b>🔑 PIN Login</b></p>
          <p>3. จะขึ้น <b>PIN 6 หลัก</b> → เปิด LINE app บนมือถือ → verify PIN</p>
          <p>4. ระบบจะเก็บ session ให้อัตโนมัติ</p>
        </div>

        <div>
          <label className="label">เบอร์โทรที่ใช้สมัคร LINE</label>
          <input
            type="tel"
            value={settings.line_bot_phone || ''}
            onChange={e => setSettings(prev => ({ ...prev, line_bot_phone: e.target.value }))}
            className="input text-sm"
            placeholder="0xx-xxx-xxxx"
          />
        </div>

        <div>
          <label className="label">Email ที่ตั้งในบัญชี LINE</label>
          <input
            type="email"
            value={settings.line_bot_email || ''}
            onChange={e => setSettings(prev => ({ ...prev, line_bot_email: e.target.value }))}
            className="input text-sm"
            placeholder="bot@example.com"
          />
        </div>

        <div>
          <label className="label">Password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={settings.line_bot_password || ''}
            onChange={e => setSettings(prev => ({ ...prev, line_bot_password: e.target.value }))}
            className="input text-sm"
            placeholder="••••••••"
          />
          <p className="text-[10px] text-text-secondary mt-0.5">Dev จะใช้เพื่อดึง Token เข้าระบบเท่านั้น</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => saveMultiple([
              { key: 'line_bot_phone', value: settings.line_bot_phone || '' },
              { key: 'line_bot_email', value: settings.line_bot_email || '' },
              { key: 'line_bot_password', value: settings.line_bot_password || '' },
            ])}
            disabled={saving}
            className="btn-primary text-sm"
          >
            {saving ? '...' : '💾 บันทึก'}
          </button>
          <button
            onClick={async () => {
              // Save first
              await saveMultiple([
                { key: 'line_bot_phone', value: settings.line_bot_phone || '' },
                { key: 'line_bot_email', value: settings.line_bot_email || '' },
                { key: 'line_bot_password', value: settings.line_bot_password || '' },
              ])
              // Start PIN login
              setSettingUp(true)
              setSetupResult(null)
              try {
                const res = await fetch('/api/line/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email: settings.line_bot_email,
                    password: settings.line_bot_password,
                  }),
                })
                const data = await res.json()

                if (data.success && data.needPin) {
                  // Show PIN and start polling
                  setSetupResult({
                    success: false,
                    steps: [
                      { step: 'Login', status: 'ok', detail: `ส่ง request แล้ว` },
                      { step: 'PIN', status: 'ok', detail: data.pinCode ? `PIN: ${data.pinCode} — เปิด LINE app แล้วกด verify` : 'เปิด LINE app แล้วกด verify' },
                    ],
                    pinCode: data.pinCode,
                    sessionId: data.sessionId,
                  })

                  // Poll for result
                  const sessionId = data.sessionId
                  for (let i = 0; i < 40; i++) {
                    await new Promise(r => setTimeout(r, 3000))
                    try {
                      const checkRes = await fetch(`/api/line/login?session=${sessionId}`)
                      const checkData = await checkRes.json()
                      if (checkData.status === 'success') {
                        setSetupResult({
                          success: true,
                          steps: [
                            { step: 'Login', status: 'ok', detail: 'สำเร็จ' },
                            { step: 'Token', status: 'ok', detail: `ได้รับแล้ว (หมดอายุ: ${checkData.expiry?.expiresAt?.slice(0, 10) || '?'})` },
                            { step: 'Sync กลุ่ม', status: 'ok', detail: 'อัพเดทแล้ว' },
                          ],
                          summary: '✅ Login สำเร็จ! Token + กลุ่มอัพเดทเรียบร้อย',
                        })
                        loadSettings()
                        break
                      }
                      if (checkData.status === 'timeout') {
                        setSetupResult({
                          success: false,
                          steps: [
                            { step: 'Login', status: 'ok', detail: 'ส่ง request แล้ว' },
                            { step: 'PIN', status: 'fail', detail: 'หมดเวลา — ไม่ได้ verify ที่ LINE app' },
                          ],
                        })
                        break
                      }
                    } catch { break }
                  }
                } else if (data.success && !data.needPin) {
                  // Direct login (no PIN needed)
                  setSetupResult({
                    success: true,
                    steps: [
                      { step: 'Login', status: 'ok', detail: 'สำเร็จ (ไม่ต้อง PIN)' },
                      { step: 'Token', status: 'ok', detail: 'ได้รับแล้ว' },
                    ],
                    summary: '✅ Login สำเร็จ!',
                  })
                  loadSettings()
                } else {
                  setSetupResult({
                    success: false,
                    steps: [
                      { step: 'Login', status: 'fail', detail: data.error || data.hint || 'ไม่สำเร็จ' },
                      ...(data.debug ? [{ step: 'Debug', status: 'fail' as const, detail: `${data.debug.responseSize}B, ${data.debug.stringsFound} strings: ${(data.debug.strings || []).join(', ')}` }] : []),
                    ],
                  })
                }
              } catch {
                setSetupResult({
                  success: false,
                  steps: [{ step: 'เชื่อมต่อ', status: 'fail', detail: 'ไม่สามารถเชื่อมต่อ API ได้' }],
                })
              }
              setSettingUp(false)
            }}
            disabled={settingUp || !settings.line_bot_email || !settings.line_bot_password}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {settingUp ? '⏳ กำลังตั้งค่า...' : '🔑 PIN Login'}
          </button>
          {status && <span className="text-xs">{status}</span>}
        </div>

        {/* PIN Login Progress */}
        {settingUp && !setupResult?.pinCode && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
            <p className="font-medium mb-1">⏳ กำลัง login...</p>
            <p>กำลังส่ง request ไป LINE server...</p>
          </div>
        )}

        {/* PIN Display */}
        {setupResult?.pinCode && !setupResult?.success && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 text-center">
            <p className="text-sm font-medium text-amber-700 mb-2">📱 เปิด LINE app บนมือถือ</p>
            <div className="bg-white rounded-xl py-4 px-6 inline-block shadow-sm border border-amber-200">
              <p className="text-xs text-gray-500 mb-1">PIN</p>
              <p className="text-4xl font-bold tracking-[0.3em] text-amber-600">{setupResult.pinCode}</p>
            </div>
            <p className="text-xs text-amber-600 mt-3 animate-pulse">⏳ รอ verify ที่ LINE app... (120 วินาที)</p>
          </div>
        )}

        {/* Setup Result */}
        {setupResult && !setupResult.pinCode && (
          <div className={`rounded-lg p-3 space-y-2 ${setupResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <p className={`font-medium text-sm ${setupResult.success ? 'text-green-700' : 'text-red-700'}`}>
              {setupResult.success ? '✅ Login สำเร็จ!' : '❌ Login ยังไม่สำเร็จ'}
            </p>
            {setupResult.summary && (
              <p className="text-xs text-text-secondary">{setupResult.summary}</p>
            )}
            <div className="space-y-1">
              {setupResult.steps.map((s: { step: string; status: string; detail: string }, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0">{s.status === 'ok' ? '✅' : s.status === 'skip' ? '⏭' : '❌'}</span>
                  <div>
                    <span className="font-medium">{s.step}</span>
                    <span className="text-text-secondary"> — {s.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Login success replaces PIN display */}
        {setupResult?.success && setupResult?.pinCode && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-1">
            <p className="font-medium text-sm text-green-700">✅ Login สำเร็จ!</p>
            {setupResult.summary && <p className="text-xs text-green-600">{setupResult.summary}</p>}
            <div className="space-y-1">
              {setupResult.steps.map((s: { step: string; status: string; detail: string }, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0">✅</span>
                  <div><span className="font-medium">{s.step}</span> — <span className="text-green-600">{s.detail}</span></div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* ═══ 3. กลุ่ม LINE ═══ */}
      <div className="card space-y-3">
        <h3 className="font-semibold">👥 กลุ่ม LINE ({groups.filter(g => g.is_active).length}/{groups.length})</h3>
        <p className="text-xs text-text-secondary">กลุ่มจะเพิ่มอัตโนมัติเมื่อเชิญ Bot เข้ากลุ่ม</p>

        {groups.filter(g => g.is_active).length > 15 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
            <p className="font-medium">⚠️ เปิดใช้เกิน 15 กลุ่ม!</p>
            <p>แนะนำไม่เกิน 10-15 กลุ่มต่อ 1 บัญชี Bot เพื่อป้องกันโดนแบน</p>
            <p>ถ้ามีกลุ่มมากกว่านี้ → สมัครบัญชี LINE Bot เพิ่ม</p>
          </div>
        )}
        {groups.filter(g => g.is_active).length > 10 && groups.filter(g => g.is_active).length <= 15 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
            <p className="font-medium">⚠️ ใกล้ถึงขีดจำกัด ({groups.filter(g => g.is_active).length}/15 กลุ่ม)</p>
            <p>แนะนำไม่เกิน 15 กลุ่มต่อ 1 บัญชี Bot — เตรียมสมัครบัญชีเพิ่มถ้าจะเพิ่มกลุ่ม</p>
          </div>
        )}

        {groups.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-4">ยังไม่มีกลุ่ม — เชิญ Bot เข้ากลุ่ม LINE เพื่อเริ่มใช้งาน</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {groups.map(group => (
              <div key={group.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{group.name}</p>
                  <p className="text-xs text-text-secondary font-mono truncate">
                    {group.line_group_id ? `ID: ••••${group.line_group_id.slice(-8)}` : 'รอเชิญ Bot เข้ากลุ่ม'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleGroup(group.id, group.is_active)}
                    role="switch"
                    aria-checked={group.is_active}
                    className={`relative w-10 h-5 rounded-full transition-colors ${group.is_active ? 'bg-success' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${group.is_active ? 'left-5' : 'left-0.5'}`} />
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`ลบกลุ่ม "${group.name}" จริงหรือไม่?`)) return
                      await fetch('/api/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'delete_group', id: group.id }),
                      })
                      setGroups(prev => prev.filter(g => g.id !== group.id))
                    }}
                    className="text-xs text-red-400 hover:text-red-600 p-1"
                    title="ลบกลุ่ม"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ 4. วิธีส่ง LINE ═══ */}
      <div className="card space-y-3">
        <h3 className="font-semibold">📤 วิธีส่งข้อความ LINE</h3>
        <p className="text-xs text-text-secondary">เลือกวิธีส่งผลหวยเข้ากลุ่ม LINE</p>

        <div className="space-y-2">
          {[
            {
              id: 'trigger',
              label: '🎯 Trigger (แนะนำ)',
              desc: 'ส่ง "." ผ่านบัญชี LINE → OA ตอบกลับผลหวย (Reply API ฟรี 100%! ไม่จำกัด)',
              badge: 'ฟรี!',
              badgeColor: 'bg-green-100 text-green-700',
            },
            {
              id: 'push',
              label: '📨 Push (ส่งตรง)',
              desc: 'ส่งข้อความตรงไปกลุ่มผ่าน Unofficial API (ไม่จำกัด แต่เสี่ยงโดนแบน)',
              badge: 'เดิม',
              badgeColor: 'bg-gray-100 text-gray-600',
            },
            {
              id: 'broadcast',
              label: '📢 Broadcast',
              desc: 'ส่งถึงเพื่อนทุกคนผ่าน Official API (จำกัด quota)',
              badge: 'quota',
              badgeColor: 'bg-amber-100 text-amber-700',
            },
          ].map(mode => (
            <button
              key={mode.id}
              onClick={() => saveSetting('line_send_mode', mode.id)}
              className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                (settings.line_send_mode || 'push') === mode.id
                  ? 'border-gold bg-gold/5 shadow-sm' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{mode.label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${mode.badgeColor}`}>{mode.badge}</span>
              </div>
              <p className="text-xs text-text-secondary mt-1">{mode.desc}</p>
            </button>
          ))}
        </div>

        {(settings.line_send_mode || 'push') === 'trigger' && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700 space-y-1">
            <p className="font-medium">✅ โหมด Trigger เปิดใช้งาน</p>
            <p>Flow: ผลหวยมา → ส่ง &quot;.&quot; เข้ากลุ่ม → LINE OA ตอบกลับผลหวย</p>
            <p>⚡ Reply API ฟรี 100% ไม่จำกัดจำนวน!</p>
            <button
              onClick={async () => {
                try {
                  const res = await fetch('/api/line/trigger?test=1')
                  const data = await res.json()
                  alert(data.success
                    ? `✅ Trigger สำเร็จ! ส่ง ${data.sent}/${data.groups} กลุ่ม`
                    : `❌ ${data.error || 'trigger failed'}`)
                } catch {
                  alert('❌ ไม่สามารถเชื่อมต่อได้')
                }
              }}
              className="mt-2 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
            >
              🧪 ทดสอบ Trigger
            </button>
          </div>
        )}
      </div>

      {/* ═══ 5. สไตล์รูปตัวเลข ═══ */}
      <div className="card space-y-3">
        <h3 className="font-semibold">🎨 สไตล์รูปตัวเลข</h3>

        {/* ธีม */}
        <div>
          <label className="label">ธีม</label>
          <div className="grid grid-cols-4 gap-2">
            {[
              { id: 'outline', label: '✍️' },
              { id: 'darkminimal', label: '🖤' },
              { id: 'shopee', label: '🎀' },
              { id: 'macaroon', label: '🧁' },
              { id: 'candy', label: '🍬' },
              { id: 'ocean', label: '🌊' },
              { id: 'gold', label: '✨' },
              { id: 'dark', label: '🌙' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => saveSetting('default_theme', t.id)}
                className={`py-2 rounded-lg border-2 text-center transition-all ${
                  (settings.default_theme || 'macaroon') === t.id
                    ? 'border-gold shadow-sm scale-105' : 'border-gray-200'
                }`}
              >
                <div className="text-xl">{t.label}</div>
                <p className="text-[9px] text-text-secondary capitalize">{t.id}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ฟอนต์ */}
        <div>
          <label className="label">ฟอนต์ตัวเลข</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'mali', label: 'มะลิ' },
              { id: 'itim', label: 'ไอติม' },
              { id: 'mitr', label: 'มิตร' },
              { id: 'kanit', label: 'คณิต' },
              { id: 'prompt', label: 'Prompt' },
              { id: 'sriracha', label: 'ศรีราชา' },
              { id: 'kodchasan', label: 'คชสาร' },
              { id: 'k2d', label: 'K2D' },
              { id: 'chonburi', label: 'ชลบุรี' },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => saveSetting('default_font_style', f.id)}
                className={`py-1.5 px-2 rounded-lg border-2 text-center text-xs transition-all ${
                  (settings.default_font_style || 'mali') === f.id
                    ? 'border-gold bg-gold/5' : 'border-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* ขนาด + เรียง */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">ขนาดตัวเลข</label>
            <div className="flex gap-2">
              {[
                { id: 's', label: 'S' },
                { id: 'm', label: 'M' },
                { id: 'l', label: 'L' },
              ].map(s => (
                <button
                  key={s.id}
                  onClick={() => saveSetting('default_digit_size', s.id)}
                  className={`flex-1 py-1.5 rounded-lg border-2 text-center text-sm font-bold transition-all ${
                    (settings.default_digit_size || 'm') === s.id
                      ? 'border-gold bg-gold/5' : 'border-gray-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">เรียงตัวเลข</label>
            <div className="flex gap-2">
              {[
                { id: 'inline', label: '🔺' },
                { id: 'horizontal', label: '➡️' },
                { id: 'vertical', label: '⬇️' },
              ].map(l => (
                <button
                  key={l.id}
                  onClick={() => saveSetting('default_layout', l.id)}
                  className={`flex-1 py-1.5 rounded-lg border-2 text-center transition-all ${
                    (settings.default_layout || 'inline') === l.id
                      ? 'border-gold bg-gold/5' : 'border-gray-200'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs text-text-secondary mb-2">ตัวอย่างรูปที่จะส่ง</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/generate-image?lottery_name=${encodeURIComponent('ตัวอย่าง')}&flag=${encodeURIComponent('🎰')}&date=${encodeURIComponent('7 เม.ย. 69')}&top_number=123&bottom_number=45&theme=${settings.default_theme || 'macaroon'}&font_style=${settings.default_font_style || 'mali'}&digit_size=${settings.default_digit_size || 'm'}&layout=${settings.default_layout || 'inline'}`}
            alt="Preview"
            className="mx-auto rounded-lg shadow-sm max-w-[280px]"
          />
        </div>
      </div>

      {/* ═══ 5. ตั้งค่าขั้นสูง (ซ่อนไว้) ═══ */}
      {/* ═══ 5. วิธีใช้งาน ═══ */}
      <div className="card space-y-2">
        <h3 className="font-semibold">📖 วิธีใช้งาน</h3>
        <div className="text-xs text-text-secondary space-y-1.5">
          <p><b>เพิ่มกลุ่ม:</b> เชิญ LINE Bot เข้ากลุ่ม → ระบบจับอัตโนมัติ</p>
          <p><b>ส่งข้อความเอง:</b> ไปที่ <a href="/messages" className="text-gold underline">ข้อความ</a> → พิมพ์ → กดส่ง</p>
          <p><b>ดูประวัติ:</b> ไปที่ <a href="/history" className="text-gold underline">ประวัติ</a> → ดูสถานะส่งสำเร็จ/ล้มเหลว</p>
          <p><b>หวยออกอัตโนมัติ:</b> ระบบดึงผลทุก 1 นาที → ส่ง TG + LINE อัตโนมัติ</p>
          <p><b>เปลี่ยนสไตล์รูป:</b> เลือกธีมด้านบน → เห็นตัวอย่างทันที</p>
        </div>
      </div>

      <button
        onClick={() => {
          if (!showAdvanced) {
            if (!confirm('⚠️ ส่วนนี้สำหรับผู้ดูแลระบบเท่านั้น\n\nการแก้ไขค่าผิดอาจทำให้ระบบหยุดทำงาน\n\nต้องการเปิดหรือไม่?')) return
          }
          setShowAdvanced(!showAdvanced)
        }}
        className="w-full text-center text-xs text-text-secondary py-2 hover:text-gold transition-colors"
      >
        {showAdvanced ? '▲ ซ่อนตั้งค่าขั้นสูง' : '🔒 ตั้งค่าขั้นสูง (สำหรับผู้ดูแลระบบ)'}
      </button>

      {showAdvanced && (
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-600">
            <p className="font-medium">⚠️ ระวัง! แก้ไขเฉพาะเมื่อได้รับคำแนะนำจาก dev</p>
            <p>การเปลี่ยนค่าในส่วนนี้อาจทำให้ระบบส่งข้อความไม่ได้</p>
          </div>

          {/* Telegram */}
          <div className="card space-y-3">
            <h3 className="font-semibold text-sm">✈️ Telegram Bot</h3>
            <div>
              <label className="label">Bot Token</label>
              <input
                type="password"
                value={settings.telegram_bot_token || ''}
                onChange={e => setSettings(prev => ({ ...prev, telegram_bot_token: e.target.value }))}
                onBlur={e => { if (e.target.value) saveSetting('telegram_bot_token', e.target.value) }}
                className="input font-mono text-xs"
                placeholder="123456789:ABCdef..."
              />
            </div>
            <div>
              <label className="label">Admin Channel ID</label>
              <input
                type="text"
                value={settings.telegram_admin_channel || ''}
                onChange={e => setSettings(prev => ({ ...prev, telegram_admin_channel: e.target.value }))}
                onBlur={e => { if (e.target.value) saveSetting('telegram_admin_channel', e.target.value) }}
                className="input font-mono text-xs"
                placeholder="-1001234567890"
              />
            </div>
          </div>

          {/* Unofficial Endpoint */}
          <div className="card space-y-3">
            <h3 className="font-semibold text-sm">🔧 Unofficial Endpoint (Render)</h3>
            <div>
              <label className="label">Endpoint URL</label>
              <input
                type="text"
                value={settings.unofficial_line_endpoint || ''}
                onChange={e => setSettings(prev => ({ ...prev, unofficial_line_endpoint: e.target.value }))}
                onBlur={e => { if (e.target.value) saveSetting('unofficial_line_endpoint', e.target.value) }}
                className="input font-mono text-xs"
                placeholder="https://lottobot-unofficial-endpoint.onrender.com"
              />
            </div>
            <div>
              <label className="label">Auth Token</label>
              <input
                type="password"
                value={settings.unofficial_line_token || ''}
                onChange={e => setSettings(prev => ({ ...prev, unofficial_line_token: e.target.value }))}
                onBlur={e => { if (e.target.value) saveSetting('unofficial_line_token', e.target.value) }}
                className="input font-mono text-xs"
                placeholder="Bearer token"
              />
            </div>
          </div>

          {/* Scraping */}
          <div className="card space-y-3">
            <h3 className="font-semibold text-sm">🤖 ดึงผลอัตโนมัติ</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">หน้าต่างเวลา (นาที)</label>
                <input
                  type="number"
                  value={settings.scrape_window_minutes || '30'}
                  onChange={e => setSettings(prev => ({ ...prev, scrape_window_minutes: e.target.value }))}
                  onBlur={e => saveSetting('scrape_window_minutes', e.target.value)}
                  className="input"
                  min="5" max="60"
                />
              </div>
              <div>
                <label className="label">Retry</label>
                <input
                  type="number"
                  value={settings.scrape_max_retries || '3'}
                  onChange={e => setSettings(prev => ({ ...prev, scrape_max_retries: e.target.value }))}
                  onBlur={e => saveSetting('scrape_max_retries', e.target.value)}
                  className="input"
                  min="1" max="10"
                />
              </div>
            </div>
          </div>

          {/* Countdown + Flow */}
          <div className="card space-y-3">
            <h3 className="font-semibold text-sm">⏰ Flow ข้อความก่อนหวยออก</h3>
            <p className="text-[11px] text-text-secondary">ระบบจะส่งอัตโนมัติตามลำดับ: 📢 รายการต่อไป → 📊 สถิติ → 🖼️ รูปสุ่ม → ⏰ เตือน 20/10/5 นาที → 🔒 ปิดรับ → 🎯 ผล</p>
            <div>
              <label className="label">🔗 ลิงก์แอดไลน์ (ท้ายข้อความ countdown)</label>
              <input
                type="text"
                value={settings.line_add_friend_link || ''}
                onChange={e => setSettings(prev => ({ ...prev, line_add_friend_link: e.target.value }))}
                className="input font-mono text-sm"
                placeholder="https://line.me/R/ti/p/@xxx"
              />
              <button onClick={() => saveSetting('line_add_friend_link', settings.line_add_friend_link || '')} className="btn-primary text-xs mt-2">💾 บันทึก</button>
            </div>
            <div>
              <label className="label">🖼️ URL เว็บรูปสุ่ม</label>
              <input
                type="text"
                value={settings.random_image_url || 'https://www.huaypnk.com/top'}
                onChange={e => setSettings(prev => ({ ...prev, random_image_url: e.target.value }))}
                className="input font-mono text-sm"
                placeholder="https://www.huaypnk.com/top"
              />
              <p className="text-[10px] text-text-secondary mt-1">ระบบจะดึงรูปจากเว็บนี้ + ส่งลิงก์ custom_link ของแต่ละกลุ่ม</p>
              <button onClick={() => saveSetting('random_image_url', settings.random_image_url || 'https://www.huaypnk.com/top')} className="btn-primary text-xs mt-2">💾 บันทึก</button>
            </div>
          </div>
        </div>
      )}

      {saving && <p className="text-xs text-text-secondary text-center">กำลังบันทึก...</p>}
    </div>
  )
}
