'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { today } from '@/lib/utils'
import type { Lottery, Result, SendLog, LineGroup, TodayLotteryStatus, DashboardStats } from '@/types'
import FlowDiagram from '@/components/features/FlowDiagram'
import LottoStatusCard from '@/components/features/LottoStatusCard'
import Link from 'next/link'

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalLotteries: 0, activeLotteries: 0,
    totalLineGroups: 0, activeLineGroups: 0,
    todaySent: 0, todayFailed: 0,
  })
  const [todayStatuses, setTodayStatuses] = useState<TodayLotteryStatus[]>([])
  const [loading, setLoading] = useState(true)

  const [autoConfigured, setAutoConfigured] = useState(0)
  const [flowStatus, setFlowStatus] = useState({
    autoFetch: 'inactive' as 'active' | 'inactive',
    countdownAndSchedule: 'inactive' as 'active' | 'inactive',
    telegram: 'inactive' as 'active' | 'inactive',
    line: 'inactive' as 'active' | 'inactive',
  })
  const [systemAlert, setSystemAlert] = useState<{
    type: 'error' | 'warn' | null
    title: string
    detail: string
  }>({ type: null, title: '', detail: '' })

  useEffect(() => {
    // Check system health in background
    fetch('/api/e2e-test').then(r => r.json()).then(data => {
      if (data.overall === 'FAIL') {
        const failed = data.tests.filter((t: { status: string }) => t.status === 'fail')
        setSystemAlert({
          type: 'error',
          title: '❌ ระบบมีปัญหา',
          detail: failed.map((t: { name: string; detail: string }) => `${t.name}: ${t.detail}`).join(' | '),
        })
      } else if (data.overall === 'WARN') {
        const warned = data.tests.filter((t: { status: string }) => t.status === 'warn')
        setSystemAlert({
          type: 'warn',
          title: '⚠️ มีข้อควรระวัง',
          detail: warned.map((t: { name: string; detail: string }) => `${t.name}: ${t.detail}`).join(' | '),
        })
      }
    }).catch(() => {
      // silent fail
    })
  }, [])

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    try {
      const todayStr = today()

      const [lotteriesRes, groupsRes, resultsRes, logsRes, scrapeInfoRes, settingsRes, scheduledRes] = await Promise.all([
        supabase.from('lotteries').select('*').order('sort_order'),
        supabase.from('line_groups').select('*'),
        supabase.from('results').select('*').eq('draw_date', todayStr),
        supabase.from('send_logs').select('*').gte('created_at', todayStr),
        fetch('/api/scrape-sources').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
        supabase.from('scheduled_messages').select('id', { count: 'exact', head: true }).eq('is_active', true),
      ])

      const lotteries = (lotteriesRes.data || []) as Lottery[]
      const groups = (groupsRes.data || []) as LineGroup[]
      const results = (resultsRes.data || []) as Result[]
      const logs = (logsRes.data || []) as SendLog[]

      const activeGroups = groups.filter(g => g.is_active)
      const sentLogs = logs.filter(l => l.status === 'sent')
      const failedLogs = logs.filter(l => l.status === 'failed')

      // Count auto-configured: stock + browser + scrape sources
      const stockIds = Object.keys(scrapeInfoRes.stockLotteries || {})
      const browserIds = Object.keys(scrapeInfoRes.browserLotteries || {})
      const scrapeIds = (scrapeInfoRes.sources || []).map((s: { lottery_id: string }) => s.lottery_id)
      const allAutoIds = new Set(stockIds.concat(browserIds).concat(scrapeIds))
      setAutoConfigured(allAutoIds.size)

      const settingsMap = new Map<string, string>(
        ((settingsRes?.settings || []) as { key: string; value: string }[]).map(s => [s.key, s.value || ''])
      )
      const hasTelegram = Boolean(settingsMap.get('telegram_bot_token') && settingsMap.get('telegram_admin_channel'))
      const hasUnofficialEndpoint = Boolean(settingsMap.get('unofficial_line_endpoint'))
      const hasLine = Boolean(hasUnofficialEndpoint && activeGroups.length > 0)
      const hasCountdown = settingsMap.get('send_countdown') === 'true'
      const hasScheduled = (scheduledRes.count || 0) > 0

      setFlowStatus({
        autoFetch: allAutoIds.size > 0 ? 'active' : 'inactive',
        countdownAndSchedule: hasCountdown || hasScheduled ? 'active' : 'inactive',
        telegram: hasTelegram ? 'active' : 'inactive',
        line: hasLine ? 'active' : 'inactive',
      })

      setStats({
        totalLotteries: lotteries.length,
        activeLotteries: lotteries.filter(l => l.status === 'active').length,
        totalLineGroups: groups.length,
        activeLineGroups: activeGroups.length,
        todaySent: sentLogs.length,
        todayFailed: failedLogs.length,
      })

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

  const resultsWithData = todayStatuses.filter(s => s.result)

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
      {/* System Alert */}
      {systemAlert.type && (
        <div className={`rounded-lg p-3 border ${
          systemAlert.type === 'error'
            ? 'bg-red-50 border-red-200'
            : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${
                systemAlert.type === 'error' ? 'text-red-700' : 'text-amber-700'
              }`}>
                {systemAlert.title}
              </p>
              <p className={`text-xs mt-1 ${
                systemAlert.type === 'error' ? 'text-red-600' : 'text-amber-600'
              }`}>
                {systemAlert.type === 'error'
                  ? 'ระบบมีปัญหา กรุณาตรวจสอบ'
                  : 'มีข้อควรระวัง กรุณาตรวจสอบ'}
              </p>
            </div>
            <Link
              href="/status"
              className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
                systemAlert.type === 'error'
                  ? 'bg-red-100 text-red-700 hover:bg-red-200'
                  : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
              }`}
            >
              ดูรายละเอียด →
            </Link>
          </div>
        </div>
      )}

      {/* Flow Diagram */}
      <FlowDiagram stepsState={flowStatus} />

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="card text-center py-3">
          <p className="text-2xl font-bold font-mono text-gold">{stats.activeLotteries}</p>
          <p className="text-[11px] text-text-secondary">หวยทั้งหมด</p>
        </div>
        <div className="card text-center py-3">
          <p className="text-2xl font-bold font-mono text-line-green">{stats.activeLineGroups}</p>
          <p className="text-[11px] text-text-secondary">กลุ่ม LINE</p>
        </div>
        <div className="card text-center py-3">
          <p className={`text-2xl font-bold font-mono ${stats.todayFailed > 0 ? 'text-danger' : 'text-success'}`}>{stats.todaySent}</p>
          <p className="text-[11px] text-text-secondary">
            {stats.todayFailed > 0 ? `ส่งแล้ว · ${stats.todayFailed} ล้มเหลว` : 'ส่งวันนี้'}
          </p>
        </div>
      </div>

      {/* System Status Link */}
      <Link
        href="/status"
        className="block card bg-gradient-to-r from-blue-50 to-blue-50/50 border-blue-200 hover:border-blue-300 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">🏥 ตรวจสอบสถานะระบบ</p>
            <p className="text-xs text-blue-600 mt-0.5">ทดสอบการเชื่อมต่อ + กลุ่ม LINE + VPS</p>
          </div>
          <span className="text-blue-400">→</span>
        </div>
      </Link>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/scraping"
          className="block card bg-gradient-to-r from-green-50 to-green-50/50 border-green-200 hover:border-green-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-sm">🤖 ดึงอัตโนมัติ</p>
              <p className="text-xs text-text-secondary mt-0.5">
                {autoConfigured > 0 ? `auto ${autoConfigured}/${stats.activeLotteries} หวย` : 'ยังไม่ตั้งค่า'}
              </p>
            </div>
            <span className="text-green-500">→</span>
          </div>
        </Link>
        <Link
          href="/settings"
          className="block card bg-gradient-to-r from-purple-50 to-purple-50/50 border-purple-200 hover:border-purple-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-sm">🎨 ธีม + ตั้งค่า</p>
              <p className="text-xs text-text-secondary mt-0.5">
                TG / LINE / สไตล์รูป
              </p>
            </div>
            <span className="text-purple-500">→</span>
          </div>
        </Link>
      </div>

      {/* สถานะวันนี้ */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">สถานะวันนี้</h3>
          <span className="text-xs text-text-secondary font-mono">{resultsWithData.length}/{todayStatuses.length}</span>
        </div>
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
    </div>
  )
}
