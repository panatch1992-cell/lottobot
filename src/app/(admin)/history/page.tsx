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
  const [results, setResults] = useState<Record<string, { source_url: string | null }>>({})

  useEffect(() => { loadHistory() }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadHistory() {
    setLoading(true)
    const startOfDay = `${date}T00:00:00`
    const endOfDay = `${date}T23:59:59`

    const [logsRes, lotteriesRes, groupsRes, resultsRes] = await Promise.all([
      supabase.from('send_logs').select('*').gte('created_at', startOfDay).lte('created_at', endOfDay).order('created_at', { ascending: false }),
      supabase.from('lotteries').select('*'),
      supabase.from('line_groups').select('*'),
      supabase.from('results').select('id, source_url').eq('draw_date', date),
    ])

    const resultsMap: Record<string, { source_url: string | null }> = {}
    ;(resultsRes.data || []).forEach((r: { id: string; source_url: string | null }) => { resultsMap[r.id] = r })
    setResults(resultsMap)

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
  const failedCount = logs.filter(l => l.status === 'failed').length

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">ประวัติส่ง</h2>

      {/* Date + Filter */}
      <div className="flex gap-2 items-center">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input flex-1 text-sm" />
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {(['all', 'telegram', 'line'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === f ? 'bg-white shadow-sm text-text-primary' : 'text-text-secondary'
              }`}
            >
              {f === 'all' ? 'ทั้งหมด' : f === 'telegram' ? 'TG' : 'LINE'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="card text-center py-2.5">
          <p className="text-lg font-bold font-mono text-text-primary">{tgSent}</p>
          <p className="text-[10px] text-text-secondary">✈️ Telegram</p>
        </div>
        <div className="card text-center py-2.5">
          <p className="text-lg font-bold font-mono text-line-green">{lineSent}</p>
          <p className="text-[10px] text-text-secondary">💬 LINE</p>
        </div>
        <div className="card text-center py-2.5">
          <p className={`text-lg font-bold font-mono ${failedCount > 0 ? 'text-danger' : 'text-success'}`}>{failedCount}</p>
          <p className="text-[10px] text-text-secondary">{failedCount > 0 ? '✗ ล้มเหลว' : '✓ ปกติ'}</p>
        </div>
      </div>

      {/* Log List */}
      {loading ? (
        <div className="text-center py-12"><div className="animate-spin text-2xl">📋</div></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary">
          <p className="text-3xl mb-2">📭</p>
          <p className="text-sm">ไม่มีประวัติส่งในวันนี้</p>
        </div>
      ) : (
        <div className="card p-0 divide-y divide-gray-50">
          {filtered.map(log => {
            const lottery = lotteries[log.lottery_id]
            const group = log.line_group_id ? groups[log.line_group_id] : null
            const isTg = log.channel === 'telegram'

            return (
              <div key={log.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-lg">{lottery?.flag || '🎰'}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{lottery?.name || 'Unknown'}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          isTg ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'
                        }`}>
                          {isTg ? '✈️ TG' : '💬 LINE'}
                        </span>
                        {log.result_id && results[log.result_id] && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            results[log.result_id].source_url === 'manual'
                              ? 'bg-amber-50 text-amber-600'
                              : results[log.result_id].source_url?.startsWith('stock://')
                                ? 'bg-green-50 text-green-600'
                                : 'bg-purple-50 text-purple-600'
                          }`}>
                            {results[log.result_id].source_url === 'manual' ? '👤 มือ'
                              : results[log.result_id].source_url?.startsWith('stock://') ? '📈 หุ้น'
                              : '🤖 scrape'}
                          </span>
                        )}
                        {group && <span className="text-[10px] text-text-secondary">{group.name}</span>}
                        {log.duration_ms && <span className="text-[10px] text-text-secondary">{(log.duration_ms / 1000).toFixed(1)}s</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    {log.status === 'sent' && <span className="text-[11px] font-medium text-green-600">✓ สำเร็จ</span>}
                    {log.status === 'sending' && <span className="text-[11px] font-medium text-amber-500">● กำลังส่ง</span>}
                    {log.status === 'failed' && <span className="text-[11px] font-medium text-red-500">✗ ล้มเหลว</span>}
                    {log.status === 'pending' && <span className="text-[11px] text-text-secondary">⏳ รอ</span>}
                    <span className="text-[10px] text-text-secondary">
                      {log.sent_at ? new Date(log.sent_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </span>
                  </div>
                </div>
                {log.error_message && (
                  <p className="text-xs text-red-500 mt-1.5 bg-red-50 rounded-lg px-2.5 py-1.5">{log.error_message}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
