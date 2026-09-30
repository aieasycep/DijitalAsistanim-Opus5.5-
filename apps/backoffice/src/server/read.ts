import 'server-only';

import { redirect } from 'next/navigation';

import { sessionRedirect } from '@/lib/error-copy';
import type { ReadFailure } from '@/lib/read-result';
import { adminApi, type AdminApiInput } from './admin-api';
import type { RouteData, RouteMeta, TypedRouteKey } from './admin-contracts';

export type { ReadFailure } from '@/lib/read-result';

/*
 * Page reads (BACKOFFICE_PLAN §2.3 "Read path"): server components call admin-api through this
 * helper. Session failures redirect to /login or /mfa; every other failure comes back as a small,
 * serialisable `ReadFailure` that the page renders with its own state component (error with the
 * correlation id and [Tekrar dene], or the forbidden state). A page's primary read is always sent,
 * even when the admin's permissions suggest it will be refused, so admin-api's guard decides and
 * audits the denial (§4.5); secondary panels are skipped cosmetically instead.
 */

export type ReadResult<K extends TypedRouteKey> =
  | { readonly ok: true; readonly data: RouteData<K>; readonly meta: RouteMeta<K> }
  | { readonly ok: false; readonly error: ReadFailure };

export async function readAdmin<K extends TypedRouteKey>(
  key: K,
  input: AdminApiInput = {},
): Promise<ReadResult<K>> {
  const result = await adminApi(key, input);
  if (result.ok) return { ok: true, data: result.data, meta: result.meta };
  const to = sessionRedirect(result.error);
  if (to !== null) redirect(to);
  return {
    ok: false,
    error: {
      code: result.error.code,
      correlationId: result.error.correlationId,
      forbidden: result.error.code === 'FORBIDDEN',
      notFound: result.error.code === 'NOT_FOUND',
    },
  };
}
