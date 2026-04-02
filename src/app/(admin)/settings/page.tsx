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
  const [tgStatus, setTgStatus] = useState<string>('')
  const [lineStatus, setLineStatus] = useState<string>('')
  const [unlockedFields, setUnlockedFields] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadSettings()
  }, [searchParams])

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      const map: Record<string, string> = {}
      ;(data.settings || []).forEach((s: { key: string; value: string }) => { map[s.key] = s.value })
      setSettings(map)
      setGroups(data.groups || [])
    } catch {
      console.error('Failed to load settings')
    }
    setLoading(false)
  }

  function maskValue(val: string): string {
    if (!val || val.length < 8) return val ? '••••••••' : ''
    return '••••••••' + val.slice(-4)
  }

  function isFieldLocked(key: string): boolean {
    const criticalKeys = ['telegram_bot_token', 'telegram_admin_channel', 'line_channel_access_token', 'line_channel_secret']
    if (!criticalKeys.includes(key)) return false
    if (!settings[key]) return false // empty = unlocked (need to enter)
    return !unlockedFields.has(key)
  }

  function toggleLock(key: string) {
    setUnlockedFields(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function saveSetting(key: string, value: string) {
    // ป้องกันเผลอลบ key สำคัญ
    const criticalKeys = ['telegram_bot_token', 'telegram_admin_channel', 'line_channel_access_token']
    if (criticalKeys.includes(key) && !value.trim()) {
      return // ไม่ save ค่าว่างสำหรับ key สำคัญ
    }

    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      if (res.ok) {
        setSettings(prev => ({ ...prev, [key]: value }))
        // Lock field after save
        setUnlockedFields(prev => { const next = new Set(prev); next.delete(key); return next })
      }
    } catch {
      // silently fail
    }
    setSaving(false)
  }

  async function testTelegram() {
    setTgStatus('กำลังทดสอบ...')
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      })
      const data = await res.json()
      setTgStatus(data.success ? `✅ เชื่อมต่อสำเร็จ (${data.username || 'ระบบ'})` : `❌ ${data.error}`)
    } catch {
      setTgStatus('❌ ไม่สามารถเชื่อมต่อได้')
    }
  }

  async function toggleGroup(id: string, current: boolean) {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_group', id, is_active: !current }),
    })
    setGroups(prev => prev.map(g => g.id === id ? { ...g, is_active: !current } : g))
  }

  async function deleteGroup(id: string) {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_group', id }),
    })
    setGroups(prev => prev.filter(g => g.id !== id))
  }

  async function testLine() {
    setLineStatus('กำลังตรวจสอบ...')
    try {
      const res = await fetch(`/api/line/test?t=${Date.now()}`)
      const data = await res.json()
      setLineStatus(data.valid ? '✅ Token ใช้งานได้' : `❌ ${data.error || 'Token ไม่ถูกต้อง'}`)
    } catch {
      setLineStatus('❌ ไม่สามารถเชื่อมต่อได้')
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin text-3xl">⚙️</div></div>
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">⚙️ ตั้งค่า</h2>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-2">
        <a href="/lotteries" className="card text-center py-3 hover:bg-gray-50 transition-colors">
          <span className="text-xl">🎰</span>
          <p className="text-xs text-text-secondary mt-1">จัดการหวย</p>
        </a>
        <a href="/results" className="card text-center py-3 hover:bg-gray-50 transition-colors">
          <span className="text-xl">✏️</span>
          <p className="text-xs text-text-secondary mt-1">แก้ไขผล (สำรอง)</p>
        </a>
      </div>

      {/* Telegram Bot */}
      <div className="card space-y-3">
        <h3 className="font-semibold">✈️ Telegram Bot</h3>
        <div>
          <label className="label">Bot Token {settings.telegram_bot_token && '🔒'}</label>
          {isFieldLocked('telegram_bot_token') ? (
            <div className="flex items-center gap-2">
              <div className="input font-mono text-xs bg-gray-50 text-text-secondary flex-1">{maskValue(settings.telegram_bot_token)}</div>
              <button onClick={() => toggleLock('telegram_bot_token')} className="btn-outline text-xs shrink-0">🔓 แก้ไข</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={settings.telegram_bot_token || ''}
                onChange={e => setSettings(prev => ({ ...prev, telegram_bot_token: e.target.value }))}
                className="input font-mono text-xs flex-1"
                placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
              />
              <button onClick={() => saveSetting('telegram_bot_token', settings.telegram_bot_token || '')} className="btn-primary text-xs shrink-0">💾</button>
            </div>
          )}
        </div>
        <div>
          <label className="label">Admin Channel ID {settings.telegram_admin_channel && '🔒'}</label>
          {isFieldLocked('telegram_admin_channel') ? (
            <div className="flex items-center gap-2">
              <div className="input font-mono text-xs bg-gray-50 text-text-secondary flex-1">{maskValue(settings.telegram_admin_channel)}</div>
              <button onClick={() => toggleLock('telegram_admin_channel')} className="btn-outline text-xs shrink-0">🔓 แก้ไข</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={settings.telegram_admin_channel || ''}
                onChange={e => setSettings(prev => ({ ...prev, telegram_admin_channel: e.target.value }))}
                className="input font-mono text-xs flex-1"
                placeholder="-1001234567890"
              />
              <button onClick={() => saveSetting('telegram_admin_channel', settings.telegram_admin_channel || '')} className="btn-primary text-xs shrink-0">💾</button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={testTelegram} disabled={tgStatus === 'กำลังทดสอบ...'} className="btn-outline text-sm disabled:opacity-50">🔍 ทดสอบเชื่อมต่อ</button>
          {tgStatus && <span className="text-xs">{tgStatus}</span>}
        </div>
      </div>

      {/* LINE Messaging API */}
      <div className="card space-y-3">
        <h3 className="font-semibold">💬 LINE Messaging API</h3>
        <div>
          <label className="label">Channel Access Token {settings.line_channel_access_token && '🔒'}</label>
          {isFieldLocked('line_channel_access_token') ? (
            <div className="flex items-center gap-2">
              <div className="input font-mono text-xs bg-gray-50 text-text-secondary flex-1">{maskValue(settings.line_channel_access_token)}</div>
              <button onClick={() => toggleLock('line_channel_access_token')} className="btn-outline text-xs shrink-0">🔓 แก้ไข</button>
            </div>
          ) : (
            <input
              type="password"
              autoComplete="off"
              value={settings.line_channel_access_token || ''}
              onChange={e => setSettings(prev => ({ ...prev, line_channel_access_token: e.target.value }))}
              className="input font-mono text-xs"
              placeholder="Channel Access Token (Long-lived)"
            />
          )}
        </div>
        <div>
          <label className="label">Channel Secret {settings.line_channel_secret && '🔒'}</label>
          {isFieldLocked('line_channel_secret') ? (
            <div className="flex items-center gap-2">
              <div className="input font-mono text-xs bg-gray-50 text-text-secondary flex-1">{maskValue(settings.line_channel_secret)}</div>
              <button onClick={() => { toggleLock('line_channel_secret'); toggleLock('line_channel_access_token') }} className="btn-outline text-xs shrink-0">🔓 แก้ไข</button>
            </div>
          ) : (
            <input
              type="password"
              autoComplete="off"
              value={settings.line_channel_secret || ''}
              onChange={e => setSettings(prev => ({ ...prev, line_channel_secret: e.target.value }))}
              className="input font-mono text-xs"
              placeholder="Channel Secret"
            />
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={async () => {
              setLineStatus('')
              setSaving(true)
              const token = settings.line_channel_access_token || ''
              const secret = settings.line_channel_secret || ''
              if (!token) {
                setLineStatus('❌ กรุณาใส่ Channel Access Token')
                setSaving(false)
                return
              }
              await saveSetting('line_channel_access_token', token)
              if (secret) await saveSetting('line_channel_secret', secret)
              setSaving(false)
              setLineStatus('✅ บันทึกแล้ว — กดทดสอบ Token ได้เลย')
            }}
            disabled={saving}
            className="btn-primary text-sm"
          >
            {saving ? '...' : '💾 บันทึก'}
          </button>
          <button onClick={testLine} disabled={lineStatus === 'กำลังตรวจสอบ...'} className="btn-outline text-sm disabled:opacity-50">🔍 ทดสอบ Token</button>
          {lineStatus && <span className="text-xs">{lineStatus}</span>}
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1">
          <p className="font-medium">Webhook URL (ใส่ใน LINE Developers Console):</p>
          <code className="block bg-white rounded px-2 py-1 text-blue-900 break-all">
            {typeof window !== 'undefined' ? `${window.location.origin}/api/line/webhook` : '/api/line/webhook'}
          </code>
          <p>เมื่อเพิ่ม Bot เข้ากลุ่ม LINE จะจับกลุ่มอัตโนมัติ</p>
        </div>
      </div>

      {/* LINE Groups (auto-detected) */}
      <div className="card space-y-3">
        <h3 className="font-semibold">👥 กลุ่ม LINE ({groups.filter(g => g.is_active).length}/{groups.length})</h3>
        <p className="text-xs text-text-secondary">กลุ่มจะเพิ่มอัตโนมัติเมื่อเชิญ Bot เข้ากลุ่ม LINE</p>

        {groups.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-4">ยังไม่มีกลุ่ม — เพิ่ม Bot เข้ากลุ่ม LINE เพื่อเริ่มใช้งาน</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {groups.map(group => (
              <div key={group.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{group.name}</p>
                  <p className="text-xs text-text-secondary font-mono truncate">
                    {group.line_group_id ? `ID: ••••${group.line_group_id.slice(-8)}` : 'ไม่มี Group ID'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleGroup(group.id, group.is_active)}
                    role="switch"
                    aria-checked={group.is_active}
                    aria-label={`${group.is_active ? 'ปิด' : 'เปิด'} กลุ่ม ${group.name}`}
                    className={`relative w-10 h-5 rounded-full transition-colors ${group.is_active ? 'bg-success' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${group.is_active ? 'left-5' : 'left-0.5'}`} />
                  </button>
                  <button onClick={() => deleteGroup(group.id)} aria-label={`ลบกลุ่ม ${group.name}`} className="text-danger text-sm hover:bg-danger/10 rounded p-1">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scraping */}
      <div className="card space-y-3">
        <h3 className="font-semibold">🤖 ดึงผลอัตโนมัติ</h3>
        <p className="text-xs text-text-secondary">ตั้งค่าพฤติกรรมการดึงผลหวยอัตโนมัติจากเว็บต้นทาง</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">หน้าต่างเวลาดึงผล (นาที)</label>
            <input
              type="number"
              value={settings.scrape_window_minutes || '30'}
              onChange={e => setSettings(prev => ({ ...prev, scrape_window_minutes: e.target.value }))}
              onBlur={e => saveSetting('scrape_window_minutes', e.target.value)}
              className="input"
              min="5"
              max="60"
            />
            <p className="text-[10px] text-text-secondary mt-0.5">ดึงผลได้ถึงกี่นาทีหลังเวลาออก</p>
          </div>
          <div>
            <label className="label">จำนวน Retry</label>
            <input
              type="number"
              value={settings.scrape_max_retries || '3'}
              onChange={e => setSettings(prev => ({ ...prev, scrape_max_retries: e.target.value }))}
              onBlur={e => saveSetting('scrape_max_retries', e.target.value)}
              className="input"
              min="1"
              max="10"
            />
            <p className="text-[10px] text-text-secondary mt-0.5">ลองดึงซ้ำกี่ครั้งถ้าไม่สำเร็จ</p>
          </div>
        </div>

        <div>
          <label className="label">หน่วงเวลาระหว่าง Retry (วินาที)</label>
          <input
            type="number"
            value={Math.round(parseInt(settings.scrape_retry_delay_ms || '10000') / 1000)}
            onChange={e => {
              const ms = String(Number(e.target.value) * 1000)
              setSettings(prev => ({ ...prev, scrape_retry_delay_ms: ms }))
            }}
            onBlur={e => saveSetting('scrape_retry_delay_ms', String(Number(e.target.value) * 1000))}
            className="input w-24"
            min="5"
            max="60"
          />
        </div>

        <hr className="border-gray-100" />

        <div>
          <label className="label">จำนวนงวดสถิติ</label>
          <input
            type="number"
            value={settings.stats_count || '10'}
            onChange={e => setSettings(prev => ({ ...prev, stats_count: e.target.value }))}
            onBlur={e => saveSetting('stats_count', e.target.value)}
            className="input w-24"
            min="5"
            max="30"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.fallback_enabled === 'true'}
            onChange={e => saveSetting('fallback_enabled', e.target.checked ? 'true' : 'false')}
            className="rounded"
          />
          <span className="text-sm">เปิดใช้แหล่งสำรอง (Fallback)</span>
        </label>

        <hr className="border-gray-100" />

        <div>
          <label className="label">Countdown แจ้งเตือนก่อนปิดรับ (นาที)</label>
          <input
            type="text"
            value={settings.countdown_intervals || '20,10,5'}
            onChange={e => setSettings(prev => ({ ...prev, countdown_intervals: e.target.value }))}
            className="input font-mono text-sm"
            placeholder="20,10,5"
          />
          <p className="text-[10px] text-text-secondary mt-1">ใส่นาทีคั่นด้วยคอมมา เช่น "20,10,5" = แจ้งเตือน 3 ครั้ง (20, 10, 5 นาทีก่อนปิด) ใส่ "5" = แจ้งเตือนครั้งเดียว</p>
          <button
            onClick={() => saveSetting('countdown_intervals', settings.countdown_intervals || '20,10,5')}
            className="btn-primary text-xs mt-2"
          >
            💾 บันทึก Countdown
          </button>
        </div>
      </div>

      {/* Default Result Style */}
      <div className="card space-y-3">
        <h3 className="font-semibold">🎨 สไตล์รูปตัวเลข (ผล auto)</h3>
        <p className="text-xs text-text-secondary">เลือกธีม + สไตล์ตัวเลขสำหรับผลหวยที่ดึงอัตโนมัติ</p>

        {/* Theme */}
        <div>
          <label className="label">ธีม</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'outline', label: '✍️', colors: ['#8E44AD', '#27AE60', '#E84393'] },
              { id: 'darkminimal', label: '🖤', colors: ['#2D2D44', '#4FC3F7', '#90CAF9'] },
              { id: 'shopee', label: '🎀', colors: ['#F48FB1', '#FFB74D', '#AED581'] },
              { id: 'macaroon', label: '🧁', colors: ['#FFD1DC', '#FFE5B4', '#FFFACD'] },
              { id: 'candy', label: '🍬', colors: ['#FF6B8A', '#FF9F43', '#FFDD59'] },
              { id: 'ocean', label: '🌊', colors: ['#2B6CB0', '#3182CE', '#4299E1'] },
              { id: 'gold', label: '✨', colors: ['#F59E0B', '#FBBF24', '#FCD34D'] },
              { id: 'dark', label: '🌙', colors: ['#E53E3E', '#DD6B20', '#D69E2E'] },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => saveSetting('default_theme', t.id)}
                className={`p-2 rounded-lg border-2 transition-all ${
                  (settings.default_theme || 'macaroon') === t.id
                    ? 'border-gold shadow-sm scale-105'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-center text-lg mb-1">{t.label}</div>
                <div className="flex justify-center gap-0.5">
                  {t.colors.map((c, i) => (
                    <span key={i} className="w-3 h-3 rounded-full" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <p className="text-[9px] text-text-secondary mt-1 text-center capitalize">{t.id}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Font */}
        <div>
          <label className="label">ฟอนต์ตัวเลข</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'sniglet', label: 'Sniglet', desc: 'กลม bubbly' },
              { id: 'mali', label: 'มะลิ', desc: 'น่ารัก ไทย' },
              { id: 'itim', label: 'ไอติม', desc: 'หนา ไทย' },
              { id: 'mitr', label: 'มิตร', desc: 'สะอาด ไทย' },
              { id: 'fredoka', label: 'Fredoka', desc: 'กลม หนา' },
              { id: 'luckiestguy', label: 'Luckiest', desc: 'การ์ตูน' },
              { id: 'comfortaa', label: 'Comfortaa', desc: 'มน สวย' },
              { id: 'varelaround', label: 'Varela', desc: 'กลม เรียบ' },
              { id: 'quicksand', label: 'Quicksand', desc: 'ทันสมัย' },
              { id: 'kanit', label: 'คณิต', desc: 'ไทย โมเดิร์น' },
              { id: 'baloo2', label: 'Baloo 2', desc: 'อ้วน กลม' },
              { id: 'prompt', label: 'Prompt', desc: 'ไทย สะอาด' },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => saveSetting('default_font_style', f.id)}
                className={`flex-1 py-2 px-3 rounded-lg border-2 text-center text-xs transition-all ${
                  (settings.default_font_style || 'rounded') === f.id
                    ? 'border-gold bg-gold/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="font-medium">{f.label}</div>
                <div className="text-[10px] text-text-secondary">{f.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Digit Size */}
        <div>
          <label className="label">ขนาดตัวเลข</label>
          <div className="flex gap-2">
            {[
              { id: 's', label: 'S', desc: 'เล็ก' },
              { id: 'm', label: 'M', desc: 'กลาง' },
              { id: 'l', label: 'L', desc: 'ใหญ่' },
            ].map(s => (
              <button
                key={s.id}
                onClick={() => saveSetting('default_digit_size', s.id)}
                className={`flex-1 py-2 px-3 rounded-lg border-2 text-center text-xs transition-all ${
                  (settings.default_digit_size || 'm') === s.id
                    ? 'border-gold bg-gold/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="font-bold text-lg">{s.label}</div>
                <div className="text-[10px] text-text-secondary">{s.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Layout */}
        <div>
          <label className="label">เรียงตัวเลข</label>
          <div className="flex gap-2">
            {[
              { id: 'horizontal', label: '➡️ แนวนอน', desc: '1 2 3' },
              { id: 'vertical', label: '⬇️ แนวตั้ง', desc: 'ลงล่าง' },
            ].map(l => (
              <button
                key={l.id}
                onClick={() => saveSetting('default_layout', l.id)}
                className={`flex-1 py-2 px-3 rounded-lg border-2 text-center text-xs transition-all ${
                  (settings.default_layout || 'horizontal') === l.id ? 'border-gold bg-gold/5' : 'border-gray-200'
                }`}
              >
                <div className="font-medium">{l.label}</div>
                <div className="text-[10px] text-text-secondary">{l.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-xs font-medium text-text-secondary mb-1">👁 ตัวอย่างรูปที่จะส่งไป LINE จริง</p>
          <p className="text-[10px] text-green-600 mb-2">ตั้งค่าครั้งเดียว → บันทึกถาวร ใช้กับผล auto ทุกรายการ</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/generate-image?lottery_name=ตัวอย่าง&flag=🎰&date=${encodeURIComponent(new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }))}&top_number=123&bottom_number=45&theme=${settings.default_theme || 'shopee'}&font_style=${settings.default_font_style || 'rounded'}&digit_size=${settings.default_digit_size || 'm'}&layout=${settings.default_layout || 'horizontal'}`}
            alt="Preview"
            className="mx-auto rounded-lg shadow-sm max-w-[280px]"
          />
        </div>
      </div>

      {saving && <p className="text-xs text-text-secondary text-center">กำลังบันทึก...</p>}
    </div>
  )
}
