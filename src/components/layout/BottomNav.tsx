'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/dashboard', label: 'หน้าหลัก', icon: '📊' },
  { href: '/results', label: 'กรอกผล', icon: '📝' },
  { href: '/scraping', label: 'ดึงผล', icon: '🤖' },
  { href: '/lotteries', label: 'หวย', icon: '🎰' },
  { href: '/history', label: 'ประวัติ', icon: '📋' },
  { href: '/settings', label: 'ตั้งค่า', icon: '⚙️' },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 safe-area-bottom">
      <div className="max-w-4xl mx-auto flex">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center py-2 text-xs transition-colors ${
                isActive
                  ? 'text-gold font-medium'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <span className="text-xl mb-0.5">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
