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

// Theme definitions matching the server-side image generator
const THEME_OPTIONS = [
  {
    id: 'macaroon',
    label: 'Macaroon',
    preview: ['#FFD1DC', '#FFE5B4', '#FFFACD', '#C1F0C1', '#B8E0FF', '#E0C8FF'],
    bg: '#ffffff',
    digits: [
      { bg: '#FFD1DC', text: '#D4526E', border: '#F8A5B8' },
      { bg: '#FFE5B4', text: '#CC8400', border: '#FFD080' },
      { bg: '#FFFACD', text: '#B8960C', border: '#FFE44D' },
      { bg: '#C1F0C1', text: '#2D8B2D', border: '#8ED88E' },
      { bg: '#B8E0FF', text: '#2E6DA4', border: '#80C4FF' },
      { bg: '#E0C8FF', text: '#7B4DBF', border: '#C89EFF' },
    ],
    titleColor: '#4a4a4a',
    dateColor: '#aaa',
    labelColor: '#999',
  },
  {
    id: 'candy',
    label: 'Candy',
    preview: ['#FF6B8A', '#FF9F43', '#FFDD59'],
    bg: '#FFF5F5',
    digits: [
      { bg: '#FF6B8A', text: '#fff', border: '#FF4D73' },
      { bg: '#FF9F43', text: '#fff', border: '#FF8C1A' },
      { bg: '#FFDD59', text: '#7C6800', border: '#FFD42A' },
      { bg: '#FF6B8A', text: '#fff', border: '#FF4D73' },
      { bg: '#FF9F43', text: '#fff', border: '#FF8C1A' },
      { bg: '#FF6B8A', text: '#fff', border: '#FF4D73' },
    ],
    titleColor: '#E53E3E',
    dateColor: '#FC8181',
    labelColor: '#F687B3',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    preview: ['#2B6CB0', '#3182CE', '#4299E1', '#38B2AC'],
    bg: '#EBF8FF',
    digits: [
      { bg: '#2B6CB0', text: '#fff', border: '#2C5282' },
      { bg: '#3182CE', text: '#fff', border: '#2B6CB0' },
      { bg: '#4299E1', text: '#fff', border: '#3182CE' },
      { bg: '#0987A0', text: '#fff', border: '#086F83' },
      { bg: '#38B2AC', text: '#fff', border: '#2C7A7B' },
      { bg: '#4FD1C5', text: '#234E52', border: '#38B2AC' },
    ],
    titleColor: '#2B6CB0',
    dateColor: '#63B3ED',
    labelColor: '#90CDF4',
  },
  {
    id: 'gold',
    label: 'Gold',
    preview: ['#F59E0B', '#FBBF24', '#FCD34D'],
    bg: '#FFFBEB',
    digits: [
      { bg: '#F59E0B', text: '#fff', border: '#D97706' },
      { bg: '#FBBF24', text: '#78350F', border: '#F59E0B' },
      { bg: '#FCD34D', text: '#78350F', border: '#FBBF24' },
      { bg: '#F59E0B', text: '#fff', border: '#D97706' },
      { bg: '#FBBF24', text: '#78350F', border: '#F59E0B' },
      { bg: '#FCD34D', text: '#78350F', border: '#FBBF24' },
    ],
    titleColor: '#92400E',
    dateColor: '#D97706',
    labelColor: '#B45309',
  },
  {
    id: 'dark',
    label: 'Dark',
    preview: ['#E53E3E', '#DD6B20', '#D69E2E', '#38A169', '#3182CE'],
    bg: '#1A202C',
    digits: [
      { bg: '#E53E3E', text: '#fff', border: '#C53030' },
      { bg: '#DD6B20', text: '#fff', border: '#C05621' },
      { bg: '#D69E2E', text: '#fff', border: '#B7791F' },
      { bg: '#38A169', text: '#fff', border: '#2F855A' },
      { bg: '#3182CE', text: '#fff', border: '#2B6CB0' },
      { bg: '#805AD5', text: '#fff', border: '#6B46C1' },
    ],
    titleColor: '#F7FAFC',
    dateColor: '#A0AEC0',
    labelColor: '#718096',
  },
]

const FONT_OPTIONS = [
  { id: 'rounded', label: 'มน' },
  { id: 'sharp', label: 'คม' },
  { id: 'outline', label: 'เส้น' },
]

const SIZE_OPTIONS = [
  { id: 's', label: 'S', px: 28 },
  { id: 'm', label: 'M', px: 36 },
  { id: 'l', label: 'L', px: 44 },
]

function MiniDigit({ digit, index, theme, fontStyle, size }: {
  digit: string; index: number; theme: typeof THEME_OPTIONS[0]; fontStyle: string; size: string
}) {
  const c = theme.digits[index % theme.digits.length]
  const isOutline = fontStyle === 'outline'
  const sz = SIZE_OPTIONS.find(s => s.id === size) || SIZE_OPTIONS[1]
  const fontSize = Math.round(sz.px * 0.56)
  const radius = Math.round(sz.px * 0.28)

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: sz.px,
        height: sz.px,
        borderRadius: radius,
        backgroundColor: isOutline ? 'transparent' : c.bg,
        border: `2px solid ${c.border}`,
        color: isOutline ? c.border : c.text,
        fontSize,
        fontWeight: fontStyle === 'sharp' ? 900 : fontStyle === 'outline' ? 700 : 800,
        letterSpacing: fontStyle === 'sharp' ? 1 : 0,
        margin: '0 2px',
        fontFamily: 'monospace',
      }}
    >
      {digit}
    </span>
  )
}

