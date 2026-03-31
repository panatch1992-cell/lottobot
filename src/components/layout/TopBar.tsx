'use client'

import { usePathname } from 'next/navigation'

const pageTitles: Record<string, string> = {
  '/dashboard': 'หน้าหลัก',
  '/results': 'แก้ไขผล',
  '/scraping': 'ดึงผล',
  '/scheduled': 'ตั้งเวลาส่ง',
  '/messages': 'ส่งข้อความ',
  '/lotteries': 'จัดการหวย',
  '/history': 'ประวัติส่ง',
  '/settings': 'ตั้งค่า',
}

export default function TopBar() {
  const pathname = usePathname()
  const title = pageTitles[pathname] || 'LottoBot'

  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎰</span>
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/manual.html"
            target="_blank"
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-[#c9a84c] transition-colors"
            title="คู่มือใช้งาน"
          >
            <span className="text-base">📖</span>
            <span className="hidden sm:inline">คู่มือ</span>
          </a>
          <span className="text-xs text-text-secondary font-mono">LottoBot</span>
        </div>
      </div>
    </header>
  )
}
