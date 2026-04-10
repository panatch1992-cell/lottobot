'use client'

/**
 * Dev Dashboard — Technical view for developers
 * Access: /dev (hidden from user nav)
 *
 * Shows:
 * - VPS /health detailed info
 * - Anti-ban counters + circuit breaker
 * - Token debug info
 * - Recent send logs with errors
 * - Config values
 * - Database stats
 * - Quick actions (reset breaker, re-login, etc)
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'

type HealthData = {
  ok: boolean
  runtime?: string
  clientReady?: boolean
  mode?: string
  hasAuthToken?: boolean
  hasLineToken?: boolean
  hasUnofficialToken?: boolean
  tokenDebug?: {
    length?: number
    parts?: number
    decoded?: { aid?: string; exp?: number; cmode?: string; ctype?: string } | string
  } | null
  token?: {
    expired?: boolean
    expiresIn?: string
    expiresAt?: string
    refreshExpiry?: string | null
  } | null
  antiBan?: {
    config?: Record<string, number>
    counters?: {
      day?: { sent: number; limit: number; remaining: number }
      hour?: { sent: number; limit: number; remaining: number }
      minute?: { sent: number; limit: number; remaining: number }
    }
    circuitBreaker?: {
      isOpen: boolean
      failures: number
      threshold: number
      cooldownRemainingMs: number
    }
  }
  now?: string
}

type SendLog = {
  id: string
  created_at: string
  channel: string
  msg_type: string
  status: string
  error_message: string | null
  duration_ms: number | null
  line_group_id: string | null
}

type DbStats = {
  lotteries: number
  activeLotteries: number
  groups: number
  activeGroups: number
  resultsToday: number
  sendLogs1h: number
  sendLogsSuccess1h: number
}

export default function DevDashboard() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [recentLogs, setRecentLogs] = useState<SendLog[]>([])
  const [dbStats, setDbStats] = useState<DbStats | null>(null)
  const [endpoint, setEndpoint] = useState('')
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)

  async function loadAll() {
    setLoading(true)
    try {
      // Get endpoint from settings
      const settingsRes = await fetch('/api/settings')
      const { settings } = await settingsRes.json()
      const settingsMap: Record<string, string> = {}
      ;(settings || []).forEach((s: { key: string; value: string }) => { settingsMap[s.key] = s.value })
      const ep = (settingsMap.unofficial_line_endpoint || '').replace(/\/+$/, '')
      setEndpoint(ep)

      // Fetch VPS health
      if (ep) {
        try {
          const res = await fetch(`${ep}/health`, { signal: AbortSignal.timeout(10000) })
          const data = await res.json()
          setHealth(data)
          setHealthError(null)
        } catch (err) {
          setHealthError(err instanceof Error ? err.message : 'Unknown error')
          setHealth(null)
        }
      }

      // Fetch recent send logs (from supabase)
      const supabase = getSupabase()
      const oneHourAgo = new Date(Date.now() - 3600000).toISOString()
      const { data: logs } = await supabase
        .from('send_logs')
        .select('id, created_at, channel, msg_type, status, error_message, duration_ms, line_group_id')
        .gte('created_at', oneHourAgo)
        .order('created_at', { ascending: false })
        .limit(30)
      setRecentLogs(logs || [])

      // DB stats
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
      const [
        { count: lotteryCount },
        { count: activeLotteryCount },
        { count: groupCount },
        { count: activeGroupCount },
        { count: resultsTodayCount },
        { count: logs1hCount },
        { count: logsSuccess1hCount },
      ] = await Promise.all([
        supabase.from('lotteries').select('*', { count: 'exact', head: true }),
        supabase.from('lotteries').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('line_groups').select('*', { count: 'exact', head: true }),
        supabase.from('line_groups').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('results').select('*', { count: 'exact', head: true }).eq('draw_date', todayStr),
        supabase.from('send_logs').select('*', { count: 'exact', head: true }).gte('created_at', oneHourAgo),
        supabase.from('send_logs').select('*', { count: 'exact', head: true }).gte('created_at', oneHourAgo).eq('status', 'sent'),
      ])

      setDbStats({
        lotteries: lotteryCount || 0,
        activeLotteries: activeLotteryCount || 0,
        groups: groupCount || 0,
        activeGroups: activeGroupCount || 0,
        resultsToday: resultsTodayCount || 0,
        sendLogs1h: logs1hCount || 0,
        sendLogsSuccess1h: logsSuccess1hCount || 0,
      })
    } catch (err) {
      console.error('Dev dashboard load error:', err)
    }
    setLoading(false)
  }

  async function resetAntiBan() {
    if (!confirm('Reset anti-ban counters + circuit breaker?')) return
    try {
      // Get unofficial auth token for the VPS
      const settingsRes = await fetch('/api/settings')
      const { settings } = await settingsRes.json()
      const settingsMap: Record<string, string> = {}
      ;(settings || []).forEach((s: { key: string; value: string }) => { settingsMap[s.key] = s.value })
      const authToken = settingsMap.unofficial_line_token || ''

      const res = await fetch(`${endpoint}/anti-ban/reset`, {
        method: 'POST',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      })
      const data = await res.json()
      alert(data.success ? '✅ Reset สำเร็จ' : `❌ ${data.error || 'fail'}`)
      loadAll()
    } catch (err) {
      alert(`❌ ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(loadAll, 10000)
    return () => clearInterval(interval)
  }, [autoRefresh]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🔧 Dev Dashboard</h1>
          <p className="text-xs text-text-secondary">Technical view — for developers only</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          <span>Auto-refresh 10s</span>
        </label>
      </div>

      {/* Navigation to other pages */}
      <div className="flex gap-2 flex-wrap text-xs">
        <Link href="/dashboard" className="px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">← User Dashboard</Link>
        <Link href="/status" className="px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">🏥 Status</Link>
        <Link href="/settings" className="px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">⚙️ Settings</Link>
        <Link href="/history" className="px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">📋 History</Link>
        <button onClick={loadAll} disabled={loading} className="px-3 py-1 bg-gold/20 text-gold rounded hover:bg-gold/30 disabled:opacity-50">
          {loading ? '⏳' : '🔄'} Refresh
        </button>
      </div>

      {/* DB Stats */}
      {dbStats && (
        <div className="card space-y-2">
          <h3 className="text-sm font-semibold">💾 Database Stats</h3>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <p className="text-xl font-mono font-bold">{dbStats.activeLotteries}/{dbStats.lotteries}</p>
              <p className="text-[10px] text-text-secondary">Active lotteries</p>
            </div>
            <div>
              <p className="text-xl font-mono font-bold">{dbStats.activeGroups}/{dbStats.groups}</p>
              <p className="text-[10px] text-text-secondary">Active groups</p>
            </div>
            <div>
              <p className="text-xl font-mono font-bold text-green-600">{dbStats.resultsToday}</p>
              <p className="text-[10px] text-text-secondary">Results today</p>
            </div>
            <div>
              <p className={`text-xl font-mono font-bold ${dbStats.sendLogs1h > 0 ? (dbStats.sendLogsSuccess1h / dbStats.sendLogs1h < 0.5 ? 'text-red-600' : 'text-green-600') : 'text-gray-400'}`}>
                {dbStats.sendLogsSuccess1h}/{dbStats.sendLogs1h}
              </p>
              <p className="text-[10px] text-text-secondary">Sends success (1h)</p>
            </div>
          </div>
        </div>
      )}

      {/* VPS Health */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">🖥️ VPS Health</h3>
          <span className="text-[10px] text-text-secondary font-mono">{endpoint || 'Not configured'}</span>
        </div>

        {healthError && (
          <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">
            ❌ {healthError}
          </div>
        )}

        {health && (
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded p-2">
                <span className="text-text-secondary">Runtime:</span>{' '}
                <span className="font-mono">{health.runtime || '-'}</span>
              </div>
              <div className="bg-gray-50 rounded p-2">
                <span className="text-text-secondary">Mode:</span>{' '}
                <span className="font-mono">{health.mode || '-'}</span>
              </div>
              <div className={`rounded p-2 ${health.clientReady ? 'bg-green-50' : 'bg-red-50'}`}>
                <span className="text-text-secondary">Client Ready:</span>{' '}
                <span className={`font-mono font-bold ${health.clientReady ? 'text-green-700' : 'text-red-700'}`}>
                  {health.clientReady ? 'TRUE' : 'FALSE'}
                </span>
              </div>
              <div className="bg-gray-50 rounded p-2">
                <span className="text-text-secondary">Tokens:</span>{' '}
                <span className="font-mono">
                  {health.hasAuthToken && 'A'} {health.hasLineToken && 'L'} {health.hasUnofficialToken && 'U'}
                </span>
              </div>
            </div>

            {/* Token Debug */}
            {health.tokenDebug && typeof health.tokenDebug === 'object' && 'decoded' in health.tokenDebug && (
              <details className="bg-gray-50 rounded p-2">
                <summary className="cursor-pointer text-text-secondary">JWT Token Debug</summary>
                <pre className="mt-2 text-[10px] overflow-x-auto">
                  {JSON.stringify(health.tokenDebug, null, 2)}
                </pre>
              </details>
            )}

            {/* Token Expiry */}
            {health.token && (
              <div className="bg-gray-50 rounded p-2">
                <span className="text-text-secondary">Token:</span>{' '}
                <span className="font-mono">
                  {health.token.expired ? '❌ EXPIRED' : `✅ ${health.token.expiresIn}`}
                </span>
                {health.token.expiresAt && (
                  <span className="text-[10px] text-text-secondary ml-2">→ {new Date(health.token.expiresAt).toLocaleString('th-TH')}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Anti-Ban */}
      {health?.antiBan && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">🛡️ Anti-Ban Protection</h3>
            <button onClick={resetAntiBan} className="text-[10px] px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200">
              Reset counters
            </button>
          </div>

          {/* Rate limits */}
          {health.antiBan.counters && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              {(['day', 'hour', 'minute'] as const).map(period => {
                const c = health.antiBan?.counters?.[period]
                if (!c) return null
                const pct = c.limit > 0 ? (c.sent / c.limit) * 100 : 0
                return (
                  <div key={period} className="bg-gray-50 rounded p-2">
                    <div className="flex justify-between">
                      <span className="text-text-secondary uppercase text-[10px]">{period}</span>
                      <span className="font-mono">{c.sent}/{c.limit}</span>
                    </div>
                    <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-green-500'}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Circuit breaker */}
          {health.antiBan.circuitBreaker && (
            <div className={`rounded p-2 text-xs ${health.antiBan.circuitBreaker.isOpen ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
              <div className="flex justify-between items-center">
                <span className="font-medium">
                  {health.antiBan.circuitBreaker.isOpen ? '🚨 Circuit Breaker OPEN' : '✅ Circuit Breaker CLOSED'}
                </span>
                <span className="font-mono text-[10px]">
                  Failures: {health.antiBan.circuitBreaker.failures}/{health.antiBan.circuitBreaker.threshold}
                </span>
              </div>
              {health.antiBan.circuitBreaker.isOpen && health.antiBan.circuitBreaker.cooldownRemainingMs > 0 && (
                <p className="mt-1 text-[10px]">
                  Cooldown: {Math.ceil(health.antiBan.circuitBreaker.cooldownRemainingMs / 1000)}s remaining
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recent Logs */}
      <div className="card space-y-2">
        <h3 className="text-sm font-semibold">📋 Recent Send Logs (1h, latest 30)</h3>
        {recentLogs.length === 0 ? (
          <p className="text-xs text-text-secondary">No logs in the last hour</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {recentLogs.map(log => (
              <div
                key={log.id}
                className={`text-[10px] font-mono p-1.5 rounded border ${
                  log.status === 'sent'
                    ? 'bg-green-50 border-green-100'
                    : 'bg-red-50 border-red-100'
                }`}
              >
                <div className="flex justify-between">
                  <span>
                    {log.status === 'sent' ? '✅' : '❌'} {log.channel}.{log.msg_type}
                  </span>
                  <span className="text-text-secondary">
                    {new Date(log.created_at).toLocaleTimeString('th-TH')} ({log.duration_ms}ms)
                  </span>
                </div>
                {log.error_message && (
                  <div className="text-red-600 mt-0.5 break-all">{log.error_message.slice(0, 200)}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Raw /health JSON */}
      {health && (
        <details className="card">
          <summary className="text-sm font-semibold cursor-pointer">🔬 Raw /health Response</summary>
          <pre className="mt-2 text-[10px] overflow-x-auto bg-gray-50 p-2 rounded">
            {JSON.stringify(health, null, 2)}
          </pre>
        </details>
      )}

      {/* Quick Links */}
      <div className="card space-y-2">
        <h3 className="text-sm font-semibold">🔗 Quick Links</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {endpoint && (
            <>
              <a href={`${endpoint}/health`} target="_blank" rel="noreferrer" className="block p-2 bg-gray-50 rounded hover:bg-gray-100">
                🏥 VPS /health
              </a>
              <a href={`${endpoint}/test`} target="_blank" rel="noreferrer" className="block p-2 bg-gray-50 rounded hover:bg-gray-100">
                🧪 VPS /test
              </a>
            </>
          )}
          <a href="/api/e2e-test" target="_blank" className="block p-2 bg-gray-50 rounded hover:bg-gray-100">
            🔍 E2E JSON
          </a>
          <a href="/api/line/trigger?test=1" target="_blank" className="block p-2 bg-gray-50 rounded hover:bg-gray-100">
            📤 Trigger JSON
          </a>
          <a href="https://github.com/panatch1992-cell/lottobot" target="_blank" rel="noreferrer" className="block p-2 bg-gray-50 rounded hover:bg-gray-100">
            📦 GitHub Repo
          </a>
          <a href="https://my.vultr.com" target="_blank" rel="noreferrer" className="block p-2 bg-gray-50 rounded hover:bg-gray-100">
            💻 Vultr VPS
          </a>
          <a href="https://app.supabase.com" target="_blank" rel="noreferrer" className="block p-2 bg-gray-50 rounded hover:bg-gray-100">
            🗄️ Supabase
          </a>
          <a href="https://vercel.com" target="_blank" rel="noreferrer" className="block p-2 bg-gray-50 rounded hover:bg-gray-100">
            ▲ Vercel
          </a>
        </div>
      </div>
    </div>
  )
}
