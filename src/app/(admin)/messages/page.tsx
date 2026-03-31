'use client'

import { useState } from 'react'

export default function MessagesPage() {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [target, setTarget] = useState<'line' | 'telegram' | 'both'>('both')

  async function handleSend() {
    if (!message.trim()) return
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/send-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), target }),
      })
      const data = await res.json()
      setResult({ success: data.success, error: data.error })
      if (data.success) setMessage('')
    } catch {
      setResult({ success: false, error: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้' })
    }
    setSending(false)
  }

  // Quick templates
  const templates = [
    {
      label: '📢 รายการต่อไป',
      text: `▶️▶️ รายการต่อไป ▶️▶️\n\n🇰🇷🇰🇷 เกาหลี(VIP) 🇰🇷🇰🇷\n❌ ปิดรับ 12:30 น.\n\n🇰🇷🇰🇷 เกาหลีปกติ 🇰🇷🇰🇷\n❌ ปิดรับ 12:45 น.\n\n🇯🇵🇯🇵 นิเคอิบ่ายปกติ 🇯🇵🇯🇵\n❌ ปิดรับ 12:55 น.`,
    },
    {
      label: '⏰ Countdown',
      text: `🇱🇦🇱🇦 ลาว HD 🇱🇦🇱🇦\n⏰ 10 นาทีสุดท้าย ❗❗\nส่งโพย ➕ สลิปโอน\n🏠 ส่งหลังบ้านได้เลยนะครับ`,
    },
    {
      label: '📊 แจ้งเตือน',
      text: `📊 แจ้งเตือนจาก Admin\n──────\nข้อความ...`,
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">💬 ส่งข้อความ</h2>
        <p className="text-xs text-text-secondary">พิมพ์ข้อความแล้วส่งไป LINE กลุ่ม / Telegram ได้เลย</p>
      </div>

      {/* Link to scheduled */}
      <a href="/scheduled" className="block card bg-gradient-to-r from-purple-50 to-purple-50/50 border border-purple-200 hover:border-purple-300 transition-colors">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-purple-700">⏰ ตั้งเวลาส่งข้อความ</p>
            <p className="text-xs text-purple-500">ตั้งข้อความให้ส่งอัตโนมัติตามเวลา</p>
          </div>
          <span className="text-purple-400">→</span>
        </div>
      </a>

      {/* Quick Templates */}
      <div className="card space-y-2">
        <p className="text-xs font-medium text-text-secondary">เลือก template สำเร็จรูป:</p>
        <div className="flex gap-2 flex-wrap">
          {templates.map((t, i) => (
            <button
              key={i}
              onClick={() => setMessage(t.text)}
              className="btn-outline text-xs py-1.5"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Message Input */}
      <div className="card space-y-3">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          className="input min-h-[160px] text-sm"
          placeholder="พิมพ์ข้อความที่ต้องการส่ง..."
        />
        <p className="text-[10px] text-text-secondary text-right">{message.length} ตัวอักษร</p>

        {/* Target */}
        <div>
          <p className="label">ส่งไปที่:</p>
          <div className="flex gap-2">
            {([
              { id: 'both', label: '💬 LINE + ✈️ TG', desc: 'ส่งทั้งคู่' },
              { id: 'line', label: '💬 LINE', desc: 'เฉพาะ LINE' },
              { id: 'telegram', label: '✈️ TG', desc: 'เฉพาะ Telegram' },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => setTarget(t.id)}
                className={`flex-1 py-2 px-3 rounded-lg border-2 text-center text-xs transition-all ${
                  target === t.id ? 'border-gold bg-gold/5' : 'border-gray-200'
                }`}
              >
                <div className="font-medium">{t.label}</div>
                <div className="text-[10px] text-text-secondary">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Send */}
        <button
          onClick={handleSend}
          disabled={sending || !message.trim()}
          className="btn-primary w-full text-sm disabled:opacity-50"
        >
          {sending ? '⏳ กำลังส่ง...' : '📤 ส่งข้อความ'}
        </button>

        {/* Result */}
        {result && (
          <div className={`rounded-lg p-3 text-sm ${result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {result.success ? '✅ ส่งข้อความสำเร็จ!' : `❌ ${result.error}`}
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="card bg-blue-50 border border-blue-200 text-xs text-blue-700 space-y-1">
        <p className="font-medium">วิธีใช้:</p>
        <p>• เลือก template สำเร็จรูป → แก้ไข → กดส่ง</p>
        <p>• หรือพิมพ์ข้อความอะไรก็ได้เอง</p>
        <p>• ใช้ emoji ได้ตามปกติ 🇱🇦🇰🇷🇯🇵</p>
        <p>• ขึ้นบรรทัดใหม่ได้ กด Enter</p>
      </div>
    </div>
  )
}
