import type { TodayLotteryStatus } from '@/types'
import { formatTime } from '@/lib/utils'

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="badge-gray">⏳ รอ</span>
  if (status === 'sent') return <span className="badge-success">✓ ส่งแล้ว</span>
  if (status === 'sending') return <span className="badge-warn">● กำลังส่ง</span>
  if (status === 'failed') return <span className="badge-danger">✗ ล้มเหลว</span>
  return <span className="badge-gray">⏳ รอ</span>
}

export default function LottoStatusCard({ item }: { item: TodayLotteryStatus }) {
  const { lottery, result, tgStatus, lineStatus, lineGroupCount } = item
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-lg">{lottery.flag}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{lottery.name}</p>
          <p className="text-xs text-text-secondary">{formatTime(lottery.result_time)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right">
          {result ? (
            <p className="text-xs font-mono font-medium">
              {result.top_number && `${result.top_number}`}
              {result.bottom_number && `-${result.bottom_number}`}
            </p>
          ) : (
            <p className="text-xs text-text-secondary">—</p>
          )}
        </div>
        <div className="flex flex-col gap-0.5 items-end">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-text-secondary">TG</span>
            <StatusBadge status={tgStatus} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-text-secondary">LINE</span>
            <StatusBadge status={lineStatus} />
            {lineGroupCount > 0 && <span className="text-[10px] text-text-secondary">({lineGroupCount})</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
