import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Client-side Supabase client (lazy init to avoid build errors)
let _supabase: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase URL and Anon Key are required. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.')
    }
    _supabase = createClient(supabaseUrl, supabaseAnonKey)
  }
  return _supabase
}

// For backward compatibility — lazy proxy
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

// Read bot_settings via direct REST API (bypasses Supabase JS client empty-string bug)
export async function getSettings(): Promise<Record<string, string>> {
  const settings: Record<string, string> = {}
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/bot_settings?select=key,value`
    const res = await fetch(url, {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
      },
    })
    const data = await res.json()
    if (Array.isArray(data)) {
      data.forEach((s: { key: string; value: string }) => { if (s.key && s.value) settings[s.key] = s.value })
    }
  } catch {
    // fallback silent
  }
  return settings
}

// Server-side client with service role (for cron jobs / API routes)
export function getServiceClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL are required')
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  })
}
