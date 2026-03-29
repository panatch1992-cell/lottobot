'use client'

import { useEffect, useState } from 'react'
import type { Lottery } from '@/types'

interface ResultMap {
  [lottery_id: string]: {
    top_number: string
    bottom_number: string
    full_number: string
  }
}

export default function ResultsPage() {
  const [lotteries, setLotteries] = useState<Lottery[]>([])
  const [results, setResults] = useState<ResultMap>({})
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state per lottery
  const [forms, setForms] = useState<Record<string, { top: string; bottom: string; full: string }>>({})

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const res = await fetch('/api/results')
      const data = await res.json()
      setLotteries(data.lotteries || [])
      setResults(data.results || {})
      setDate(data.date || '')

      // Initialize forms from existing results
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
      setMessage({ type: 'error', text: 'โหลดข้อมูลไม่สำเร็จ' })
    } finally {
      setLoading(false)
    }
  }

  function updateForm(lotteryId: string, field: 'top' | 'bottom' | 'full', value: string) {
    // Allow only digits
    const clean = value.replace(/\D/g, '')
    setForms(prev => ({
      ...prev,
      [lotteryId]: { ...prev[lotteryId], [field]: clean },
    }))
  }

  async function handleSubmit(lottery: Lottery) {
    const form = forms[lottery.id]
    if (!form?.top && !form?.bottom && !form?.full) {
      setMessage({ type: 'error', text: 'กรุณากรอกตัวเลขอย่างน้อย 1 ช่อง' })
      return
    }

    setSending(lottery.id)
    setMessage(null)

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
        setMessage({ type: 'error', text: data.error || 'เกิดข้อผิดพลาด' })
        return
      }

      setMessage({ type: 'success', text: data.summary || 'บันทึกสำเร็จ' })

      // Update results map
      setResults(prev => ({
        ...prev,
        [lottery.id]: {
          top_number: form.top,
          bottom_number: form.bottom,
          full_number: form.full,
        },
      }))
    } catch {
      setMessage({ type: 'error', text: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้' })
    } finally {
      setSending(null)
    }
  }

  function hasExistingResult(lotteryId: string): boolean {
    const r = results[lotteryId]
    return !!(r?.top_number || r?.bottom_number || r?.full_number)
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">📝 กรอกผลหวย</h2>
        <span className="text-sm text-text-secondary">{date}</span>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${
          message.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {lotteries.length === 0 ? (
        <div className="card text-center py-8 text-text-secondary">
          ไม่มีหวยที่เปิดใช้งาน
        </div>
      ) : (
        <div className="space-y-3">
          {lotteries.map(lottery => {
            const form = forms[lottery.id] || { top: '', bottom: '', full: '' }
            const hasResult = hasExistingResult(lottery.id)
            const isSending = sending === lottery.id

            return (
              <div key={lottery.id} className="card">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{lottery.flag}</span>
                    <div>
                      <span className="font-medium text-sm">{lottery.name}</span>
                      <span className="text-xs text-text-secondary ml-2">{lottery.result_time} น.</span>
                    </div>
                  </div>
                  {hasResult && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                      มีผลแล้ว
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  {(lottery.result_format === '3d_2d' || lottery.result_format === '3d_only') && (
                    <>
                      <div>
                        <label className="text-xs text-text-secondary block mb-1">เลขบน</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={form.top}
                          onChange={e => updateForm(lottery.id, 'top', e.target.value)}
                          placeholder="xxx"
                          className="w-full px-2 py-1.5 text-center text-lg font-mono border border-gray-200 rounded-lg focus:border-gold focus:ring-1 focus:ring-gold outline-none"
                        />
                      </div>
                      {lottery.result_format === '3d_2d' && (
                        <div>
                          <label className="text-xs text-text-secondary block mb-1">เลขล่าง</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={form.bottom}
                            onChange={e => updateForm(lottery.id, 'bottom', e.target.value)}
                            placeholder="xx"
                            className="w-full px-2 py-1.5 text-center text-lg font-mono border border-gray-200 rounded-lg focus:border-gold focus:ring-1 focus:ring-gold outline-none"
                          />
                        </div>
                      )}
                    </>
                  )}
                  {(lottery.result_format === '6d' || lottery.result_format === 'custom') && (
                    <div className="col-span-2">
                      <label className="text-xs text-text-secondary block mb-1">เลขเต็ม</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        value={form.full}
                        onChange={e => updateForm(lottery.id, 'full', e.target.value)}
                        placeholder="xxxxxx"
                        className="w-full px-2 py-1.5 text-center text-lg font-mono border border-gray-200 rounded-lg focus:border-gold focus:ring-1 focus:ring-gold outline-none"
                      />
                    </div>
                  )}
                  <div className="flex items-end">
                    <button
                      onClick={() => handleSubmit(lottery)}
                      disabled={isSending}
                      className={`w-full py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        isSending
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : hasResult
                            ? 'bg-amber-500 text-white hover:bg-amber-600'
                            : 'bg-gold text-white hover:bg-gold/90'
                      }`}
                    >
                      {isSending ? '...' : hasResult ? 'แก้ไข' : 'ส่งผล'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
