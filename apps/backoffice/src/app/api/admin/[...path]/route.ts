import { NextResponse, type NextRequest } from 'next/server';

import { remainingMs } from '@/lib/admin-context';
import { loginReason } from '@/lib/error-copy';
import { adminApi, type AdminApiFailure } from '@/server/admin-api';
import { checkFetchSite } from '@/server/csrf';

/*
 * GET-only read proxy for client components (BACKOFFICE_PLAN §2.3 "Client reads"): the command
 * palette search and the SessionWatcher's session probe. Allow-listed paths only; requests are
 * forwarded with `x-da-activity: background`, so polling never extends the idle window. Route
 * handlers never mutate anything.
 */

export const dynamic = 'force-dynamic';

function failureResponse(error: AdminApiFailure): NextResponse {
  const status = error.code === 'REQUEST_INVALID' ? 422 : error.status >= 400 ? error.status : 502;
  return NextResponse.json(
    {
      error: {
        code: error.code,
        correlation_id: error.correlationId,
        ...(error.code === 'AUTH_REQUIRED' ? { reason: loginReason(error) } : {}),
      },
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (!checkFetchSite(request.headers).ok) {
    return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  }
  const { path } = await context.params;
  switch (path.join('/')) {
    case 'search': {
      const q = request.nextUrl.searchParams.get('q') ?? '';
      const result = await adminApi('GET /search', { query: { q } }, { activity: 'background' });
      if (!result.ok) return failureResponse(result.error);
      return NextResponse.json(
        { results: result.data.results },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    case 'me': {
      const result = await adminApi('GET /me', {}, { activity: 'background' });
      if (!result.ok) return failureResponse(result.error);
      return NextResponse.json(
        {
          session: {
            idle_remaining_ms: remainingMs(
              result.data.session.idle_expires_at,
              result.meta.server_time,
            ),
            absolute_remaining_ms: remainingMs(
              result.data.session.absolute_expires_at,
              result.meta.server_time,
            ),
          },
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    default:
      return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  }
}
