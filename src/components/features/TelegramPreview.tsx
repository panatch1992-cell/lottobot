'use client'

interface TelegramPreviewProps {
  message?: string
}

export default function TelegramPreview({ message }: TelegramPreviewProps) {
  const sample = message || `🇱🇦 <b>หวยลาว HD</b>\nงวด 30 มี.ค. 69\n⬆️ บน : <code>7 2 6</code>\n⬇️ ล่าง : <code>9 4</code>\n──────\n✓ ส่ง LINE แล้ว 1 กลุ่ม`

  // Simple HTML to displayable text
  const displayText = sample
    .replace(/<b>(.*?)<\/b>/g, '$1')
    .replace(/<code>(.*?)<\/code>/g, '$1')
    .replace(/<i>(.*?)<\/i>/g, '$1')
    .replace(/\\n/g, '\n')

  return (
    <div className="card bg-tg-dark text-white p-0 overflow-hidden">
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <span className="text-sm">✈️</span>
        <span className="text-xs font-medium text-white/80">Telegram Admin Channel</span>
      </div>
      <div className="p-3">
        <div className="bg-tg-bubble rounded-lg p-3 max-w-[280px]">
          <pre className="text-xs whitespace-pre-wrap font-thai leading-relaxed">{displayText}</pre>
        </div>
        <p className="text-[10px] text-white/40 mt-1 text-right">12:30</p>
      </div>
    </div>
  )
}
