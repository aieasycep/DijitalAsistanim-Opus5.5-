import { NextResponse } from 'next/server';

/** Backoffice liveness for Vercel monitoring (BACKOFFICE_PLAN §2.2): no data, no session. */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
