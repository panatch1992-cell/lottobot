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

      {/* ═══ 2. ตั้งค่าบัญชี LINE Bot (สำหรับลูกค้า) ═══ */}
      <div className="card space-y-3">
        <h3 className="font-semibold">📱 ตั้งค่าบัญชี LINE Bot</h3>
        <p className="text-xs text-text-secondary">สมัคร LINE ด้วยเบอร์ใหม่ แล้วกรอกข้อมูลด้านล่าง</p>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1">
          <p className="font-medium">📋 ขั้นตอน:</p>
          <p>1. สมัคร LINE ด้วย <b>เบอร์ใหม่</b> (อย่าใช้เบอร์ส่วนตัว)</p>
          <p>2. ตั้ง Email + Password ในบัญชี LINE</p>
          <p>3. กรอกข้อมูลด้านล่าง แล้วกด <b>บันทึก</b></p>
          <p>4. <b>เชิญบัญชีนี้เข้ากลุ่ม LINE</b> ที่ต้องการส่งผลหวย</p>
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

        <div className="flex items-center gap-2">
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
          {status && <span className="text-xs">{status}</span>}
        </div>
      </div>

      {/* ═══ 3. กลุ่ม LINE ═══ */}
      <div className="card space-y-3">
        <h3 className="font-semibold">👥 กลุ่ม LINE ({groups.filter(g => g.is_active).length}/{groups.length})</h3>
        <p className="text-xs text-text-secondary">กลุ่มจะเพิ่มอัตโนมัติเมื่อเชิญ Bot เข้ากลุ่ม</p>

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
                <button
                  onClick={() => toggleGroup(group.id, group.is_active)}
                  role="switch"
                  aria-checked={group.is_active}
                  className={`relative w-10 h-5 rounded-full transition-colors ${group.is_active ? 'bg-success' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${group.is_active ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ 4. สไตล์รูปตัวเลข ═══ */}
      <div className="card space-y-3">
        <h3 className="font-semibold">🎨 สไตล์รูปตัวเลข</h3>

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
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full text-center text-xs text-text-secondary py-2 hover:text-gold transition-colors"
      >
        {showAdvanced ? '▲ ซ่อนตั้งค่าขั้นสูง' : '▼ ตั้งค่าขั้นสูง (สำหรับผู้ดูแลระบบ)'}
      </button>

      {showAdvanced && (
        <div className="space-y-4">
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

          {/* Countdown */}
          <div className="card space-y-3">
            <h3 className="font-semibold text-sm">⏰ Countdown</h3>
            <div>
              <label className="label">แจ้งเตือนก่อนปิดรับ (นาที)</label>
              <input
                type="text"
                value={settings.countdown_intervals || '20,10,5'}
                onChange={e => setSettings(prev => ({ ...prev, countdown_intervals: e.target.value }))}
                className="input font-mono text-sm"
                placeholder="20,10,5"
              />
              <p className="text-[10px] text-text-secondary mt-1">คั่นด้วยคอมมา เช่น 20,10,5 = แจ้ง 3 ครั้ง</p>
              <button onClick={() => saveSetting('countdown_intervals', settings.countdown_intervals || '20,10,5')} className="btn-primary text-xs mt-2">💾 บันทึก</button>
            </div>
          </div>
        </div>
      )}

      {saving && <p className="text-xs text-text-secondary text-center">กำลังบันทึก...</p>}
    </div>
  )
}
