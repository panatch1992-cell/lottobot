import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function GET() {
  try {
    const db = getServiceClient()
    const { data, error } = await db
      .from('line_groups')
      .select('id, name, line_group_id, unofficial_group_id, is_active')
      .order('created_at')

    if (error) throw error

    return NextResponse.json({ groups: data || [] })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
