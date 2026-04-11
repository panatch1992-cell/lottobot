'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface BotAccount {
  id: string
  name: string
  endpoint_url: string | null
  endpoint_token: string | null
  line_mid: string | null
  line_display_name: string | null
  is_active: boolean
  health_status: string
  consecutive_failures: number
  consecutive_successes: number
  daily_send_count: number
  hourly_send_count: number
  last_used_at: string | null
  cooldown_until: string | null
  priority: number
  last_error: string | null
  last_error_at: string | null
}

function healthColor(status: string): string {
  if (status === 'healthy') return 'bg-green-100 text-green-800'
  if (status === 'degraded') return 'bg-yellow-100 text-yellow-800'
  if (status === 'cooldown') return 'bg-orange-100 text-orange-800'
  if (status === 'banned') return 'bg-red-100 text-red-800'
  return 'bg-gray-100 text-gray-700'
}

function cooldownRemaining(until: string | null): string | null {
  if (!until) return null
  const ms = new Date(until).getTime() - Date.now()
  if (ms <= 0) return null
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} นาที`
  const hr = Math.round(min / 60)
  return `${hr} ชั่วโมง`
}

export default function BotAccountsPage() {
  const [items, setItems] = useState<BotAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [form, setForm] = useState({
    name: '',
    endpoint_url: '',
    endpoint_token: '',
    priority: 100,
  })
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true)
    const res = await fetch('/api/admin/bot-accounts')
    const data = await res.json()
    if (res.ok) setItems(data.items || [])
    else setMessage({ type: 'err', text: data.error || 'load failed' })
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function addAccount() {
    if (!form.name.trim()) return
    setAdding(true)
    setMessage(null)
    const res = await fetch('/api/admin/bot-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        endpoint_url: form.endpoint_url.trim() || null,
        endpoint_token: form.endpoint_token.trim() || null,
        priority: Number(form.priority) || 100,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setForm({ name: '', endpoint_url: '', endpoint_token: '', priority: 100 })
      setMessage({ type: 'ok', text: 'เพิ่มบัญชีแล้ว' })
      await load()
    } else {
      setMessage({ type: 'err', text: data.error || 'เพิ่มไม่สำเร็จ' })
    }
    setAdding(false)
  }

  async function toggleActive(a: BotAccount) {
    await fetch(`/api/admin/bot-accounts?id=${a.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !a.is_active }),
    })
    await load()
  }

  async function resume(a: BotAccount) {
    await fetch(`/api/admin/bot-accounts?action=resume&id=${a.id}`, { method: 'POST' })
    await load()
  }

  async function pause(a: BotAccount) {
    if (!confirm(`Pause ${a.name} 24 ชั่วโมง?`)) return
    await fetch(`/api/admin/bot-accounts?action=pause&id=${a.id}`, { method: 'POST' })
    await load()
  }

  async function deleteAccount(a: BotAccount) {
    if (!confirm(`ลบบัญชี ${a.name}?`)) return
    await fetch(`/api/admin/bot-accounts?id=${a.id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <Link href="/dev" className="text-text-secondary hover:text-text-primary">
          ← Dev Tools
        </Link>
        <span className="text-text-secondary">/</span>
        <span className="text-text-primary">Bot Accounts</span>
      </div>

      <div className="mb-4">
        <h1 className="text-2xl font-bold text-text-primary">🤖 Bot Accounts Pool</h1>
        <p className="text-sm text-text-secondary mt-1">
          Rotation pool ของ LINE user accounts สำหรับส่ง trigger message — เปิด/ปิดที่ Settings
        </p>
      </div>

      {message && (
        <div
          className={`mb-3 p-3 rounded-lg text-sm ${
            message.type === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Add form */}
      <div className="bg-white rounded-lg p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3">+ เพิ่มบัญชี</h2>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="ชื่อ (เช่น bot-1)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <input
            type="url"
            placeholder="endpoint_url (optional, https://...)"
            value={form.endpoint_url}
            onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <input
            type="text"
            placeholder="endpoint_token (optional)"
            value={form.endpoint_token}
            onChange={(e) => setForm({ ...form, endpoint_token: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <div className="flex gap-2 items-center">
            <label className="text-sm">Priority:</label>
            <input
              type="number"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              className="w-20 px-3 py-2 border rounded-lg text-sm"
            />
            <span className="text-xs text-text-secondary">ต่ำ = ใช้ก่อน</span>
          </div>
          <button
            onClick={addAccount}
            disabled={adding || !form.name.trim()}
            className="w-full py-2 bg-success text-white rounded-lg font-medium disabled:opacity-50"
          >
            {adding ? 'กำลังเพิ่ม...' : 'เพิ่มบัญชี'}
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center text-text-secondary py-8">กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div className="text-center text-text-secondary py-8 bg-white rounded-lg">
          ยังไม่มีบัญชีใน pool — เพิ่มด้วยฟอร์มด้านบน
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((a) => {
            const cd = cooldownRemaining(a.cooldown_until)
            return (
              <div key={a.id} className="bg-white rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-semibold">{a.name}</div>
                    <div className="text-xs text-text-secondary">
                      priority {a.priority} · {a.line_display_name || '(no LINE name)'}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${healthColor(a.health_status)}`}>
                    {a.health_status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                  <div>
                    <div className="text-text-secondary">วันนี้</div>
                    <div className="font-semibold">{a.daily_send_count}</div>
                  </div>
                  <div>
                    <div className="text-text-secondary">ชั่วโมงนี้</div>
                    <div className="font-semibold">{a.hourly_send_count}</div>
                  </div>
                  <div>
                    <div className="text-text-secondary">failures</div>
                    <div className={`font-semibold ${a.consecutive_failures > 0 ? 'text-red-600' : ''}`}>
                      {a.consecutive_failures}
                    </div>
                  </div>
                </div>

                {cd && (
                  <div className="text-xs bg-orange-50 text-orange-800 px-2 py-1 rounded mb-2">
                    ⏸ Cooldown อีก {cd}
                  </div>
                )}

                {a.last_error && (
                  <div className="text-xs text-red-700 bg-red-50 p-2 rounded mb-2 truncate">
                    ❌ {a.last_error}
                  </div>
                )}

                <div className="flex gap-2 text-xs">
                  <button
                    onClick={() => toggleActive(a)}
                    className={`flex-1 py-1 rounded ${
                      a.is_active ? 'bg-gray-200 text-gray-700' : 'bg-success text-white'
                    }`}
                  >
                    {a.is_active ? 'ปิด' : 'เปิด'}
                  </button>
                  {cd ? (
                    <button
                      onClick={() => resume(a)}
                      className="flex-1 py-1 rounded bg-gold text-white"
                    >
                      ยกเลิก cooldown
                    </button>
                  ) : (
                    <button
                      onClick={() => pause(a)}
                      className="flex-1 py-1 rounded bg-orange-100 text-orange-800"
                    >
                      Pause 24h
                    </button>
                  )}
                  <button
                    onClick={() => deleteAccount(a)}
                    className="flex-1 py-1 rounded bg-red-100 text-red-700"
                  >
                    ลบ
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
