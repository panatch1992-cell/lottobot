'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { today } from '@/lib/utils'
import type { Lottery, Result, SendLog, LineGroup, TodayLotteryStatus, DashboardStats } from '@/types'
import FlowDiagram from '@/components/features/FlowDiagram'
import StatCard from '@/components/features/StatCard'
import LottoStatusCard from '@/components/features/LottoStatusCard'
import TelegramPreview from '@/components/features/TelegramPreview'
import LinePreview from '@/components/features/LinePreview'

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalLotteries: 0, activeLotteries: 0,
    totalLineGroups: 0, activeLineGroups: 0,
    todaySent: 0, todayFailed: 0,
  })
  const [todayStatuses, setTodayStatuses] = useState<TodayLotteryStatus[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    try {
      const todayStr = today()

      // Fetch all data in parallel
      const [lotteriesRes, groupsRes, resultsRes, logsRes] = await Promise.all([
        supabase.from('lotteries').select('*').order('sort_order'),
        supabase.from('line_groups').select('*'),
        supabase.from('results').select('*').eq('draw_date', todayStr),
        supabase.from('send_logs').select('*').gte('created_at', todayStr),
      ])

      const lotteries = (lotteriesRes.data || []) as Lottery[]
      const groups = (groupsRes.data || []) as LineGroup[]
      const results = (resultsRes.data || []) as Result[]
      const logs = (logsRes.data || []) as SendLog[]

      const activeGroups = groups.filter(g => g.is_active)
      const sentLogs = logs.filter(l => l.status === 'sent')
      const failedLogs = logs.filter(l => l.status === 'failed')

      setStats({
        totalLotteries: lotteries.length,
        activeLotteries: lotteries.filter(l => l.status === 'active').length,
        totalLineGroups: groups.length,
        activeLineGroups: activeGroups.length,
        todaySent: sentLogs.length,
        todayFailed: failedLogs.length,
      })

      // Build today statuses for active lotteries
      const statuses: TodayLotteryStatus[] = lotteries
        .filter(l => l.status === 'active')
        .map(lottery => {
          const result = results.find(r => r.lottery_id === lottery.id) || null
          const lotteryLogs = logs.filter(l => l.lottery_id === lottery.id)
          const tgLog = lotteryLogs.find(l => l.channel === 'telegram')
          const lineLogs = lotteryLogs.filter(l => l.channel === 'line')
          const lineGroupCount = lineLogs.filter(l => l.status === 'sent').length

          return {
            lottery,
            result,
            tgStatus: tgLog?.status || null,
            lineStatus: lineLogs.length > 0 ? (lineLogs.every(l => l.status === 'sent') ? 'sent' : lineLogs.some(l => l.status === 'failed') ? 'failed' : 'sending') : null,
            lineGroupCount,
          }
        })

      setTodayStatuses(statuses)
    } catch (err) {
      console.error('Dashboard load error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="animate-spin text-3xl mb-2">🎰</div>
          <p className="text-sm text-text-secondary">กำลังโหลด...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Flow Diagram */}
      <FlowDiagram />

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon="🎰" label="หวยทั้งหมด" value={stats.activeLotteries} sub={`จาก ${stats.totalLotteries}`} />
        <StatCard icon="💬" label="กลุ่ม LINE" value={stats.activeLineGroups} sub={`จาก ${stats.totalLineGroups}`} color="text-line-green" />
        <StatCard icon="📨" label="ส่งวันนี้" value={stats.todaySent} sub={stats.todayFailed > 0 ? `ล้มเหลว ${stats.todayFailed}` : 'ปกติ'} color={stats.todayFailed > 0 ? 'text-danger' : 'text-success'} />
      </div>

      {/* สถานะวันนี้ */}
      <div className="card">
        <h3 className="font-semibold mb-3">📊 สถานะวันนี้</h3>
        {todayStatuses.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-4">ไม่มีหวยที่ active</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {todayStatuses.map(item => (
              <LottoStatusCard key={item.lottery.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* Message Previews */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h3 className="font-semibold mb-2">✈️ ตัวอย่าง Telegram</h3>
          <TelegramPreview />
        </div>
        <div>
          <h3 className="font-semibold mb-2">💬 ตัวอย่าง LINE</h3>
          <LinePreview />
        </div>
      </div>
    </div>
  )
}
