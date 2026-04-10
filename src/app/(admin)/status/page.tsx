'use client'

import { useEffect, useState } from 'react'

type TestResult = {
  name: string
  status: 'pass' | 'fail' | 'warn' | 'skip'
  detail: string
  durationMs?: number
}

type E2EResponse = {
  overall: 'PASS' | 'FAIL' | 'WARN'
  summary: { total: number; pass: number; fail: number; warn: number; skip: number }
  tests: TestResult[]
  timestamp: string
}

const STATUS_STYLES: Record<TestResult['status'], { icon: string; color: string; bg: string; border: string }> = {
  pass: { icon: '✅', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' },
  fail: { icon: '❌', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
  warn: { icon: '⚠️', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
  skip: { icon: '⏭', color: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200' },
}

export default function StatusPage() {
  const [result, setResult] = useState<E2EResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [lastRun, setLastRun] = useState<Date | null>(null)

  async function runTest(includeSend = false) {
    setLoading(true)
    try {
      const res = await fetch(`/api/e2e-test${includeSend ? '?send=1' : ''}`)
      const data = await res.json()
      setResult(data)
      setLastRun(new Date())
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
    setLoading(false)
  }

  useEffect(() => {
    runTest()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => runTest(), 30000)
    return () => clearInterval(interval)
  }, [autoRefresh])

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">🏥 สถานะระบบ</h1>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
          />
          <span>Auto-refresh (30s)</span>
        </label>
      </div>

      {/* Overall status card */}
      {result && (
        <div className={`card space-y-2 ${
          result.overall === 'PASS' ? 'bg-green-50 border-green-200' :
          result.overall === 'WARN' ? 'bg-amber-50 border-amber-200' :
          'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">สถานะโดยรวม</p>
              <p className={`text-3xl font-bold ${
                result.overall === 'PASS' ? 'text-green-700' :
                result.overall === 'WARN' ? 'text-amber-700' :
                'text-red-700'
              }`}>
                {result.overall === 'PASS' ? '✅ ปกติ' :
                 result.overall === 'WARN' ? '⚠️ มีข้อควรระวัง' :
                 '❌ มีปัญหา'}
              </p>
            </div>
            <div className="text-right text-xs text-text-secondary">
              <p>ผ่าน: <b className="text-green-700">{result.summary.pass}</b></p>
              <p>ล้มเหลว: <b className="text-red-700">{result.summary.fail}</b></p>
              <p>ระวัง: <b className="text-amber-700">{result.summary.warn}</b></p>
              <p>ข้าม: <b className="text-gray-600">{result.summary.skip}</b></p>
            </div>
          </div>
          {lastRun && (
            <p className="text-xs text-text-secondary">
              ตรวจล่าสุด: {lastRun.toLocaleString('th-TH')}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => runTest(false)}
          disabled={loading}
          className="flex-1 btn-primary disabled:opacity-50"
        >
          {loading ? '⏳ กำลังตรวจ...' : '🔄 ตรวจใหม่'}
        </button>
        <button
          onClick={() => {
            if (confirm('ทดสอบจริงจะส่ง "." เข้ากลุ่ม LINE — ต้องการทดสอบเลยหรือไม่?')) {
              runTest(true)
            }
          }}
          disabled={loading}
          className="flex-1 bg-amber-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50"
        >
          🧪 ทดสอบจริง (ส่ง &quot;.&quot;)
        </button>
      </div>

      {/* Test results */}
      {result && (
        <div className="space-y-2">
          {result.tests.map((test, i) => {
            const styles = STATUS_STYLES[test.status]
            return (
              <div
                key={i}
                className={`rounded-lg p-3 border ${styles.bg} ${styles.border}`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-xl">{styles.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`font-medium text-sm ${styles.color}`}>
                        {test.name}
                      </p>
                      {test.durationMs !== undefined && (
                        <span className="text-[10px] text-text-secondary">
                          {test.durationMs}ms
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary mt-1 break-words">
                      {test.detail}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Help */}
      <div className="card bg-blue-50 border-blue-200 text-xs text-blue-700 space-y-2">
        <p className="font-medium">💡 คำอธิบาย</p>
        <ul className="space-y-1 ml-4 list-disc">
          <li>✅ <b>ผ่าน</b> — ระบบส่วนนั้นทำงานปกติ</li>
          <li>⚠️ <b>ระวัง</b> — ใช้งานได้ แต่มีข้อควรแก้ไข</li>
          <li>❌ <b>ล้มเหลว</b> — ต้องแก้ไขก่อนใช้งาน</li>
          <li>⏭ <b>ข้าม</b> — ไม่ได้ตรวจในครั้งนี้</li>
        </ul>
        <p className="pt-2 border-t border-blue-200">
          <b>ทดสอบจริง</b> จะส่งข้อความ &quot;.&quot; เข้ากลุ่ม LINE ที่ active — ใช้เพื่อยืนยันว่า trigger flow ทำงานครบวงจร
        </p>
      </div>
    </div>
  )
}
