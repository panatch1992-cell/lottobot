'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatTime } from '@/lib/utils'
import type { Lottery, LotteryStatus } from '@/types'

interface LotteryForm {
  name: string
  flag: string
  country: string
  result_time: string
  close_time: string
  source_url: string
  result_format: string
  countdown_minutes: number
  send_stats: boolean
}

const emptyForm: LotteryForm = {
  name: '', flag: '🎰', country: '', result_time: '', close_time: '',
  source_url: '', result_format: '3d_2d', countdown_minutes: 20, send_stats: true,
}

export default function LotteriesPage() {
  const [lotteries, setLotteries] = useState<Lottery[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<LotteryForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  useEffect(() => { loadLotteries() }, [])

  async function loadLotteries() {
    const { data } = await supabase.from('lotteries').select('*').order('sort_order')
    setLotteries((data || []) as Lottery[])
    setLoading(false)
  }

  async function toggleStatus(id: string, current: LotteryStatus) {
    const newStatus = current === 'active' ? 'inactive' : 'active'
    await supabase.from('lotteries').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id)
    setLotteries(prev => prev.map(l => l.id === id ? { ...l, status: newStatus } : l))
  }

  function openAdd() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  function openEdit(lottery: Lottery) {
    setForm({
      name: lottery.name, flag: lottery.flag, country: lottery.country || '',
      result_time: lottery.result_time, close_time: lottery.close_time || '',
      source_url: lottery.source_url || '', result_format: lottery.result_format,
      countdown_minutes: lottery.countdown_minutes, send_stats: lottery.send_stats,
    })
    setEditingId(lottery.id)
    setShowForm(true)
  }

  async function handleSave() {
    setSaving(true)
    const payload = {
      ...form,
      country: form.country || null,
      close_time: form.close_time || null,
      source_url: form.source_url || null,
      updated_at: new Date().toISOString(),
    }

    if (editingId) {
      await supabase.from('lotteries').update(payload).eq('id', editingId)
    } else {
      await supabase.from('lotteries').insert({ ...payload, sort_order: lotteries.length + 1 })
    }

    setShowForm(false)
    setSaving(false)
    loadLotteries()
  }

  async function handleDelete() {
    if (!deleteId) return
    await supabase.from('lotteries').delete().eq('id', deleteId)
    setDeleteId(null)
    loadLotteries()
  }

  const filtered = lotteries.filter(l =>
    l.name.includes(search) || (l.country || '').includes(search) || l.flag.includes(search)
  )

  const activeCount = filtered.filter(l => l.status === 'active').length

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin text-3xl">🎰</div></div>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">🎰 จัดการหวย</h2>
          <p className="text-xs text-text-secondary">{activeCount} เปิด / {filtered.length} ทั้งหมด</p>
        </div>
        <button onClick={openAdd} className="btn-primary text-sm">+ เพิ่มหวย</button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="🔍 ค้นหาชื่อหวย, ประเทศ..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="input"
      />

      {/* Lottery List */}
      <div className="card p-0 divide-y divide-gray-50">
        {filtered.map(lottery => (
          <div key={lottery.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-3 min-w-0 cursor-pointer" onClick={() => openEdit(lottery)}>
              <span className="text-xl">{lottery.flag}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{lottery.name}</p>
                <p className="text-xs text-text-secondary">{formatTime(lottery.result_time)} · {lottery.country || '-'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => toggleStatus(lottery.id, lottery.status)}
                className={`relative w-10 h-5 rounded-full transition-colors ${lottery.status === 'active' ? 'bg-success' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${lottery.status === 'active' ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-4">{editingId ? '✏️ แก้ไขหวย' : '➕ เพิ่มหวยใหม่'}</h3>

            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="label">ธง</label>
                  <input value={form.flag} onChange={e => setForm({ ...form, flag: e.target.value })} className="input text-center text-xl" />
                </div>
                <div className="col-span-3">
                  <label className="label">ชื่อหวย *</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input" placeholder="นิเคอิเช้า VIP" />
                </div>
              </div>

              <div>
                <label className="label">ประเทศ</label>
                <input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} className="input" placeholder="ญี่ปุ่น" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">เวลาออกผล *</label>
                  <input type="time" value={form.result_time} onChange={e => setForm({ ...form, result_time: e.target.value })} className="input" />
                </div>
                <div>
                  <label className="label">เวลาปิดรับ</label>
                  <input type="time" value={form.close_time} onChange={e => setForm({ ...form, close_time: e.target.value })} className="input" />
                </div>
              </div>

              <div>
                <label className="label">URL ดึงผล</label>
                <input value={form.source_url} onChange={e => setForm({ ...form, source_url: e.target.value })} className="input" placeholder="https://..." />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">รูปแบบผล</label>
                  <select value={form.result_format} onChange={e => setForm({ ...form, result_format: e.target.value })} className="input">
                    <option value="3d_2d">3 ตัว + 2 ตัว</option>
                    <option value="3d_only">3 ตัวอย่างเดียว</option>
                    <option value="6d">6 ตัว</option>
                    <option value="custom">กำหนดเอง</option>
                  </select>
                </div>
                <div>
                  <label className="label">Countdown (นาที)</label>
                  <input type="number" value={form.countdown_minutes} onChange={e => setForm({ ...form, countdown_minutes: Number(e.target.value) })} className="input" />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.send_stats} onChange={e => setForm({ ...form, send_stats: e.target.checked })} className="rounded" />
                <span className="text-sm">ส่งสถิติ 10 งวดหลังออกผล</span>
              </label>
            </div>

            <div className="flex gap-2 mt-5">
              {editingId && (
                <button onClick={() => { setDeleteId(editingId); setShowForm(false) }} className="btn-danger text-sm flex-none">ลบ</button>
              )}
              <button onClick={() => setShowForm(false)} className="btn-outline text-sm flex-1">ยกเลิก</button>
              <button onClick={handleSave} disabled={saving || !form.name || !form.result_time} className="btn-primary text-sm flex-1 disabled:opacity-50">
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setDeleteId(null)}>
          <div className="bg-white rounded-2xl p-5 max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">⚠️ ยืนยันลบหวย</h3>
            <p className="text-sm text-text-secondary mb-4">ลบแล้วจะกู้คืนไม่ได้ รวมถึงผลหวยและประวัติส่งทั้งหมดของหวยนี้</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteId(null)} className="btn-outline text-sm flex-1">ยกเลิก</button>
              <button onClick={handleDelete} className="btn-danger text-sm flex-1">ลบถาวร</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
