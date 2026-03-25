'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { today } from '@/lib/utils'
import type { SendLog, Lottery, LineGroup } from '@/types'

export default function HistoryPage() {
  const [date, setDate] = useState(today())
  const [logs, setLogs] = useState<SendLog[]>([])
  const [lotteries, setLotteries] = useState<Record<string, Lottery>>({})
  const [groups, setGroups] = useState<Record<string, LineGroup>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'telegram' | 'line'>('all')

  useEffect(() => { loadHistory() }, [date])

  async function loadHistory() {
    setLoading(true)
    const startOfDay = `${date}T00:00:00`
    const endOfDay = `${date}T23:59:59`

    const [logsRes, lotteriesRes, groupsRes] = await Promise.all([
      supabase.from('send_logs').select('*').gte('created_at', startOfDay).lte('created_at', endOfDay).order('created_at', { ascending: false }),
      supabase.from('lotteries').select('*'),
      supabase.from('line_groups').select('*'),
    ])

    const lotteriesMap: Record<string, Lottery> = {}
    ;(lotteriesRes.data || []).forEach((l: Lottery) => { lotteriesMap[l.id] = l })

    const groupsMap: Record<string, LineGroup> = {}
    ;(groupsRes.data || []).forEach((g: LineGroup) => { groupsMap[g.id] = g })

    setLogs((logsRes.data || []) as SendLog[])
    setLotteries(lotteriesMap)
    setGroups(groupsMap)
    setLoading(false)
  }

  const filtered = filter === 'all' ? logs : logs.filter(l => l.channel === filter)
  const tgSent = logs.filter(l => l.channel === 'telegram' && l.status === 'sent').length
  const lineSent = logs.filter(l => l.channel === 'line' && l.status === 'sent').length
  const lineGroups = new Set(logs.filter(l => l.channel === 'line' && l.status === 'sent').map(l => l.line_group_id)).size
  const failedCount = logs.filter(l => l.status === 'failed').length

  function statusBadge(status: string) {
    if (status === 'sent') return <span className="badge-success">✓ สำเร็จ</span>
    if (status === 'sending') return <span className="badge-warn">● กำลังส่ง</span>
    if (status === 'failed') return <span className="badge-danger">✗ ล้มเหลว</span>
    return <span className="badge-gray">⏳ รอ</span>
  }

  function msgTypeBadge(type: string) {
    if (type === 'result') return <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">ผล</span>
    if (type === 'countdown') return <span className="text-[10px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded">⏰</span>
    if (type === 'stats') return <span className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">📊</span>
    return null
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">📋 ประวัติส่ง</h2>

      {/* Date + Filter */}
      <div className="flex gap-2 items-center">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input flex-1" />
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="input w-auto">
          <option value="all">ทั้งหมด</option>
          <option value="telegram">Telegram</option>
          <option value="line">LINE</option>
        </select>
      </div>

      {/* Stats Summary */}
      <div className="card bg-gradient-to-r from-gold/5 to-success/5">
        <p className="text-sm font-medium">📊 สรุปวันนี้</p>
        <p className="text-xs text-text-secondary mt-1">
          ส่งสำเร็จ TG <span className="font-mono font-bold text-text-primary">{tgSent}</span> → LINE <span className="font-mono font-bold text-line-green">{lineSent}</span> ({lineGroups} กลุ่ม)
          {failedCount > 0 && <span className="text-danger ml-2">· ล้มเหลว {failedCount}</span>}
        </p>
      </div>

      {/* Log List */}
      {loading ? (
        <div className="text-center py-8"><div className="animate-spin text-2xl">📋</div></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-text-secondary text-center py-8">ไม่มีประวัติส่งในวันนี้</p>
      ) : (
        <div className="card p-0 divide-y divide-gray-50">
          {filtered.map(log => {
            const lottery = lotteries[log.lottery_id]
            const group = log.line_group_id ? groups[log.line_group_id] : null
            return (
              <div key={log.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg">{lottery?.flag || '🎰'}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium truncate">{lottery?.name || 'Unknown'}</p>
                        {msgTypeBadge(log.msg_type)}
                      </div>
                      <p className="text-xs text-text-secondary">
                        {log.channel === 'telegram' ? '✈️ Telegram' : '💬 LINE'}
                        {group && ` · ${group.name}`}
                        {log.duration_ms && ` · ${(log.duration_ms / 1000).toFixed(1)}วิ`}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    {statusBadge(log.status)}
                    <span className="text-[10px] text-text-secondary">
                      {log.sent_at ? new Date(log.sent_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </span>
                  </div>
                </div>
                {log.error_message && (
                  <p className="text-xs text-danger mt-1 bg-danger/5 rounded px-2 py-1">{log.error_message}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
