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

type Group = { id: string; name: string; is_active: boolean }

export default function DevDashboard() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [recentLogs, setRecentLogs] = useState<SendLog[]>([])
  const [dbStats, setDbStats] = useState<DbStats | null>(null)
  const [endpoint, setEndpoint] = useState('')
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [allGroups, setAllGroups] = useState<Group[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const [sendingTest, setSendingTest] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  // Hybrid test fire state
  const [hybridFiring, setHybridFiring] = useState(false)
  const [hybridResult, setHybridResult] = useState<Record<string, unknown> | null>(null)

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

      // Fetch all groups for test send dropdown
      const { data: groupsData } = await supabase
        .from('line_groups')
        .select('id, name, is_active')
        .order('name')
      setAllGroups((groupsData || []) as Group[])

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

  async function sendTestToGroup() {
    if (!selectedGroupId) {
      setTestResult({ success: false, message: 'กรุณาเลือกกลุ่ม' })
      return
    }
    setSendingTest(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/line/trigger-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: selectedGroupId }),
      })
      const data = await res.json()
      if (data.success) {
        setTestResult({
          success: true,
          message: `✅ ส่งเข้า "${data.group?.name}" สำเร็จ (${data.durationMs}ms) — เช็คใน LINE app`,
        })
      } else {
        setTestResult({
          success: false,
          message: `❌ ${data.error || 'fail'}`,
        })
      }
      // Reload logs to show the new entry
      setTimeout(() => loadAll(), 1000)
    } catch (err) {
      setTestResult({
        success: false,
        message: `❌ ${err instanceof Error ? err.message : 'error'}`,
      })
    }
    setSendingTest(false)
  }

  async function fireHybridTest(groupNames?: string[]) {
    setHybridFiring(true)
    setHybridResult(null)
    try {
      const body: Record<string, unknown> = { skip_humanlike: true }
      if (groupNames && groupNames.length > 0) body.group_names = groupNames
      const res = await fetch('/api/admin/hybrid-test-fire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setHybridResult(data)
      setTimeout(() => loadAll(), 2000)
    } catch (err) {
      setHybridResult({ error: err instanceof Error ? err.message : 'error' })
    }
    setHybridFiring(false)
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
        <Link href="/lucky-images" className="px-3 py-1 bg-gold/20 text-gold rounded hover:bg-gold/30">📸 Lucky Images</Link>
        <Link href="/bot-accounts" className="px-3 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200">🤖 Bot Accounts</Link>
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

      {/* LINE OA Bot Info */}
      <BotInfoCard />

      {/* Test Send to Specific Group */}
      <div className="card space-y-2">
        <h3 className="text-sm font-semibold">🧪 Test Send (เลือกกลุ่ม)</h3>
        <p className="text-[10px] text-text-secondary">
          ส่ง &quot;.&quot; ไปกลุ่มเดียว — สำหรับทดสอบโดยไม่กระทบกลุ่มอื่น
        </p>
        <div className="flex gap-2">
          <select
            value={selectedGroupId}
            onChange={e => setSelectedGroupId(e.target.value)}
            className="input text-xs flex-1"
          >
            <option value="">-- เลือกกลุ่ม --</option>
            {allGroups.map(g => (
              <option key={g.id} value={g.id}>
                {g.is_active ? '✅' : '⚪'} {g.name} ({g.id.slice(-8)})
              </option>
            ))}
          </select>
          <button
            onClick={sendTestToGroup}
            disabled={sendingTest || !selectedGroupId}
            className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
          >
            {sendingTest ? '⏳' : '📤 ส่ง "."'}
          </button>
        </div>
        {testResult && (
          <div className={`text-xs p-2 rounded ${
            testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {testResult.message}
          </div>
        )}
      </div>

      {/* Hybrid Test Fire */}
      <div className="card space-y-2 border-2 border-purple-200">
        <h3 className="text-sm font-semibold">🚀 Hybrid Test Fire (End-to-End)</h3>
        <p className="text-[10px] text-text-secondary">
          ยิง Hybrid flow แบบเต็ม: self-bot → trigger phrase → webhook → Reply API
          (text + result card + รูปเลขเด็ด) — bypass canary, dedup, humanlike delay
          ใช้ผลหวยล่าสุดที่มีใน DB หรือผลปลอม 999-88 ถ้าไม่มี
        </p>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => fireHybridTest()}
            disabled={hybridFiring}
            className="px-3 py-2 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 disabled:opacity-50 font-medium"
          >
            {hybridFiring ? '⏳ กำลังยิง...' : '🚀 Fire ไปทุกกลุ่ม active'}
          </button>
          {allGroups.filter(g => g.is_active).map(g => (
            <button
              key={g.id}
              onClick={() => fireHybridTest([g.name])}
              disabled={hybridFiring}
              className="px-2 py-1 bg-purple-100 text-purple-700 text-[10px] rounded hover:bg-purple-200 disabled:opacity-50"
            >
              🎯 เฉพาะ &quot;{g.name}&quot;
            </button>
          ))}
        </div>
        {hybridResult && (
          <div className="border rounded bg-gray-50 p-2 text-[10px] space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Result:</span>
              <button
                onClick={() => setHybridResult(null)}
                className="ml-auto text-gray-500 hover:text-gray-800"
              >
                ✕
              </button>
            </div>
            <pre className="bg-white p-2 rounded border overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(hybridResult, null, 2)}
            </pre>
            <p className="text-text-secondary italic">
              💡 หลัง trigger sent → รอ 2-5 วิ → ดูใน LINE group ควรมี Reply จาก OA
              (text + result card + lucky image ถ้ามี)
            </p>
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
      {/* Advanced Settings (moved from /settings) */}
      <AdvancedSettings />

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

// ─── Advanced Settings Component ─────────────────────

// ─── LINE OA Bot Info Card ───────────────────────────

type BotInfo = {
  bot?: {
    userId?: string
    basicId?: string
    premiumId?: string
    displayName?: string
    pictureUrl?: string
    chatMode?: string
  }
  addFriend?: {
    url?: string | null
    id?: string
    qrCode?: string | null
  }
  error?: string
}

function BotInfoCard() {
  const [info, setInfo] = useState<BotInfo | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/line/bot-info')
      const data = await res.json()
      setInfo(data)
    } catch (err) {
      setInfo({ error: err instanceof Error ? err.message : 'error' })
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <div className="card">
        <p className="text-xs text-text-secondary">⏳ กำลังดึงข้อมูล LINE OA...</p>
      </div>
    )
  }

  if (info?.error || !info?.bot) {
    return (
      <div className="card bg-red-50 border-red-200">
        <h3 className="text-sm font-semibold text-red-700">🤖 LINE OA Bot Info</h3>
        <p className="text-xs text-red-600 mt-1">{info?.error || 'ไม่สามารถดึงข้อมูลได้'}</p>
        <button onClick={load} className="text-xs text-red-700 underline mt-1">🔄 ลองใหม่</button>
      </div>
    )
  }

  const bot = info.bot
  const addFriend = info.addFriend

  return (
    <div className="card space-y-2">
      <h3 className="text-sm font-semibold">🤖 LINE OA Bot Info</h3>
      <div className="flex items-start gap-3">
        {bot.pictureUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bot.pictureUrl} alt="bot" className="w-14 h-14 rounded-full" />
        )}
        <div className="flex-1 space-y-1 text-xs">
          <p><b>{bot.displayName || '-'}</b></p>
          <p className="font-mono text-text-secondary">
            Basic ID: <span className="text-gold">{bot.basicId || '-'}</span>
          </p>
          {bot.premiumId && (
            <p className="font-mono text-text-secondary">
              Premium ID: <span className="text-gold">{bot.premiumId}</span>
            </p>
          )}
          <p className="text-text-secondary">
            Chat mode: <span className="font-mono">{bot.chatMode}</span>
          </p>
        </div>
      </div>

      {addFriend?.id && (
        <div className="pt-2 border-t border-gray-100 space-y-2">
          <p className="text-xs font-medium">📲 วิธีเพิ่มเพื่อน:</p>

          {/* Option 1: Click URL */}
          {addFriend.url && (
            <a
              href={addFriend.url}
              target="_blank"
              rel="noreferrer"
              className="block text-xs bg-green-50 text-green-700 px-3 py-2 rounded hover:bg-green-100 border border-green-200"
            >
              🔗 กด link เปิด LINE app: <span className="font-mono">{addFriend.id}</span>
            </a>
          )}

          {/* Option 2: Search by ID */}
          <div className="text-xs text-text-secondary">
            หรือเปิด LINE app → Add Friend → Search → พิมพ์: <code className="bg-gray-100 px-1 rounded font-mono text-gold">{addFriend.id}</code>
          </div>

          {/* Option 3: QR code */}
          {addFriend.qrCode && (
            <details className="text-xs">
              <summary className="cursor-pointer text-text-secondary">📱 แสกน QR code</summary>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={addFriend.qrCode} alt="QR" className="mt-2 w-40 h-40 border rounded" />
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function AdvancedSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        const map: Record<string, string> = {}
        ;(data.settings || []).forEach((s: { key: string; value: string }) => { map[s.key] = s.value })
        setSettings(map)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function save(key: string, value: string) {
    setSaving(key)
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      setSettings(prev => ({ ...prev, [key]: value }))
    } catch { /* silent */ }
    setSaving(null)
  }

  if (loading) return null

  return (
    <div className="card space-y-3">
      <h3 className="text-sm font-semibold">⚙️ Advanced Settings</h3>
      <div className="bg-red-50 border border-red-200 rounded p-2 text-[10px] text-red-700">
        ⚠️ แก้ไขเฉพาะเมื่อจำเป็น — ค่าผิดจะทำให้ระบบหยุดทำงาน
      </div>

      {/* Telegram */}
      <div className="border border-gray-200 rounded p-2 space-y-2">
        <p className="text-xs font-medium">✈️ Telegram Bot</p>
        <div>
          <label className="text-[10px] text-text-secondary">Bot Token</label>
          <input
            type="password"
            value={settings.telegram_bot_token || ''}
            onChange={e => setSettings(prev => ({ ...prev, telegram_bot_token: e.target.value }))}
            onBlur={e => { if (e.target.value) save('telegram_bot_token', e.target.value) }}
            className="input font-mono text-xs"
            placeholder="123456789:ABCdef..."
          />
        </div>
        <div>
          <label className="text-[10px] text-text-secondary">Admin Channel ID</label>
          <input
            type="text"
            value={settings.telegram_admin_channel || ''}
            onChange={e => setSettings(prev => ({ ...prev, telegram_admin_channel: e.target.value }))}
            onBlur={e => { if (e.target.value) save('telegram_admin_channel', e.target.value) }}
            className="input font-mono text-xs"
            placeholder="-1001234567890"
          />
        </div>
      </div>

      {/* Unofficial Endpoint */}
      <div className="border border-gray-200 rounded p-2 space-y-2">
        <p className="text-xs font-medium">🔧 Unofficial Endpoint (VPS)</p>
        <div>
          <label className="text-[10px] text-text-secondary">Endpoint URL</label>
          <input
            type="text"
            value={settings.unofficial_line_endpoint || ''}
            onChange={e => setSettings(prev => ({ ...prev, unofficial_line_endpoint: e.target.value }))}
            onBlur={e => { if (e.target.value) save('unofficial_line_endpoint', e.target.value) }}
            className="input font-mono text-xs"
            placeholder="http://45.77.240.100:8080"
          />
        </div>
        <div>
          <label className="text-[10px] text-text-secondary">Auth Token</label>
          <input
            type="password"
            value={settings.unofficial_line_token || ''}
            onChange={e => setSettings(prev => ({ ...prev, unofficial_line_token: e.target.value }))}
            onBlur={e => { if (e.target.value) save('unofficial_line_token', e.target.value) }}
            className="input font-mono text-xs"
            placeholder="Bearer token"
          />
        </div>
      </div>

      {/* Scraping */}
      <div className="border border-gray-200 rounded p-2 space-y-2">
        <p className="text-xs font-medium">🤖 Scrape Config</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-text-secondary">Window (min)</label>
            <input
              type="number"
              value={settings.scrape_window_minutes || '30'}
              onChange={e => setSettings(prev => ({ ...prev, scrape_window_minutes: e.target.value }))}
              onBlur={e => save('scrape_window_minutes', e.target.value)}
              className="input text-xs"
              min="5" max="60"
            />
          </div>
          <div>
            <label className="text-[10px] text-text-secondary">Max retries</label>
            <input
              type="number"
              value={settings.scrape_max_retries || '3'}
              onChange={e => setSettings(prev => ({ ...prev, scrape_max_retries: e.target.value }))}
              onBlur={e => save('scrape_max_retries', e.target.value)}
              className="input text-xs"
              min="1" max="10"
            />
          </div>
        </div>
      </div>

      {/* Flow */}
      <div className="border border-gray-200 rounded p-2 space-y-2">
        <p className="text-xs font-medium">⏰ Flow Config</p>
        <div>
          <label className="text-[10px] text-text-secondary">LINE add friend link</label>
          <input
            type="text"
            value={settings.line_add_friend_link || ''}
            onChange={e => setSettings(prev => ({ ...prev, line_add_friend_link: e.target.value }))}
            onBlur={e => save('line_add_friend_link', e.target.value)}
            className="input font-mono text-xs"
            placeholder="https://line.me/R/ti/p/@xxx"
          />
        </div>
        <div>
          <label className="text-[10px] text-text-secondary">Random image URL</label>
          <input
            type="text"
            value={settings.random_image_url || ''}
            onChange={e => setSettings(prev => ({ ...prev, random_image_url: e.target.value }))}
            onBlur={e => save('random_image_url', e.target.value)}
            className="input font-mono text-xs"
            placeholder="https://www.huaypnk.com/top"
          />
        </div>
      </div>

      {saving && <p className="text-[10px] text-text-secondary">Saving {saving}...</p>}
    </div>
  )
}
