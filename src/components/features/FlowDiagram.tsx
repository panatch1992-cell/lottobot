'use client'

type FlowState = 'active' | 'inactive'

type FlowDiagramProps = {
  stepsState?: {
    autoFetch: FlowState
    countdownAndSchedule: FlowState
    telegram: FlowState
    line: FlowState
  }
}

export default function FlowDiagram({ stepsState }: FlowDiagramProps) {
  const steps = [
    {
      icon: '🤖',
      label: 'ดึงผลอัตโนมัติ',
      sub: stepsState?.autoFetch === 'active' ? 'หุ้น / เว็บ (auto)' : 'ยังไม่ตั้งค่า',
      color: 'bg-blue-500',
      state: stepsState?.autoFetch || 'active',
    },
    {
      icon: '⏰',
      label: 'Countdown + ตั้งเวลา',
      sub: stepsState?.countdownAndSchedule === 'active' ? '20/10/5 นาที' : 'ยังไม่เปิดใช้งาน',
      color: 'bg-[#e89b1c]',
      state: stepsState?.countdownAndSchedule || 'active',
    },
    {
      icon: '✈️',
      label: 'Telegram',
      sub: stepsState?.telegram === 'active' ? 'Admin Log' : 'ยังไม่เชื่อมต่อ',
      color: 'bg-[#1a222c]',
      state: stepsState?.telegram || 'active',
    },
    {
      icon: '💬',
      label: 'LINE กลุ่ม',
      sub: stepsState?.line === 'active' ? 'ส่งพร้อมรูป' : 'ยังไม่เชื่อมต่อ',
      color: 'bg-[#06c755]',
      state: stepsState?.line || 'active',
    },
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
              <span className={`text-[10px] text-center ${step.state === 'active' ? 'text-text-secondary' : 'text-red-500'}`}>{step.sub}</span>
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
