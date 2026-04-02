'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Lottery } from '@/types'

interface GroupInfo {
  id: string
  name: string
  line_group_id: string | null
  is_active: boolean
  custom_link: string | null
  custom_message: string | null
  send_all_lotteries: boolean
}

interface GroupLottery {
  lottery_id: string
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupInfo[]>([])
  const [lotteries, setLotteries] = useState<Lottery[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState<GroupInfo | null>(null)
  const [groupLotteries, setGroupLotteries] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [editLink, setEditLink] = useState('')
  const [editMessage, setEditMessage] = useState('')
  const [sendAll, setSendAll] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [{ data: g }, { data: l }] = await Promise.all([
      supabase.from('line_groups').select('*').order('created_at'),
      supabase.from('lotteries').select('*').eq('status', 'active').order('sort_order'),
    ])
    setGroups((g || []) as GroupInfo[])
    setLotteries((l || []) as Lottery[])
    setLoading(false)
  }

  async function selectGroup(group: GroupInfo) {
    setSelectedGroup(group)
    setEditLink(group.custom_link || '')
    setEditMessage(group.custom_message || '')
    setSendAll(group.send_all_lotteries)

    const { data } = await supabase.from('group_lotteries')
      .select('lottery_id')
      .eq('group_id', group.id)
    setGroupLotteries(new Set((data || []).map((gl: GroupLottery) => gl.lottery_id)))
  }

  async function toggleLottery(lotteryId: string) {
    if (!selectedGroup) return
    const next = new Set(groupLotteries)
    if (next.has(lotteryId)) {
      next.delete(lotteryId)
      await supabase.from('group_lotteries')
        .delete()
        .eq('group_id', selectedGroup.id)
        .eq('lottery_id', lotteryId)
    } else {
      next.add(lotteryId)
      await supabase.from('group_lotteries')
        .insert({ group_id: selectedGroup.id, lottery_id: lotteryId })
    }
    setGroupLotteries(next)
  }

  async function selectAll() {
    if (!selectedGroup) return
    await supabase.from('group_lotteries').delete().eq('group_id', selectedGroup.id)
    const inserts = lotteries.map(l => ({ group_id: selectedGroup.id, lottery_id: l.id }))
    await supabase.from('group_lotteries').insert(inserts)
    setGroupLotteries(new Set(lotteries.map(l => l.id)))
  }

  async function clearAll() {
    if (!selectedGroup) return
    await supabase.from('group_lotteries').delete().eq('group_id', selectedGroup.id)
    setGroupLotteries(new Set())
  }

  async function saveGroupSettings() {
    if (!selectedGroup) return
    setSaving(true)
    await supabase.from('line_groups').update({
      custom_link: editLink || null,
      custom_message: editMessage || null,
      send_all_lotteries: sendAll,
      updated_at: new Date().toISOString(),
    }).eq('id', selectedGroup.id)
    setSaving(false)
    loadData()
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin text-3xl">👥</div></div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">👥 จัดการกลุ่ม LINE</h2>
        <p className="text-xs text-text-secondary">ตั้งค่าลิงก์ + เลือกหวยแยกต่อกลุ่ม</p>
      </div>

      {/* Group List */}
      <div className="card p-0 divide-y divide-gray-50">
        {groups.map(group => (
          <div key={group.id}>
            <div
              className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${selectedGroup?.id === group.id ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
              onClick={() => selectGroup(group)}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{group.name}</p>
                <p className="text-xs text-text-secondary">
                  {group.line_group_id ? `ID: ••••${group.line_group_id.slice(-6)}` : 'ไม่มี ID'}
                  {group.custom_link && ' · 🔗 มีลิงก์'}
                  {!group.send_all_lotteries && ' · 🎯 เลือกหวย'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`w-2 h-2 rounded-full ${group.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="text-xs text-text-secondary">{selectedGroup?.id === group.id ? '▼' : '▶'}</span>
              </div>
            </div>

            {/* Expanded */}
            {selectedGroup?.id === group.id && (
              <div className="bg-gray-50 px-4 py-4 space-y-4">
                {/* Custom Link */}
                <div>
                  <label className="label">🔗 ลิงก์ส่งท้ายข้อความ</label>
                  <input
                    value={editLink}
                    onChange={e => setEditLink(e.target.value)}
                    className="input text-xs font-mono"
                    placeholder="https://example.com/group1"
                  />
                  <p className="text-[10px] text-text-secondary mt-0.5">ลิงก์จะแนบท้ายข้อความผลหวยของกลุ่มนี้</p>
                </div>

                {/* Custom Message */}
                <div>
                  <label className="label">💬 ข้อความเพิ่มเติม (ต่อท้าย)</label>
                  <textarea
                    value={editMessage}
                    onChange={e => setEditMessage(e.target.value)}
                    className="input text-xs min-h-[60px]"
                    placeholder="ข้อความเพิ่มเติมสำหรับกลุ่มนี้..."
                  />
                </div>

                {/* Send All or Select */}
                <div>
                  <label className="label">🎰 หวยที่ส่งให้กลุ่มนี้</label>
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={() => setSendAll(true)}
                      className={`flex-1 py-2 rounded-lg border-2 text-xs text-center ${sendAll ? 'border-gold bg-gold/5' : 'border-gray-200'}`}
                    >
                      ส่งทั้งหมด (43)
                    </button>
                    <button
                      onClick={() => setSendAll(false)}
                      className={`flex-1 py-2 rounded-lg border-2 text-xs text-center ${!sendAll ? 'border-gold bg-gold/5' : 'border-gray-200'}`}
                    >
                      🎯 เลือกเอง
                    </button>
                  </div>

                  {!sendAll && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <button onClick={selectAll} className="btn-outline text-[10px] py-1">เลือกทั้งหมด</button>
                        <button onClick={clearAll} className="btn-outline text-[10px] py-1">ล้างทั้งหมด</button>
                        <span className="text-[10px] text-text-secondary self-center">{groupLotteries.size}/{lotteries.length}</span>
                      </div>
                      <div className="max-h-[200px] overflow-y-auto border rounded-lg bg-white divide-y divide-gray-50">
                        {lotteries.map(l => (
                          <label key={l.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={groupLotteries.has(l.id)}
                              onChange={() => toggleLottery(l.id)}
                              className="rounded"
                            />
                            <span className="text-xs">{l.flag} {l.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Save */}
                <button
                  onClick={saveGroupSettings}
                  disabled={saving}
                  className="btn-primary w-full text-sm disabled:opacity-50"
                >
                  {saving ? 'กำลังบันทึก...' : '💾 บันทึกการตั้งค่ากลุ่ม'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {groups.length === 0 && (
        <div className="text-center py-8 text-text-secondary">
          <p className="text-2xl mb-2">📭</p>
          <p className="text-sm">ยังไม่มีกลุ่ม LINE — เชิญ Bot เข้ากลุ่มเพื่อเริ่มใช้งาน</p>
        </div>
      )}

      {/* Guide */}
      <div className="card bg-blue-50 border border-blue-200 text-xs text-blue-700 space-y-1">
        <p className="font-medium">วิธีใช้:</p>
        <p>{'• เลือกกลุ่ม → ตั้งลิงก์/ข้อความแยกได้'}</p>
        <p>{'• เลือก "ส่งทั้งหมด" หรือ "เลือกเอง" เพื่อกำหนดหวยที่จะส่ง'}</p>
        <p>{'• แต่ละกลุ่มจะได้รับเฉพาะหวยที่เลือกไว้เท่านั้น'}</p>
      </div>
    </div>
  )
}
