import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

// Direct save endpoint for LINE credentials — bypasses settings route
export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient()
    const body = await req.json()
    const results: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(body)) {
      if (typeof value !== 'string') continue

      // Try update
      const { data: updated, error: updateErr } = await db
        .from('bot_settings')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key)
        .select('key, value')

      if (updateErr) {
        results[key] = { error: updateErr.message }
        continue
      }

      if (updated && updated.length > 0) {
        results[key] = { action: 'updated', savedLength: updated[0].value.length }
      } else {
        // Key doesn't exist, insert
        const { error: insertErr } = await db
          .from('bot_settings')
          .insert({ key, value, updated_at: new Date().toISOString() })

        if (insertErr) {
          results[key] = { error: insertErr.message }
        } else {
          results[key] = { action: 'inserted', savedLength: value.length }
        }
      }
    }

    // Verify by re-reading
    const { data: verify } = await db
      .from('bot_settings')
      .select('key, value')
      .in('key', Object.keys(body))

    const verified: Record<string, number> = {}
    ;(verify || []).forEach((r: { key: string; value: string }) => {
      verified[r.key] = r.value.length
    })

    return NextResponse.json({ results, verified })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
