'use client'

import { useEffect, useState } from 'react'

interface ScheduledMsg {
  id: string
  message: string
  send_time: string
  repeat_days: string
  target: string
  is_active: boolean
  last_sent_at: string | null
}

const REPEAT_OPTIONS = [
  { id: 'daily', label: 'ทุกวัน' },
  { id: 'weekday', label: 'จ-ศ' },
  { id: 'weekend', label: 'ส-อา' },
  { id: '1,2,3,4,5', label: 'จ-ศ (custom)' },
]

const TARGET_OPTIONS = [
  { id: 'both', label: '💬 LINE + ✈️ TG' },
  { id: 'line', label: '💬 LINE' },
  { id: 'telegram', label: '✈️ TG' },
]

export default function ScheduledPage() {
  const [messages, setMessages] = useState<ScheduledMsg[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Form
  const [formMsg, setFormMsg] = useState('')
  const [formTime, setFormTime] = useState('12:00')
  const [formRepeat, setFormRepeat] = useState('daily')
  const [formTarget, setFormTarget] = useState('both')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const res = await fetch('/api/scheduled-messages')
    const data = await res.json()
    setMessages(data.messages || [])
    setLoading(false)
  }

  function openAdd() {
    setFormMsg('')
    setFormTime('12:00')
    setFormRepeat('daily')
    setFormTarget('both')
    setEditingId(null)
    setShowForm(true)
  }

  function openEdit(msg: ScheduledMsg) {
    setFormMsg(msg.message)
    setFormTime(msg.send_time?.substring(0, 5) || '12:00')
    setFormRepeat(msg.repeat_days)
    setFormTarget(msg.target)
    setEditingId(msg.id)
    setShowForm(true)
  }

  async function handleSave() {
    if (!formMsg.trim() || !formTime) return
    setSaving(true)

    if (editingId) {
      await fetch('/api/scheduled-messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, message: formMsg.trim(), send_time: formTime, repeat_days: formRepeat, target: formTarget }),
      })
    } else {
      await fetch('/api/scheduled-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: formMsg.trim(), send_time: formTime, repeat_days: formRepeat, target: formTarget }),
      })
    }

    setSaving(false)
    setShowForm(false)
    loadData()
  }

  async function handleToggle(msg: ScheduledMsg) {
    await fetch('/api/scheduled-messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: msg.id, is_active: !msg.is_active }),
    })
    loadData()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/scheduled-messages?id=${id}`, { method: 'DELETE' })
    loadData()
  }

  const repeatLabel = (r: string) => REPEAT_OPTIONS.find(o => o.id === r)?.label || r
  const targetLabel = (t: string) => TARGET_OPTIONS.find(o => o.id === t)?.label || t

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin text-3xl">⏰</div></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">⏰ ตั้งเวลาส่งข้อความ</h2>
          <p className="text-xs text-text-secondary">ตั้งข้อความให้ส่งอัตโนมัติตามเวลาที่กำหนด</p>
        </div>
        <button onClick={openAdd} className="btn-primary text-sm">+ เพิ่ม</button>
      </div>

      {/* Info */}
      <div className="card bg-blue-50 border border-blue-200 text-xs text-blue-700 space-y-1">
        <p className="font-medium">วิธีใช้:</p>
        <p>{'• กด "+ เพิ่ม" → พิมพ์ข้อความ + ตั้งเวลา + เลือกวัน'}</p>
        <p>• ระบบส่งอัตโนมัติตามเวลาที่ตั้ง ไม่ต้องกดเอง</p>
        <p>• เปิด/ปิดได้ กดที่ปุ่มสีเขียว/แดง</p>
      </div>

      {/* Messages List */}
      {messages.length === 0 ? (
        <div className="text-center py-12 text-text-secondary">
          <p className="text-3xl mb-2">📭</p>
          <p className="text-sm">ยังไม่มีข้อความตั้งเวลา</p>
          <p className="text-xs">{'กด "+ เพิ่ม" เพื่อสร้างข้อความแรก'}</p>
        </div>
      ) : (
        <div className="card p-0 divide-y divide-gray-50">
          {messages.map(msg => (
            <div key={msg.id} className={`px-4 py-3 ${!msg.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => openEdit(msg)}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono font-bold">{msg.send_time?.substring(0, 5)}</span>
                    <span className="text-[10px] bg-gray-100 text-text-secondary px-1.5 py-0.5 rounded">{repeatLabel(msg.repeat_days)}</span>
                    <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{targetLabel(msg.target)}</span>
                  </div>
                  <p className="text-xs text-text-primary line-clamp-2 whitespace-pre-wrap">{msg.message}</p>
                  {msg.last_sent_at && (
                    <p className="text-[10px] text-text-secondary mt-1">ส่งล่าสุด: {new Date(msg.last_sent_at).toLocaleString('th-TH')}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleToggle(msg)}
                    role="switch"
                    aria-checked={msg.is_active}
                    aria-label={msg.is_active ? 'ปิด' : 'เปิด'}
                    className="p-1"
                  >
                    {msg.is_active ? '🟢' : '🔴'}
                  </button>
                  <button onClick={() => handleDelete(msg.id)} className="p-1 text-danger" aria-label="ลบ">🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">{editingId ? '✏️ แก้ไข' : '➕ เพิ่มข้อความตั้งเวลา'}</h3>
              <button onClick={() => setShowForm(false)} className="text-text-secondary hover:text-text-primary p-1" aria-label="ปิด">✕</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="label">ข้อความ *</label>
                <textarea
                  value={formMsg}
                  onChange={e => setFormMsg(e.target.value)}
                  className="input min-h-[120px] text-sm"
                  placeholder="พิมพ์ข้อความที่ต้องการส่ง..."
                />
              </div>

              <div>
                <label className="label">เวลาส่ง *</label>
                <input type="time" value={formTime} onChange={e => setFormTime(e.target.value)} className="input" />
              </div>

              <div>
                <label className="label">ส่งวันไหน</label>
                <div className="grid grid-cols-2 gap-2">
                  {REPEAT_OPTIONS.map(r => (
                    <button
                      key={r.id}
                      onClick={() => setFormRepeat(r.id)}
                      className={`py-2 px-3 rounded-lg border-2 text-xs text-center transition-all ${
                        formRepeat === r.id ? 'border-gold bg-gold/5' : 'border-gray-200'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">ส่งไปที่</label>
                <div className="grid grid-cols-3 gap-2">
                  {TARGET_OPTIONS.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setFormTarget(t.id)}
                      className={`py-2 px-3 rounded-lg border-2 text-xs text-center transition-all ${
                        formTarget === t.id ? 'border-gold bg-gold/5' : 'border-gray-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="btn-outline text-sm flex-1">ยกเลิก</button>
              <button onClick={handleSave} disabled={saving || !formMsg.trim() || !formTime} className="btn-primary text-sm flex-1 disabled:opacity-50">
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
