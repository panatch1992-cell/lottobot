'use client'

import { useEffect, useState } from 'react'
import { today } from '@/lib/utils'
import type { Lottery, LineGroup } from '@/types'

type HistoryEntry = {
  id: string
  source: 'legacy' | 'pipeline'
  lottery_id: string | null
  line_group_id: string | null
  channel: 'telegram' | 'line'
  msg_type: string
  status: string
  sent_at: string | null
  duration_ms: number | null
  error_message: string | null
  result_id: string | null
  target_name: string | null
  provider: string | null
}

type HistoryResponse = {
  date: string
  entries: HistoryEntry[]
  lotteries: Lottery[]
  groups: LineGroup[]
  results: Array<{ id: string; source_url: string | null }>
  counts: { total: number; legacy: number; pipeline: number; sent: number; failed: number }
}

export default function HistoryPage() {
  const [date, setDate] = useState(today())
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'telegram' | 'line'>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'legacy' | 'pipeline'>('all')

  useEffect(() => { loadHistory() }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadHistory() {
    setLoading(true)
    try {
      const res = await fetch(`/api/history?date=${date}`)
      const json = (await res.json()) as HistoryResponse
      setData(json)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const lotteries: Record<string, Lottery> = {}
  ;(data?.lotteries || []).forEach(l => { lotteries[l.id] = l })

  const groups: Record<string, LineGroup> = {}
  ;(data?.groups || []).forEach(g => { groups[g.id] = g })

  const results: Record<string, { source_url: string | null }> = {}
  ;(data?.results || []).forEach(r => { results[r.id] = r })

  const entries = data?.entries || []
  const filtered = entries.filter(e => {
    if (filter !== 'all' && e.channel !== filter) return false
    if (sourceFilter !== 'all' && e.source !== sourceFilter) return false
    return true
  })

  const tgSent = entries.filter(l => l.channel === 'telegram' && l.status === 'sent').length
  const lineSent = entries.filter(l => l.channel === 'line' && l.status === 'sent').length
  const failedCount = entries.filter(l => l.status === 'failed').length

  return (
    <div className="space-y-4">
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

      {/* Source filter (legacy vs pipeline) */}
      <div className="flex bg-gray-100 rounded-lg p-0.5">
        {(['all', 'pipeline', 'legacy'] as const).map(s => (
          <button
            key={s}
            onClick={() => setSourceFilter(s)}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              sourceFilter === s ? 'bg-white shadow-sm text-text-primary' : 'text-text-secondary'
            }`}
          >
            {s === 'all' ? 'ทุกแหล่ง' : s === 'pipeline' ? 'Event Pipeline' : 'Legacy'}
          </button>
        ))}
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

      {/* Breakdown */}
      {data && (
        <div className="text-[11px] text-text-secondary flex gap-3">
          <span>Pipeline: {data.counts.pipeline}</span>
          <span>Legacy: {data.counts.legacy}</span>
        </div>
      )}

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
            const lottery = log.lottery_id ? lotteries[log.lottery_id] : null
            const group = log.line_group_id ? groups[log.line_group_id] : null
            const isTg = log.channel === 'telegram'
            const isTriggerSend = log.msg_type === 'trigger_send'
            const isTriggerReply = log.msg_type === 'trigger_reply'

            const displayIcon = isTriggerSend
              ? '📤'
              : (lottery?.flag || (isTriggerReply ? '💬' : '🎰'))
            const displayName = isTriggerSend
              ? 'Trigger Send (.)'
              : (lottery?.name || log.target_name || (isTriggerReply ? 'Reply' : 'Unknown'))
            const displaySuffix = isTriggerReply && lottery ? ' 📢' : ''

            return (
              <div key={log.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-lg">{displayIcon}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{displayName}{displaySuffix}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          isTg ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'
                        }`}>
                          {isTg ? '✈️ TG' : '💬 LINE'}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          log.source === 'pipeline' ? 'bg-purple-50 text-purple-600' : 'bg-gray-50 text-gray-500'
                        }`}>
                          {log.source === 'pipeline' ? '⚡ pipe' : '📜 legacy'}
                        </span>
                        {log.result_id && results[log.result_id] && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            results[log.result_id].source_url === 'manual'
                              ? 'bg-amber-50 text-amber-600'
                              : results[log.result_id].source_url?.startsWith('stock://')
                                ? 'bg-green-50 text-green-600'
                                : results[log.result_id].source_url?.startsWith('browser://')
                                  ? 'bg-blue-50 text-blue-600'
                                  : 'bg-purple-50 text-purple-600'
                          }`}>
                            {results[log.result_id].source_url === 'manual' ? '👤 มือ'
                              : results[log.result_id].source_url?.startsWith('stock://') ? '📈 หุ้น'
                              : results[log.result_id].source_url?.startsWith('browser://') ? '🌐 auto'
                              : '🤖 scrape'}
                          </span>
                        )}
                        {group && <span className="text-[10px] text-text-secondary">{group.name}</span>}
                        {!group && log.target_name && <span className="text-[10px] text-text-secondary">{log.target_name}</span>}
                        {log.duration_ms && <span className="text-[10px] text-text-secondary">{(log.duration_ms / 1000).toFixed(1)}s</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    {log.status === 'sent' && <span className="text-[11px] font-medium text-green-600">✓ สำเร็จ</span>}
                    {log.status === 'sending' && <span className="text-[11px] font-medium text-amber-500">● กำลังส่ง</span>}
                    {log.status === 'failed' && <span className="text-[11px] font-medium text-red-500">✗ ล้มเหลว</span>}
                    {log.status === 'pending' && <span className="text-[11px] text-text-secondary">⏳ รอ</span>}
                    {log.status === 'skipped' && <span className="text-[11px] text-text-secondary">— ข้าม</span>}
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
