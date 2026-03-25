'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { BotSetting, LineGroup } from '@/types'

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
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [newGroup, setNewGroup] = useState({ name: '', line_notify_token: '' })
  const [showOAuth, setShowOAuth] = useState(false)
  const [lineOAuthName, setLineOAuthName] = useState('')
  const [lineMsg, setLineMsg] = useState('')

  useEffect(() => {
    loadSettings()
    // Handle LINE OAuth redirect result
    const success = searchParams.get('line_success')
    const error = searchParams.get('line_error')
    if (success) {
      setLineMsg(`✅ เชื่อมต่อ "${success}" สำเร็จ!`)
      window.history.replaceState({}, '', '/settings')
    } else if (error) {
      setLineMsg(`❌ เชื่อมต่อไม่สำเร็จ: ${error}`)
      window.history.replaceState({}, '', '/settings')
    }
  }, [searchParams])

  async function loadSettings() {
    const [settingsRes, groupsRes] = await Promise.all([
      supabase.from('bot_settings').select('*'),
      supabase.from('line_groups').select('*').order('created_at'),
    ])

    const map: Record<string, string> = {}
    ;(settingsRes.data || []).forEach((s: BotSetting) => { map[s.key] = s.value })
    setSettings(map)
    setGroups((groupsRes.data || []) as LineGroup[])
    setLoading(false)
  }

  async function saveSetting(key: string, value: string) {
    setSaving(true)
    await supabase.from('bot_settings')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key)
    setSettings(prev => ({ ...prev, [key]: value }))
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
    await supabase.from('line_groups').update({ is_active: !current, updated_at: new Date().toISOString() }).eq('id', id)
    setGroups(prev => prev.map(g => g.id === id ? { ...g, is_active: !current } : g))
  }

  async function addGroup() {
    if (!newGroup.name) return
    await supabase.from('line_groups').insert(newGroup)
    setNewGroup({ name: '', line_notify_token: '' })
    setShowAddGroup(false)
    loadSettings()
  }

  async function deleteGroup(id: string) {
    await supabase.from('line_groups').delete().eq('id', id)
    setGroups(prev => prev.filter(g => g.id !== id))
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

      {/* n8n */}
      <div className="card space-y-3">
        <h3 className="font-semibold">⚡ n8n Automation</h3>
        <div>
          <label className="label">Webhook URL</label>
          <input
            type="url"
            value={settings.n8n_webhook_url || ''}
            onChange={e => setSettings(prev => ({ ...prev, n8n_webhook_url: e.target.value }))}
            onBlur={e => saveSetting('n8n_webhook_url', e.target.value)}
            className="input font-mono text-xs"
            placeholder="https://n8n.example.com/webhook/xxxxx"
          />
        </div>
        <p className="text-xs text-text-secondary">n8n Workflow: Telegram Trigger → Parse ข้อความ → LINE Notify (ส่งทุกกลุ่ม)</p>
      </div>

      {/* LINE Groups */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">💬 กลุ่ม LINE ({groups.filter(g => g.is_active).length}/{groups.length})</h3>
          <div className="flex gap-1.5">
            <button onClick={() => setShowAddGroup(true)} className="btn-outline text-xs">+ ใส่ Token</button>
            <button onClick={() => { setShowOAuth(true); setLineOAuthName('') }} className="btn-primary text-xs">🔗 เชื่อมต่อ LINE</button>
          </div>
        </div>

        {lineMsg && (
          <div className={`text-sm px-3 py-2 rounded-lg ${lineMsg.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {lineMsg}
          </div>
        )}

        {/* LINE OAuth — ใส่ชื่อกลุ่มแล้วกด เชื่อมต่อ */}
        {showOAuth && (
          <div className="border border-green-200 bg-green-50 rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium text-green-800">🔗 เชื่อมต่อกลุ่ม LINE (กดอนุญาตอย่างเดียว)</p>
            <input
              value={lineOAuthName}
              onChange={e => setLineOAuthName(e.target.value)}
              className="input"
              placeholder="ตั้งชื่อกลุ่ม เช่น VIP กลุ่ม 1"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setShowOAuth(false)} className="btn-outline text-xs flex-1">ยกเลิก</button>
              <a
                href={lineOAuthName ? `/api/line/oauth?group_name=${encodeURIComponent(lineOAuthName)}` : '#'}
                className={`btn-primary text-xs flex-1 text-center inline-block ${!lineOAuthName ? 'opacity-50 pointer-events-none' : ''}`}
              >
                เชื่อมต่อ LINE →
              </a>
            </div>
            <p className="text-xs text-green-600">ลูกค้า Login LINE → กดอนุญาต → Token เข้าระบบอัตโนมัติ</p>
          </div>
        )}

        {groups.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-4">ยังไม่มีกลุ่ม LINE — กด &quot;เชื่อมต่อ LINE&quot; เพื่อเพิ่ม</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {groups.map(group => (
              <div key={group.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{group.name}</p>
                  <p className="text-xs text-text-secondary font-mono truncate">{group.line_notify_token ? '••••' + group.line_notify_token.slice(-6) : 'ยังไม่มี Token'}</p>
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

        {/* Add Group Manual */}
        {showAddGroup && (
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-xs text-text-secondary">ใส่ Token เอง (สำหรับผู้ที่มี Token แล้ว)</p>
            <input value={newGroup.name} onChange={e => setNewGroup({ ...newGroup, name: e.target.value })} className="input" placeholder="ชื่อกลุ่ม LINE" />
            <input value={newGroup.line_notify_token} onChange={e => setNewGroup({ ...newGroup, line_notify_token: e.target.value })} className="input font-mono text-xs" placeholder="LINE Notify Token" />
            <div className="flex gap-2">
              <button onClick={() => setShowAddGroup(false)} className="btn-outline text-xs flex-1">ยกเลิก</button>
              <button onClick={addGroup} disabled={!newGroup.name} className="btn-primary text-xs flex-1 disabled:opacity-50">เพิ่ม</button>
            </div>
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
