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

  async function saveSetting(key: string, value: string) {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      setSettings(prev => ({ ...prev, [key]: value }))
    } catch {
      console.error('Failed to save setting')
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
      setTgStatus(data.success ? `✅ เชื่อมต่อสำเร็จ (${data.username || 'OK'})` : `❌ ${data.error}`)
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
      const res = await fetch('/api/line/test')
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

      {/* Telegram Bot */}
      <div className="card space-y-3">
        <h3 className="font-semibold">✈️ Telegram Bot</h3>
        <div>
          <label className="label">Bot Token</label>
          <input
            type="password"
            value={settings.telegram_bot_token || ''}
            onChange={e => setSettings(prev => ({ ...prev, telegram_bot_token: e.target.value }))}
            onBlur={e => saveSetting('telegram_bot_token', e.target.value)}
            className="input font-mono text-xs"
            placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
          />
        </div>
        <div>
          <label className="label">Admin Channel ID</label>
          <input
            type="text"
            value={settings.telegram_admin_channel || ''}
            onChange={e => setSettings(prev => ({ ...prev, telegram_admin_channel: e.target.value }))}
            onBlur={e => saveSetting('telegram_admin_channel', e.target.value)}
            className="input font-mono text-xs"
            placeholder="-1001234567890"
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={testTelegram} className="btn-outline text-sm">🔍 ทดสอบเชื่อมต่อ</button>
          {tgStatus && <span className="text-xs">{tgStatus}</span>}
        </div>
      </div>

      {/* LINE Messaging API */}
      <div className="card space-y-3">
        <h3 className="font-semibold">💬 LINE Messaging API</h3>
        <div>
          <label className="label">Channel Access Token</label>
          <input
            type="password"
            value={settings.line_channel_access_token || ''}
            onChange={e => setSettings(prev => ({ ...prev, line_channel_access_token: e.target.value }))}
            onBlur={e => saveSetting('line_channel_access_token', e.target.value)}
            className="input font-mono text-xs"
            placeholder="Channel Access Token (Long-lived)"
          />
        </div>
        <div>
          <label className="label">Channel Secret</label>
          <input
            type="password"
            value={settings.line_channel_secret || ''}
            onChange={e => setSettings(prev => ({ ...prev, line_channel_secret: e.target.value }))}
            onBlur={e => saveSetting('line_channel_secret', e.target.value)}
            className="input font-mono text-xs"
            placeholder="Channel Secret"
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={testLine} className="btn-outline text-sm">🔍 ทดสอบ Token</button>
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
                    className={`relative w-10 h-5 rounded-full transition-colors ${group.is_active ? 'bg-success' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${group.is_active ? 'left-5' : 'left-0.5'}`} />
                  </button>
                  <button onClick={() => deleteGroup(group.id)} className="text-danger text-sm hover:bg-danger/10 rounded p-1">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scraping */}
      <div className="card space-y-3">
        <h3 className="font-semibold">🕷️ Scraping</h3>
        <div>
          <label className="label">ดึงผลทุกกี่วินาที</label>
          <input
            type="number"
            value={settings.scrape_interval_seconds || '30'}
            onChange={e => setSettings(prev => ({ ...prev, scrape_interval_seconds: e.target.value }))}
            onBlur={e => saveSetting('scrape_interval_seconds', e.target.value)}
            className="input w-24"
            min="10"
            max="120"
          />
        </div>
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
      </div>

      {saving && <p className="text-xs text-text-secondary text-center">กำลังบันทึก...</p>}
    </div>
  )
}