function PreviewCard({ lottery, form, date, theme, fontStyle, digitSize }: {
  lottery: Lottery
  form: { top: string; bottom: string; full: string }
  date: string
  theme: typeof THEME_OPTIONS[0]
  fontStyle: string
  digitSize: string
}) {
  const hasAny = form.top || form.bottom || form.full
  if (!hasAny) return null

  return (
    <div className="mt-3 rounded-xl p-3 border border-gray-100" style={{ backgroundColor: '#f7f7f7' }}>
      <p className="text-[10px] text-text-secondary mb-2 font-medium">ตัวอย่างที่จะส่งไป LINE กลุ่ม</p>
      <div className="rounded-lg p-4 text-center" style={{ backgroundColor: theme.bg }}>
        <p className="text-sm font-bold mb-0.5" style={{ color: theme.titleColor }}>
          {lottery.flag} {lottery.name} {lottery.flag}
        </p>
        <p className="text-[11px] mb-3" style={{ color: theme.dateColor }}>
          งวดวันที่ {date}
        </p>

        {form.top && (
          <div className="mb-3">
            <p className="text-[10px] mb-1" style={{ color: theme.labelColor }}>เลขบน</p>
            <div className="flex justify-center">
              {form.top.split('').map((d, i) => (
                <MiniDigit key={`t${i}`} digit={d} index={i} theme={theme} fontStyle={fontStyle} size={digitSize} />
              ))}
            </div>
          </div>
        )}

        {form.bottom && (
          <div className="mb-3">
            <p className="text-[10px] mb-1" style={{ color: theme.labelColor }}>เลขล่าง</p>
            <div className="flex justify-center">
              {form.bottom.split('').map((d, i) => (
                <MiniDigit key={`b${i}`} digit={d} index={i + 3} theme={theme} fontStyle={fontStyle} size={digitSize} />
              ))}
            </div>
          </div>
        )}

        {form.full && (
          <div className="mb-3">
            <p className="text-[10px] mb-1" style={{ color: theme.labelColor }}>เลขเต็ม</p>
            <div className="flex justify-center flex-wrap">
              {form.full.split('').map((d, i) => (
                <MiniDigit key={`f${i}`} digit={d} index={i} theme={theme} fontStyle={fontStyle} size={digitSize} />
              ))}
            </div>
          </div>
        )}

        <p className="text-[9px] mt-2" style={{ color: theme.dateColor, opacity: 0.5 }}>LottoBot</p>
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
  const [selectedTheme, setSelectedTheme] = useState('macaroon')
  const [fontStyle, setFontStyle] = useState('rounded')
  const [digitSize, setDigitSize] = useState('m')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [forms, setForms] = useState<Record<string, { top: string; bottom: string; full: string }>>({})

  useEffect(() => { loadData() }, [])

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
          theme: selectedTheme,
          font_style: fontStyle,
          digit_size: digitSize,
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
  const currentTheme = THEME_OPTIONS.find(t => t.id === selectedTheme) || THEME_OPTIONS[0]

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
      {/* Toast */}
      {toast && (
        <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium max-w-[90vw] animate-fade-in ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.text}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">กรอกผลหวย</h2>
          <p className="text-xs text-text-secondary">
            วันที่ {date} — ส่งแล้ว <span className="font-mono font-bold text-green-600">{sentCount}</span>/{totalCount}
          </p>
        </div>
        <button
          onClick={() => setShowSentOnly(!showSentOnly)}
          className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
            showSentOnly ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-text-secondary'
          }`}
        >
          {showSentOnly ? 'ส่งแล้ว' : 'ทั้งหมด'}
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
          style={{ width: `${totalCount > 0 ? (sentCount / totalCount) * 100 : 0}%` }}
        />
      </div>

      {/* Style controls */}
      <div className="card">
        {/* Theme row */}
        <p className="text-[11px] text-text-secondary mb-2 font-medium">🎨 ธีมสี</p>
        <div className="flex gap-2 overflow-x-auto p-1 -m-1">
          {THEME_OPTIONS.map(theme => (
            <button
              key={theme.id}
              onClick={() => setSelectedTheme(theme.id)}
              className={`shrink-0 flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl transition-all ${
                selectedTheme === theme.id
                  ? 'bg-gold/10 ring-2 ring-gold shadow-sm'
                  : 'bg-gray-50 hover:bg-gray-100'
              }`}
            >
              <div className="flex gap-0.5">
                {theme.preview.slice(0, 4).map((color, i) => (
                  <span
                    key={i}
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <span className="text-[10px] font-medium">{theme.label}</span>
            </button>
          ))}
        </div>

        {/* Font style + Size row */}
        <div className="flex gap-4 mt-4">
          {/* Font style */}
          <div className="flex-1">
            <p className="text-[11px] text-text-secondary mb-1.5 font-medium">Aa สไตล์ฟอนต์</p>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {FONT_OPTIONS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFontStyle(f.id)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                    fontStyle === f.id
                      ? 'bg-white shadow-sm text-text-primary'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Size */}
          <div className="flex-1">
            <p className="text-[11px] text-text-secondary mb-1.5 font-medium">↕ ขนาด</p>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {SIZE_OPTIONS.map(s => (
                <button
                  key={s.id}
                  onClick={() => setDigitSize(s.id)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                    digitSize === s.id
                      ? 'bg-white shadow-sm text-text-primary'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
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

                {/* Live preview */}
                <PreviewCard lottery={lottery} form={form} date={thaiDate} theme={currentTheme} fontStyle={fontStyle} digitSize={digitSize} />
              </div>
            )
          })}
        </div>
      )}

      <div className="h-4" />
    </div>
  )
}
