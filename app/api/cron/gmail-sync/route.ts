import { NextResponse, type NextRequest } from 'next/server'
import { syncAllDue } from '@/lib/import/sync'

export const maxDuration = 60

// Called by Vercel Cron (see vercel.json), which sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const results = await syncAllDue()
  return NextResponse.json({ synced: results.length, results })
}
