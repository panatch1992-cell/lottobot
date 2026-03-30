'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Lottery, ScrapeSource, SelectorConfig } from '@/types'

interface SourceForm {
  url: string
  is_primary: boolean
  top_selector: string
  bottom_selector: string
  full_selector: string
  date_selector: string
}

const emptyForm: SourceForm = {
  url: '',
  is_primary: true,
  top_selector: '',
  bottom_selector: '',
  full_selector: '',
  date_selector: '',
}

interface TestResult {
  success: boolean
  data?: { top_number?: string; bottom_number?: string; full_number?: string }
  error?: string
}

export default function ScrapingPage() {
  const [lotteries, setLotteries] = useState<Lottery[]>([])
  const [sources, setSources] = useState<(ScrapeSource & { lotteries?: { name: string; flag: string } })[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedLottery, setSelectedLottery] = useState<Lottery | null>(null)
  const [lotterySources, setLotterySources] = useState<ScrapeSource[]>([])

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<SourceForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  // Test state
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  // Scrape now state
  const [scraping, setScraping] = useState<string | null>(null)
  const [scrapeResult, setScrapeResult] = useState<{ success: boolean; error?: string; lottery?: string } | null>(null)

  const loadData = useCallback(async () => {
    const [{ data: lotData }, { data: srcData }] = await Promise.all([
      supabase.from('lotteries').select('*').eq('status', 'active').order('sort_order'),
      supabase.from('scrape_sources').select('*, lotteries(name, flag)').order('is_primary', { ascending: false }),
    ])
    setLotteries((lotData || []) as Lottery[])
    setSources((srcData || []) as (ScrapeSource & { lotteries?: { name: string; flag: string } })[])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  async function loadLotterySources(lotteryId: string) {
    const { data } = await supabase.from('scrape_sources')
      .select('*')
      .eq('lottery_id', lotteryId)
      .order('is_primary', { ascending: false })
    setLotterySources((data || []) as ScrapeSource[])
  }

  function openLottery(lottery: Lottery) {
    setSelectedLottery(lottery)
    loadLotterySources(lottery.id)
    setTestResult(null)
    setScrapeResult(null)
  }

  function openAddSource() {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
    setTestResult(null)
  }

  function openEditSource(source: ScrapeSource) {
    const config = source.selector_config as SelectorConfig | null
    setForm({
      url: source.url,
      is_primary: source.is_primary,
      top_selector: config?.top_selector || '',
      bottom_selector: config?.bottom_selector || '',
      full_selector: config?.full_selector || '',
      date_selector: config?.date_selector || '',
    })
    setEditingId(source.id)
    setShowForm(true)
    setTestResult(null)
  }

  async function handleSave() {
    if (!selectedLottery || !form.url) return
    setSaving(true)

    const selectorConfig: SelectorConfig = {}
    if (form.top_selector) selectorConfig.top_selector = form.top_selector
    if (form.bottom_selector) selectorConfig.bottom_selector = form.bottom_selector
    if (form.full_selector) selectorConfig.full_selector = form.full_selector
    if (form.date_selector) selectorConfig.date_selector = form.date_selector

    const payload = {
      url: form.url,
      is_primary: form.is_primary,
      selector_config: Object.keys(selectorConfig).length > 0 ? selectorConfig : null,
    }

    if (editingId) {
      const res = await fetch('/api/scrape-sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, ...payload }),
      })
      await res.json()
    } else {
      const res = await fetch('/api/scrape-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lottery_id: selectedLottery.id, ...payload }),
      })
      await res.json()
    }

    setSaving(false)
    setShowForm(false)
    loadLotterySources(selectedLottery.id)
    loadData()
  }

  async function handleDelete(sourceId: string) {
    if (!selectedLottery) return
    if (!confirm('ลบ source นี้?')) return
    await fetch(`/api/scrape-sources?id=${sourceId}`, { method: 'DELETE' })
    loadLotterySources(selectedLottery.id)
    loadData()
  }

  async function handleToggle(source: ScrapeSource) {
    await fetch('/api/scrape-sources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: source.id, is_active: !source.is_active }),
    })
    if (selectedLottery) loadLotterySources(selectedLottery.id)
    loadData()
  }

  async function handleTestScrape() {
    if (!form.url) return
    setTesting(true)
    setTestResult(null)

    const selectorConfig: SelectorConfig = {}
    if (form.top_selector) selectorConfig.top_selector = form.top_selector
    if (form.bottom_selector) selectorConfig.bottom_selector = form.bottom_selector
    if (form.full_selector) selectorConfig.full_selector = form.full_selector
    if (form.date_selector) selectorConfig.date_selector = form.date_selector

    try {
      const res = await fetch('/api/scrape-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          url: form.url,
          selector_config: Object.keys(selectorConfig).length > 0 ? selectorConfig : null,
        }),
      })
      const data = await res.json()
      setTestResult(data)
    } catch {
      setTestResult({ success: false, error: 'Network error' })
    }
    setTesting(false)
  }

  async function handleScrapeNow(lottery: Lottery) {
    setScraping(lottery.id)
    setScrapeResult(null)
    try {
      const res = await fetch('/api/scrape-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scrape_now', lottery_id: lottery.id }),
      })
      const data = await res.json()
      setScrapeResult({ success: data.success, error: data.error, lottery: lottery.name })
    } catch {
      setScrapeResult({ success: false, error: 'Network error', lottery: lottery.name })
    }
    setScraping(null)
  }

  // Count sources per lottery
  const sourceCountMap = new Map<string, number>()
  sources.forEach(s => {
    sourceCountMap.set(s.lottery_id, (sourceCountMap.get(s.lottery_id) || 0) + 1)
  })

  const filtered = lotteries.filter(l =>
    l.name.includes(search) || (l.country || '').includes(search) || l.flag.includes(search)
  )

  const configuredCount = new Set(sources.map(s => s.lottery_id)).size
  const totalActive = lotteries.length

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin text-3xl">🔄</div></div>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">🤖 ดึงผลอัตโนมัติ</h2>
        <p className="text-xs text-text-secondary">
          ตั้งค่า URL + CSS Selectors สำหรับดึงผลหวยอัตโนมัติ
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="card text-center">
          <p className="text-2xl font-bold text-gold">{configuredCount}</p>
          <p className="text-xs text-text-secondary">ตั้งค่าแล้ว</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold">{totalActive}</p>
          <p className="text-xs text-text-secondary">หวยทั้งหมด</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-danger">{totalActive - configuredCount}</p>
          <p className="text-xs text-text-secondary">ยังไม่ตั้งค่า</p>
        </div>
      </div>

      {/* Scrape result toast */}
      {scrapeResult && (
        <div className={`card ${scrapeResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'} border`}>
          <p className="text-sm">
            {scrapeResult.success
              ? `✅ ดึงผล ${scrapeResult.lottery} สำเร็จ — บันทึก + ส่ง TG/LINE แล้ว`
              : `❌ ${scrapeResult.lottery}: ${scrapeResult.error}`}
          </p>
          <button onClick={() => setScrapeResult(null)} className="text-xs text-text-secondary underline mt-1">ปิด</button>
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="🔍 ค้นหาชื่อหวย..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="input"
      />

      {/* Lottery List */}
      <div className="card p-0 divide-y divide-gray-50">
        {filtered.map(lottery => {
          const count = sourceCountMap.get(lottery.id) || 0
          const isSelected = selectedLottery?.id === lottery.id
          return (
            <div key={lottery.id}>
              <div
                className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${isSelected ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
                onClick={() => openLottery(lottery)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl">{lottery.flag}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{lottery.name}</p>
                    <p className="text-xs text-text-secondary">{lottery.result_time} น. · {lottery.country || '-'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {count > 0 ? (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{count} source{count > 1 ? 's' : ''}</span>
                  ) : (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">ยังไม่ตั้งค่า</span>
                  )}
                  <span className="text-xs text-text-secondary">{isSelected ? '▼' : '▶'}</span>
                </div>
              </div>

              {/* Expanded: scrape sources for this lottery */}
              {isSelected && (
                <div className="bg-gray-50 px-4 py-3 space-y-3">
                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button onClick={openAddSource} className="btn-primary text-xs">+ เพิ่ม Source</button>
                    {lotterySources.length > 0 && (
                      <button
                        onClick={() => handleScrapeNow(lottery)}
                        disabled={scraping === lottery.id}
                        className="btn-outline text-xs disabled:opacity-50"
                      >
                        {scraping === lottery.id ? '⏳ กำลังดึง...' : '🔄 ดึงผลตอนนี้'}
                      </button>
                    )}
                  </div>

                  {/* Sources list */}
                  {lotterySources.length === 0 ? (
                    <p className="text-xs text-text-secondary italic">{'ยังไม่มี scrape source — กด "+ เพิ่ม Source" เพื่อตั้งค่า URL + CSS Selectors'}</p>
                  ) : (
                    <div className="space-y-2">
                      {lotterySources.map(source => (
                        <div key={source.id} className={`card text-xs space-y-1 ${!source.is_active ? 'opacity-50' : ''}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              {source.is_primary && (
                                <span className="bg-gold/20 text-gold px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0">PRIMARY</span>
                              )}
                              <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 truncate hover:underline">
                                {source.url}
                              </a>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 ml-2">
                              <button onClick={() => handleToggle(source)} className="p-1" title={source.is_active ? 'ปิด' : 'เปิด'}>
                                {source.is_active ? '🟢' : '🔴'}
                              </button>
                              <button onClick={() => openEditSource(source)} className="p-1" title="แก้ไข">✏️</button>
                              <button onClick={() => handleDelete(source.id)} className="p-1" title="ลบ">🗑️</button>
                            </div>
                          </div>

                          {/* Selectors preview */}
                          {source.selector_config && (
                            <div className="text-[10px] text-text-secondary font-mono bg-gray-100 rounded p-1.5 space-y-0.5">
                              {(source.selector_config as SelectorConfig).top_selector && (
                                <div>บน: <span className="text-blue-600">{(source.selector_config as SelectorConfig).top_selector}</span></div>
                              )}
                              {(source.selector_config as SelectorConfig).bottom_selector && (
                                <div>ล่าง: <span className="text-blue-600">{(source.selector_config as SelectorConfig).bottom_selector}</span></div>
                              )}
                              {(source.selector_config as SelectorConfig).full_selector && (
                                <div>เต็ม: <span className="text-blue-600">{(source.selector_config as SelectorConfig).full_selector}</span></div>
                              )}
                            </div>
                          )}

                          {/* Status */}
                          <div className="text-[10px] text-text-secondary">
                            {source.last_success_at && (
                              <span className="text-green-600">✓ สำเร็จล่าสุด: {new Date(source.last_success_at).toLocaleString('th-TH')}</span>
                            )}
                            {source.last_error && (
                              <span className="text-red-500"> · ❌ {source.last_error}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add/Edit Source Modal */}
      {showForm && selectedLottery && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-1">
              {editingId ? '✏️ แก้ไข Source' : '➕ เพิ่ม Scrape Source'}
            </h3>
            <p className="text-xs text-text-secondary mb-4">
              {selectedLottery.flag} {selectedLottery.name}
            </p>

            <div className="space-y-3">
              {/* URL */}
              <div>
                <label className="label">URL เว็บดึงผล *</label>
                <input
                  value={form.url}
                  onChange={e => setForm({ ...form, url: e.target.value })}
                  className="input font-mono text-xs"
                  placeholder="https://example.com/results"
                />
              </div>

              {/* Primary toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_primary}
                  onChange={e => setForm({ ...form, is_primary: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm">ใช้เป็น source หลัก (primary)</span>
              </label>

              {/* CSS Selectors */}
              <div className="border rounded-lg p-3 space-y-2 bg-gray-50">
                <p className="text-xs font-medium">CSS Selectors (Cheerio)</p>
                <p className="text-[10px] text-text-secondary">ระบุ CSS selector สำหรับดึงตัวเลขจากหน้าเว็บ เช่น {'\".result-top span\"'} หรือ {'\".top-number\"'}</p>

                <div>
                  <label className="label">Selector เลขบน (top_number)</label>
                  <input
                    value={form.top_selector}
                    onChange={e => setForm({ ...form, top_selector: e.target.value })}
                    className="input font-mono text-xs"
                    placeholder=".result-top span"
                  />
                </div>

                <div>
                  <label className="label">Selector เลขล่าง (bottom_number)</label>
                  <input
                    value={form.bottom_selector}
                    onChange={e => setForm({ ...form, bottom_selector: e.target.value })}
                    className="input font-mono text-xs"
                    placeholder=".result-bottom span"
                  />
                </div>

                <div>
                  <label className="label">Selector เลขเต็ม (full_number)</label>
                  <input
                    value={form.full_selector}
                    onChange={e => setForm({ ...form, full_selector: e.target.value })}
                    className="input font-mono text-xs"
                    placeholder=".full-number"
                  />
                </div>

                <div>
                  <label className="label">Selector วันที่ (ไม่บังคับ)</label>
                  <input
                    value={form.date_selector}
                    onChange={e => setForm({ ...form, date_selector: e.target.value })}
                    className="input font-mono text-xs"
                    placeholder=".draw-date"
                  />
                </div>
              </div>

              {/* Test Scrape Button */}
              <button
                onClick={handleTestScrape}
                disabled={testing || !form.url}
                className="btn-outline text-sm w-full disabled:opacity-50"
              >
                {testing ? '⏳ กำลังทดสอบ...' : '🧪 ทดสอบดึงผล'}
              </button>

              {/* Test Result */}
              {testResult && (
                <div className={`rounded-lg p-3 text-xs ${testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  {testResult.success ? (
                    <div className="space-y-1">
                      <p className="font-medium text-green-700">✅ ดึงผลสำเร็จ!</p>
                      {testResult.data?.top_number && (
                        <p>เลขบน: <span className="font-mono font-bold">{testResult.data.top_number}</span></p>
                      )}
                      {testResult.data?.bottom_number && (
                        <p>เลขล่าง: <span className="font-mono font-bold">{testResult.data.bottom_number}</span></p>
                      )}
                      {testResult.data?.full_number && (
                        <p>เลขเต็ม: <span className="font-mono font-bold">{testResult.data.full_number}</span></p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium text-red-700">❌ ดึงผลไม่สำเร็จ</p>
                      <p className="text-red-600 mt-1">{testResult.error}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="btn-outline text-sm flex-1">ยกเลิก</button>
              <button
                onClick={handleSave}
                disabled={saving || !form.url}
                className="btn-primary text-sm flex-1 disabled:opacity-50"
              >
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
