// Utility functions

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}

export function nowBangkok(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function minutesBetween(time1: string, time2: string): number {
  return timeToMinutes(time2) - timeToMinutes(time1)
}

export function formatTime(time: string): string {
  const [h, m] = time.split(':')
  return `${h}:${m} น.`
}

export function formatDateTime(isoStr: string): string {
  const d = new Date(isoStr)
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
