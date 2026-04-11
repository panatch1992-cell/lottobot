import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { ingestEvent } from '@/lib/events/orchestrator'

/**
 * GET /api/results — Dashboard data source (today's results per lottery)
 * POST /api/results — Manual result entry (admin), then dispatch through
 *                     LOTTERY_RESULT_READY pipeline
 */

export async function GET() {
  try {
    const db = getServiceClient()
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

    const { data: lotteries } = await db
      .from('lotteries')
      .select('*')
      .eq('status', 'active')
      .order('sort_order')

    const { data: todayResults } = await db
      .from('results')
      .select('lottery_id, top_number, bottom_number, full_number')
      .eq('draw_date', todayStr)

    const resultMap: Record<string, { top_number: string; bottom_number: string; full_number: string }> = {}
    ;(todayResults || []).forEach(r => {
      resultMap[r.lottery_id] = r
    })

    return NextResponse.json({
      lotteries: lotteries || [],
      results: resultMap,
      date: todayStr,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient()
    const body = await req.json()
    const { lottery_id, top_number, bottom_number, full_number, theme } = body

    if (!lottery_id) {
      return NextResponse.json({ error: 'lottery_id required' }, { status: 400 })
    }
    if (!top_number && !bottom_number && !full_number) {
      return NextResponse.json({ error: 'ต้องกรอกตัวเลขอย่างน้อย 1 ช่อง' }, { status: 400 })
    }

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

    // 1. Save result row (upsert)
    const { data: existing } = await db
      .from('results')
      .select('id')
      .eq('lottery_id', lottery_id)
      .eq('draw_date', todayStr)
      .maybeSingle()

    let savedResult
    if (existing) {
      const { data } = await db
        .from('results')
        .update({
          top_number: top_number || null,
          bottom_number: bottom_number || null,
          full_number: full_number || null,
          source_url: 'manual',
          scraped_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single()
      savedResult = data
    } else {
      const { data } = await db
        .from('results')
        .insert({
          lottery_id,
          draw_date: todayStr,
          top_number: top_number || null,
          bottom_number: bottom_number || null,
          full_number: full_number || null,
          source_url: 'manual',
          scraped_at: new Date().toISOString(),
        })
        .select()
        .single()
      savedResult = data
    }

    if (!savedResult) {
      return NextResponse.json({ error: 'Failed to save result' }, { status: 500 })
    }

    // 2. Dispatch via orchestrator — a new trigger_id per submission ensures
    // the manual button always re-dispatches (admin intent to re-send).
    const trigger_id = `manual-${lottery_id}-${todayStr}-${Date.now()}`
    const ingestRes = await ingestEvent({
      trigger_id,
      source: 'manual',
      lottery_id,
      draw_date: todayStr,
      round: null,
      numbers: {
        top_number: top_number || null,
        bottom_number: bottom_number || null,
        full_number: full_number || null,
      },
      metadata: {
        source_url: 'manual',
        result_id: savedResult.id,
        theme: theme || undefined,
      },
    })

    const summary = ingestRes.duplicate
      ? 'บันทึกแล้ว → pipeline ตรวจว่าส่งไปแล้ว (duplicate)'
      : ingestRes.ok
        ? `บันทึกแล้ว → ส่งสำเร็จ ${ingestRes.dispatched?.succeeded || 0}/${ingestRes.dispatched?.total || 0}`
        : `บันทึกแล้ว → dispatch ล้มเหลว: ${ingestRes.reason || 'unknown'}`

    return NextResponse.json({
      success: ingestRes.ok,
      result: savedResult,
      pipeline: ingestRes,
      summary,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
