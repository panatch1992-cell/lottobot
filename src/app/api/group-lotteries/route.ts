import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  try {
    const db = getServiceClient()
    const groupId = req.nextUrl.searchParams.get('group_id')
    if (!groupId) return NextResponse.json({ error: 'group_id required' }, { status: 400 })

    const { data } = await db.from('group_lotteries').select('lottery_id').eq('group_id', groupId)
    return NextResponse.json({ lotteries: (data || []).map(d => d.lottery_id) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
