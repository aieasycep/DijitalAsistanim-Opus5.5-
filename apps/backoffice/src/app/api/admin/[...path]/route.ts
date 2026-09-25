import { NextResponse, type NextRequest } from 'next/server';

import { remainingMs } from '@/lib/admin-context';
import { loginReason } from '@/lib/error-copy';
import { adminApi, type AdminApiFailure } from '@/server/admin-api';
import { checkFetchSite } from '@/server/csrf';

/*
 * GET-only read proxy for client components (BACKOFFICE_PLAN §2.3 "Client reads"): the command
 * palette search, the SessionWatcher's session probe, the Jobs live view ("Canlı (10 sn)", R-19:
 * polling, no Realtime) and the push-test dialog's quiet-hours preview. Allow-listed paths only;
 * background reads are forwarded with `x-da-activity: background`, so polling never extends the
 * idle window. Route handlers never mutate anything.
 */

/** Query keys the Jobs list accepts (`GET /jobs`); anything else is dropped. */
const JOBS_QUERY_KEY =
  /^(page|page_size|sort|order|q|filter\[(type|status|user_id|account_id|from|to)\])$/;

export const dynamic = 'force-dynamic';

/** `support-access/grants/<uuid>/content/<scope>` (BACKOFFICE_PLAN §9). */
const SUPPORT_CONTENT =
  /^support-access\/grants\/([0-9a-f-]{36})\/content\/(pii|email_metadata|insights|notifications|captures|assistant_transcript|ai_feedback)$/;

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
  const joined = path.join('/');
  const content = SUPPORT_CONTENT.exec(joined);
  if (content !== null) {
    // An explicit "Göster" click in the Support Access banner: admin activity, audited server-side.
    const result = await adminApi(
      'GET /support-access/grants/:id/content/:scope',
      {
        params: { id: content[1] ?? '', scope: content[2] ?? '' },
        query: {
          entity_type: request.nextUrl.searchParams.get('entity_type') ?? '',
          entity_id: request.nextUrl.searchParams.get('entity_id') ?? '',
        },
      },
      { activity: 'user' },
    );
    if (!result.ok) return failureResponse(result.error);
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
  }
  switch (joined) {
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
    case 'jobs': {
      const query: Record<string, string> = {};
      for (const [key, value] of request.nextUrl.searchParams) {
        if (JOBS_QUERY_KEY.test(key)) query[key] = value;
      }
      const result = await adminApi('GET /jobs', { query }, { activity: 'background' });
      if (!result.ok) return failureResponse(result.error);
      return NextResponse.json(
        {
          rows: result.data,
          total: result.meta.total,
          total_is_estimate: result.meta.total_is_estimate,
          server_time: result.meta.server_time,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    case 'notifications/test-push/preview': {
      // Opening the push-test dialog is admin activity (not background polling).
      const installation = request.nextUrl.searchParams.get('installation_id');
      const result = await adminApi(
        'GET /notifications/test-push/preview',
        {
          query: {
            user_id: request.nextUrl.searchParams.get('user_id') ?? '',
            ...(installation === null || installation === ''
              ? {}
              : { installation_id: installation }),
          },
        },
        { activity: 'user' },
      );
      if (!result.ok) return failureResponse(result.error);
      return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
    }
    default:
      return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  }
}
