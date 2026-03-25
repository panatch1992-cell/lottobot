interface StatCardProps {
  icon: string
  label: string
  value: number | string
  sub?: string
  color?: string
}

export default function StatCard({ icon, label, value, sub, color = 'text-gold' }: StatCardProps) {
  return (
    <div className="card flex items-center gap-3">
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-xs text-text-secondary">{label}</p>
        <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
        {sub && <p className="text-[10px] text-text-secondary">{sub}</p>}
      </div>
    </div>
  )
}
