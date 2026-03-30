'use client'

import { useEffect, useState, useRef } from 'react'
import type { Lottery } from '@/types'

interface ResultMap {
  [lottery_id: string]: {
    top_number: string
    bottom_number: string
    full_number: string
  }
}

// Macaroon pastel colors matching the image generator
const MACAROON = [
  { bg: '#FFD1DC', text: '#D4526E', border: '#F8A5B8' },
  { bg: '#FFE5B4', text: '#CC8400', border: '#FFD080' },
  { bg: '#FFFACD', text: '#B8960C', border: '#FFE44D' },
  { bg: '#C1F0C1', text: '#2D8B2D', border: '#8ED88E' },
  { bg: '#B8E0FF', text: '#2E6DA4', border: '#80C4FF' },
  { bg: '#E0C8FF', text: '#7B4DBF', border: '#C89EFF' },
]

function MiniDigit({ digit, index }: { digit: string; index: number }) {
  const c = MACAROON[index % MACAROON.length]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: c.bg,
        border: `2px solid ${c.border}`,
        color: c.text,
        fontSize: 20,
        fontWeight: 800,
        margin: '0 2px',
        fontFamily: 'monospace',
      }}
    >
      {digit}
    </span>
  )
}

function PreviewCard({ lottery, form, date }: {
  lottery: Lottery
  form: { top: string; bottom: string; full: string }
  date: string
}) {
  const hasAny = form.top || form.bottom || form.full
  if (!hasAny) return null

  return (
    <div className="mt-3 bg-gray-50 rounded-xl p-3 border border-gray-100">
      <p className="text-[10px] text-text-secondary mb-2 font-medium">ตัวอย่างที่จะส่งไป LINE กลุ่ม</p>
      <div className="bg-white rounded-lg p-3 text-center">
        <p className="text-sm font-semibold text-gray-600 mb-0.5">
          {lottery.flag} {lottery.name} {lottery.flag}
        </p>
        <p className="text-[11px] text-gray-400 mb-3">งวดวันที่ {date}</p>

        {form.top && (
          <div className="mb-2">
            <p className="text-[10px] text-gray-400 mb-1">เลขบน</p>
            <div className="flex justify-center">
              {form.top.split('').map((d, i) => (
                <MiniDigit key={`t${i}`} digit={d} index={i} />
              ))}
            </div>
          </div>
        )}

        {form.bottom && (
          <div className="mb-2">
            <p className="text-[10px] text-gray-400 mb-1">เลขล่าง</p>
            <div className="flex justify-center">
              {form.bottom.split('').map((d, i) => (
                <MiniDigit key={`b${i}`} digit={d} index={i + 3} />
              ))}
            </div>
          </div>
        )}

        {form.full && (
          <div className="mb-2">
            <p className="text-[10px] text-gray-400 mb-1">เลขเต็ม</p>
            <div className="flex justify-center flex-wrap">
              {form.full.split('').map((d, i) => (
                <MiniDigit key={`f${i}`} digit={d} index={i} />
              ))}
            </div>
          </div>
        )}

        <p className="text-[9px] text-gray-300 mt-2">LottoBot</p>
      </div>
    </div>
  )
}

