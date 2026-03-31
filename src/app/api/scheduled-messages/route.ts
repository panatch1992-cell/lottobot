import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function GET() {
  try {
    const db = getServiceClient()
    const { data, error } = await db.from('scheduled_messages')
      .select('*')
      .order('send_time')
    if (error) throw error
    return NextResponse.json({ messages: data || [] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient()
    const body = await req.json()
    const { message, send_time, repeat_days, target } = body

    if (!message?.trim() || !send_time) {
      return NextResponse.json({ error: 'กรุณากรอกข้อความและเวลา' }, { status: 400 })
    }

    const { data, error } = await db.from('scheduled_messages').insert({
      message: message.trim(),
      send_time,
      repeat_days: repeat_days || 'daily',
      target: target || 'both',
    }).select().single()

    if (error) throw error
    return NextResponse.json({ success: true, message: data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const db = getServiceClient()
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { data, error } = await db.from('scheduled_messages').update({
      ...updates,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select().single()

    if (error) throw error
    return NextResponse.json({ success: true, message: data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = getServiceClient()
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { error } = await db.from('scheduled_messages').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
