'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState('v5 | URL=' + (supabaseUrl ? 'OK' : 'EMPTY') + ' | KEY=' + (supabaseKey ? supabaseKey.substring(0, 10) + '...' : 'EMPTY'))
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    setInfo(prev => prev + ' | LOGIN...')

    if (!supabaseUrl || !supabaseKey) {
      setError('Supabase config missing!')
      setLoading(false)
      return
    }

    try {
      const res = await fetch(supabaseUrl + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
        },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()
      setInfo(prev => prev + ' | STATUS=' + res.status)

      if (!res.ok) {
        setError(data.error_description || data.msg || data.message || 'Login failed: ' + res.status)
        setLoading(false)
        return
      }

      // Login success - set cookie manually for now
      document.cookie = `sb-access-token=${data.access_token}; path=/; max-age=3600`
      document.cookie = `sb-refresh-token=${data.refresh_token}; path=/; max-age=604800`
      
      setInfo(prev => prev + ' | SUCCESS!')
      router.push('/dashboard')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError('Network error: ' + message)
      setInfo(prev => prev + ' | ERROR: ' + message)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-5xl">🎰</span>
          <h1 className="text-2xl font-bold mt-3">LottoBot</h1>
          <p className="text-sm text-text-secondary mt-1">ระบบส่งผลหวยอัตโนมัติ</p>
        </div>

        <form onSubmit={handleLogin} className="card space-y-4">
          <div>
            <label className="label">อีเมล</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input"
              placeholder="admin@lottobot.com"
              required
            />
          </div>
          <div>
            <label className="label">รหัสผ่าน</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-danger bg-danger/5 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full disabled:opacity-50"
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>

          <p className="text-xs text-gray-400 break-all">{info}</p>
        </form>
      </div>
    </div>
  )
}
