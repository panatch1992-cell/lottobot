'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface LuckyImage {
  id: string
  public_url: string
  category: string
  caption: string | null
  use_count: number
  last_used_at: string | null
  uploaded_by: string | null
  uploaded_at: string
  is_active: boolean
}

interface Stats {
  total: number
  active: number
  inactive: number
  totalUse: number
}

const CATEGORIES = ['general', 'laos', 'vietnam', 'stock', 'china', 'korea', 'japan', 'thai', 'other']

export default function LuckyImagesPage() {
  const [items, setItems] = useState<LuckyImage[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, inactive: 0, totalUse: 0 })
  const [loading, setLoading] = useState(true)
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [newUrl, setNewUrl] = useState('')
  const [newCategory, setNewCategory] = useState('general')
  const [newCaption, setNewCaption] = useState('')
  const [adding, setAdding] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [debugging, setDebugging] = useState(false)
  const [debugResult, setDebugResult] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  async function load() {
    setLoading(true)
    const q = filterCategory ? `?category=${filterCategory}` : ''
    const res = await fetch(`/api/admin/lucky-images${q}`)
    const data = await res.json()
    if (res.ok) {
      setItems(data.items || [])
      setStats(data.stats || { total: 0, active: 0, inactive: 0, totalUse: 0 })
    } else {
      setMessage({ type: 'err', text: data.error || 'load failed' })
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCategory])

  async function addImage() {
    if (!newUrl.trim()) return
    setAdding(true)
    setMessage(null)
    const res = await fetch('/api/admin/lucky-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_url: newUrl.trim(),
        category: newCategory,
        caption: newCaption.trim() || undefined,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setNewUrl('')
      setNewCaption('')
      setMessage({ type: 'ok', text: 'เพิ่มรูปแล้ว' })
      await load()
    } else {
      setMessage({ type: 'err', text: data.error || 'เพิ่มไม่สำเร็จ' })
    }
    setAdding(false)
  }

  async function syncFromHuaypnk() {
    if (!confirm('ดึงรูปจาก huaypnk.com/top ตอนนี้?')) return
    setSyncing(true)
    setMessage(null)
    const res = await fetch('/api/admin/lucky-images/sync-huaypnk', { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      setMessage({
        type: 'ok',
        text: `เพิ่ม ${data.added} รูป · ข้าม ${data.skipped} ซ้ำ · fail ${data.failed}`,
      })
      await load()
    } else {
      setMessage({ type: 'err', text: data.error || 'sync ล้มเหลว' })
    }
    setSyncing(false)
  }

  async function runDebug() {
    setDebugging(true)
    setDebugResult(null)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/lucky-images/debug-huaypnk')
      const data = await res.json()
      setDebugResult(data)
      if (data.ok) {
        setMessage({
          type: 'ok',
          text: `Debug: HTTP ${data.httpStatus}, ${data.imgTotal} imgs, accepted ${data.imgAccepted}`,
        })
      } else {
        setMessage({
          type: 'err',
          text: `Debug: HTTP ${data.httpStatus || '?'}, ${data.imgTotal || 0} imgs, 0 accepted — see details`,
        })
      }
    } catch (err) {
      setMessage({ type: 'err', text: err instanceof Error ? err.message : 'debug failed' })
    }
    setDebugging(false)
  }

  async function toggleActive(item: LuckyImage) {
    await fetch(`/api/admin/lucky-images?id=${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !item.is_active }),
    })
    await load()
  }

  async function deleteImage(item: LuckyImage) {
    if (!confirm('ลบรูปนี้?')) return
    await fetch(`/api/admin/lucky-images?id=${item.id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <Link href="/dev" className="text-text-secondary hover:text-text-primary">
          ← Dev Tools
        </Link>
        <span className="text-text-secondary">/</span>
        <span className="text-text-primary">คลังรูปเลขเด็ด</span>
      </div>

      <div className="mb-4">
        <h1 className="text-2xl font-bold text-text-primary">📸 คลังรูปเลขเด็ด</h1>
        <p className="text-sm text-text-secondary mt-1">
          รูปที่ใช้ใน Reply API (Hybrid mode) — DB 100% ไม่ต้อง scrape ตอน runtime
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="bg-white rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-text-primary">{stats.total}</div>
          <div className="text-xs text-text-secondary">ทั้งหมด</div>
        </div>
        <div className="bg-white rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-success">{stats.active}</div>
          <div className="text-xs text-text-secondary">ใช้งาน</div>
        </div>
        <div className="bg-white rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-text-secondary">{stats.inactive}</div>
          <div className="text-xs text-text-secondary">ปิด</div>
        </div>
        <div className="bg-white rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-gold">{stats.totalUse}</div>
          <div className="text-xs text-text-secondary">ส่งไปแล้ว</div>
        </div>
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

      {/* Actions */}
      <div className="bg-white rounded-lg p-4 mb-4 space-y-3">
        <div className="flex gap-2">
          <button
            onClick={syncFromHuaypnk}
            disabled={syncing}
            className="flex-1 py-2 px-4 bg-gold text-white rounded-lg font-medium disabled:opacity-50"
          >
            {syncing ? 'กำลังดึง...' : '🔁 Sync จาก huaypnk.com/top'}
          </button>
          <button
            onClick={runDebug}
            disabled={debugging}
            className="py-2 px-3 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-50"
            title="ดูรายละเอียดว่าทำไม sync ได้ 0 รูป"
          >
            {debugging ? '...' : '🔍 Debug'}
          </button>
        </div>

        {/* Debug result panel */}
        {debugResult && (
          <div className="border rounded-lg p-3 bg-gray-50 text-xs space-y-2">
            <div className="font-semibold flex items-center gap-2">
              <span>🔬 Debug huaypnk</span>
              <button
                onClick={() => setDebugResult(null)}
                className="ml-auto text-gray-500 hover:text-gray-800"
              >
                ✕
              </button>
            </div>
            <pre className="text-[10px] bg-white p-2 rounded border overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(
                {
                  httpStatus: debugResult.httpStatus,
                  contentLength: debugResult.contentLength,
                  latencyMs: debugResult.latencyMs,
                  imgTotal: debugResult.imgTotal,
                  imgWithSrc: debugResult.imgWithSrc,
                  imgAccepted: debugResult.imgAccepted,
                  fetchError: debugResult.fetchError,
                  sampleSrcs: debugResult.sampleSrcs,
                  bgImageHints: debugResult.bgImageHints,
                  acceptedImages: debugResult.acceptedImages,
                },
                null,
                2,
              )}
            </pre>
          </div>
        )}

        <div className="border-t pt-3">
          <div className="text-sm font-medium mb-2">เพิ่มรูปจาก URL</div>
          <input
            type="url"
            placeholder="https://..."
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg mb-2 text-sm"
          />
          <div className="flex gap-2 mb-2">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="คำอธิบาย (optional)"
              value={newCaption}
              onChange={(e) => setNewCaption(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <button
            onClick={addImage}
            disabled={adding || !newUrl.trim()}
            className="w-full py-2 px-4 bg-success text-white rounded-lg font-medium disabled:opacity-50"
          >
            {adding ? 'กำลังเพิ่ม...' : '+ เพิ่มรูป'}
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="mb-3 flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterCategory('')}
          className={`px-3 py-1 rounded-full text-xs ${
            filterCategory === '' ? 'bg-gold text-white' : 'bg-white text-text-secondary'
          }`}
        >
          ทั้งหมด
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setFilterCategory(c)}
            className={`px-3 py-1 rounded-full text-xs ${
              filterCategory === c ? 'bg-gold text-white' : 'bg-white text-text-secondary'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center text-text-secondary py-8">กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div className="text-center text-text-secondary py-8 bg-white rounded-lg">
          ยังไม่มีรูปในคลัง กด &quot;🔁 Sync จาก huaypnk&quot; หรือเพิ่มจาก URL
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className={`bg-white rounded-lg overflow-hidden border ${
                item.is_active ? 'border-transparent' : 'border-dashed border-gray-300 opacity-60'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.public_url}
                alt={item.caption || item.category}
                className="w-full h-32 object-cover bg-gray-100"
                loading="lazy"
              />
              <div className="p-2 space-y-1">
                <div className="text-xs text-text-primary truncate">
                  {item.caption || '(ไม่มีคำอธิบาย)'}
                </div>
                <div className="text-[10px] text-text-secondary flex justify-between">
                  <span>📁 {item.category}</span>
                  <span>👁 {item.use_count}</span>
                </div>
                <div className="flex gap-1 pt-1">
                  <button
                    onClick={() => toggleActive(item)}
                    className={`flex-1 text-[10px] py-1 rounded ${
                      item.is_active ? 'bg-gray-200 text-gray-700' : 'bg-success text-white'
                    }`}
                  >
                    {item.is_active ? 'ปิด' : 'เปิด'}
                  </button>
                  <button
                    onClick={() => deleteImage(item)}
                    className="flex-1 text-[10px] py-1 rounded bg-red-100 text-red-700"
                  >
                    ลบ
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