export default function ResultsPage() {
  const [lotteries, setLotteries] = useState<Lottery[]>([])
  const [results, setResults] = useState<ResultMap>({})
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState('')
  const [showSentOnly, setShowSentOnly] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [forms, setForms] = useState<Record<string, { top: string; bottom: string; full: string }>>({})

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (toast) {
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(null), 4000)
    }
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current) }
  }, [toast])

  async function loadData() {
    try {
      const res = await fetch('/api/results')
      const data = await res.json()
      setLotteries(data.lotteries || [])
      setResults(data.results || {})
      setDate(data.date || '')

      const formState: Record<string, { top: string; bottom: string; full: string }> = {}
      for (const l of (data.lotteries || [])) {
        const r = data.results?.[l.id]
        formState[l.id] = {
          top: r?.top_number || '',
          bottom: r?.bottom_number || '',
          full: r?.full_number || '',
        }
      }
      setForms(formState)
    } catch {
      setToast({ type: 'error', text: 'โหลดข้อมูลไม่สำเร็จ' })
    } finally {
      setLoading(false)
    }
  }

  function updateForm(lotteryId: string, field: 'top' | 'bottom' | 'full', value: string) {
    const clean = value.replace(/\D/g, '')
    setForms(prev => ({
      ...prev,
      [lotteryId]: { ...prev[lotteryId], [field]: clean },
    }))
  }

  async function handleSubmit(lottery: Lottery) {
    const form = forms[lottery.id]
    if (!form?.top && !form?.bottom && !form?.full) {
      setToast({ type: 'error', text: 'กรุณากรอกตัวเลขอย่างน้อย 1 ช่อง' })
      return
    }

    setSending(lottery.id)
    setToast(null)

    try {
      const res = await fetch('/api/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lottery_id: lottery.id,
          top_number: form.top || null,
          bottom_number: form.bottom || null,
          full_number: form.full || null,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setToast({ type: 'error', text: data.error || 'เกิดข้อผิดพลาด' })
        return
      }

      setToast({ type: 'success', text: `${lottery.flag} ${lottery.name} — ${data.summary || 'ส่งสำเร็จ'}` })

      setResults(prev => ({
        ...prev,
        [lottery.id]: {
          top_number: form.top,
          bottom_number: form.bottom,
          full_number: form.full,
        },
      }))
    } catch {
      setToast({ type: 'error', text: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้' })
    } finally {
      setSending(null)
    }
  }

  function hasExistingResult(lotteryId: string): boolean {
    const r = results[lotteryId]
    return !!(r?.top_number || r?.bottom_number || r?.full_number)
  }

  const filtered = lotteries.filter(l => {
    if (showSentOnly && !hasExistingResult(l.id)) return false
    if (search) {
      const q = search.toLowerCase()
      return l.name.toLowerCase().includes(q) || (l.country || '').toLowerCase().includes(q) || l.flag.includes(q)
    }
    return true
  })

  const sentCount = lotteries.filter(l => hasExistingResult(l.id)).length
  const totalCount = lotteries.length

  // Format date for preview
  const thaiDate = date
    ? new Date(date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
    : date

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
    <div className="space-y-3">
      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium max-w-[90vw] animate-fade-in ${
          toast.type === 'success'
            ? 'bg-green-600 text-white'
            : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.text}
        </div>
      )}

      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">กรอกผลหวย</h2>
          <p className="text-xs text-text-secondary">
            วันที่ {date} — ส่งแล้ว <span className="font-mono font-bold text-green-600">{sentCount}</span>/{totalCount}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSentOnly(!showSentOnly)}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              showSentOnly ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-text-secondary'
            }`}
          >
            {showSentOnly ? 'ส่งแล้ว' : 'ทั้งหมด'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
          style={{ width: `${totalCount > 0 ? (sentCount / totalCount) * 100 : 0}%` }}
        />
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาหวย..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:border-gold focus:ring-1 focus:ring-gold outline-none bg-white"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">✕</button>
        )}
      </div>

      {/* Lottery list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary">
          <p className="text-3xl mb-2">🔍</p>
          <p className="text-sm">{search ? 'ไม่พบหวยที่ค้นหา' : 'ไม่มีหวยที่เปิดใช้งาน'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(lottery => {
            const form = forms[lottery.id] || { top: '', bottom: '', full: '' }
            const hasResult = hasExistingResult(lottery.id)
            const isSending = sending === lottery.id

            return (
              <div
                key={lottery.id}
                className={`card transition-all duration-200 ${
                  hasResult ? 'border-green-200 bg-green-50/30' : ''
                } ${isSending ? 'opacity-70 pointer-events-none' : ''}`}
              >
                {/* Lottery header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{lottery.flag}</span>
                    <div>
                      <span className="font-medium text-sm">{lottery.name}</span>
                      <span className="text-xs text-text-secondary ml-1.5">{lottery.result_time}</span>
                    </div>
                  </div>
                  {hasResult && (
                    <span className="flex items-center gap-1 text-[11px] text-green-600 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span>
                      ส่งแล้ว
                    </span>
                  )}
                </div>

                {/* Input row */}
                <div className="flex items-end gap-2">
                  {(lottery.result_format === '3d_2d' || lottery.result_format === '3d_only') && (
                    <>
                      <div className="flex-1">
                        <label className="text-[11px] text-text-secondary mb-0.5 block">เลขบน</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={form.top}
                          onChange={e => updateForm(lottery.id, 'top', e.target.value)}
                          placeholder="xxx"
                          className="w-full px-2 py-2 text-center text-lg font-mono font-bold border border-gray-200 rounded-lg focus:border-gold focus:ring-2 focus:ring-gold/30 outline-none transition-shadow"
                        />
                      </div>
                      {lottery.result_format === '3d_2d' && (
                        <div className="flex-1">
                          <label className="text-[11px] text-text-secondary mb-0.5 block">เลขล่าง</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={form.bottom}
                            onChange={e => updateForm(lottery.id, 'bottom', e.target.value)}
                            placeholder="xx"
                            className="w-full px-2 py-2 text-center text-lg font-mono font-bold border border-gray-200 rounded-lg focus:border-gold focus:ring-2 focus:ring-gold/30 outline-none transition-shadow"
                          />
                        </div>
                      )}
                    </>
                  )}
                  {(lottery.result_format === '6d' || lottery.result_format === 'custom') && (
                    <div className="flex-[2]">
                      <label className="text-[11px] text-text-secondary mb-0.5 block">เลขเต็ม</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        value={form.full}
                        onChange={e => updateForm(lottery.id, 'full', e.target.value)}
                        placeholder="xxxxxx"
                        className="w-full px-2 py-2 text-center text-lg font-mono font-bold border border-gray-200 rounded-lg focus:border-gold focus:ring-2 focus:ring-gold/30 outline-none transition-shadow"
                      />
                    </div>
                  )}
                  <button
                    onClick={() => handleSubmit(lottery)}
                    disabled={isSending}
                    className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 ${
                      isSending
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : hasResult
                          ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm'
                          : 'bg-gold text-white hover:bg-gold/90 shadow-sm shadow-gold/20'
                    }`}
                  >
                    {isSending ? (
                      <span className="inline-block animate-spin">⏳</span>
                    ) : hasResult ? 'แก้ไข' : 'ส่งผล'}
                  </button>
                </div>

                {/* Live preview - shows when user types numbers */}
                <PreviewCard lottery={lottery} form={form} date={thaiDate} />
              </div>
            )
          })}
        </div>
      )}

      <div className="h-4" />
    </div>
  )
}
