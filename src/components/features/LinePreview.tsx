'use client'

interface LinePreviewProps {
  message?: string
}

export default function LinePreview({ message }: LinePreviewProps) {
  const sample = message || `🇱🇦🇱🇦 หวยลาว HD 🇱🇦🇱🇦\nงวดวันที่ 30 มี.ค. 69\n⬆️ บน : 7 2 6\n⬇️ ล่าง : 9 4`

  const displayText = sample.replace(/\\n/g, '\n')

  return (
    <div className="card bg-[#7494a5] p-0 overflow-hidden">
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <span className="text-sm">💬</span>
        <span className="text-xs font-medium text-white/80">LINE กลุ่ม — ตัวอย่างข้อความ</span>
      </div>
      <div className="p-3 flex justify-start">
        <div className="bg-white rounded-2xl rounded-tl-sm p-3 max-w-[280px] shadow-sm">
          <pre className="text-xs whitespace-pre-wrap font-thai leading-relaxed text-gray-800">{displayText}</pre>
        </div>
      </div>
    </div>
  )
}
