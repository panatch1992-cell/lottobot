import TopBar from '@/components/layout/TopBar'
import BottomNav from '@/components/layout/BottomNav'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-bg">
      <TopBar />
      <main className="max-w-4xl mx-auto px-4 py-4 pb-24">
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
