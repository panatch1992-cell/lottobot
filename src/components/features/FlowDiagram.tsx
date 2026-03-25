'use client'

export default function FlowDiagram() {
  const steps = [
    { icon: '🌐', label: 'เว็บผลหวย', sub: 'Scraping ทุก 30 วิ', color: 'bg-blue-500' },
    { icon: '✈️', label: 'Telegram Bot', sub: 'Admin Channel', color: 'bg-[#1a222c]' },
    { icon: '⚡', label: 'n8n', sub: 'Automation', color: 'bg-orange-500' },
    { icon: '💬', label: 'LINE กลุ่ม', sub: '5+ กลุ่ม', color: 'bg-[#06c755]' },
  ]

  return (
    <div className="card">
      <h3 className="font-semibold mb-3">🔄 Flow การทำงาน</h3>
      <div className="flex items-center justify-between gap-1 overflow-x-auto pb-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center min-w-[70px]">
              <div className={`w-10 h-10 rounded-full ${step.color} flex items-center justify-center text-white text-lg`}>
                {step.icon}
              </div>
              <span className="text-xs font-medium mt-1 text-center">{step.label}</span>
              <span className="text-[10px] text-text-secondary text-center">{step.sub}</span>
            </div>
            {i < steps.length - 1 && (
              <span className="text-gray-400 mx-1 text-lg">→</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
