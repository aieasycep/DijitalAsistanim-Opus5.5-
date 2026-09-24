/**
 * Response rendering for registry routes (BACKOFFICE_PLAN §2.5 step 11): `{data, meta}` with the
 * route's success status, page meta for list routes (`page`, `page_size`, `total`,
 * `total_is_estimate`), `Cache-Control: no-store`. The data is projected onto the contract schema
 * (`conform`) and the whole envelope is checked against the registry response schema; a mismatch
 * is logged with its issue paths (never values) so contract drift is visible in production.
 */
import type { AdminRouteContract } from '@da/validation';
import { buildMeta } from '../../_shared/http/respond.ts';
import type { AppContext } from '../../_shared/http/context.ts';
import { conform, dataSchemaOf } from './map.ts';
import type { RouteResult } from './route.ts';

const PAGE_SIZES = new Set([10, 25, 50, 100]);

export function renderResult(
  c: AppContext,
  contract: AdminRouteContract,
  result: RouteResult,
  replayed: boolean,
): Response {
  const schema = dataSchemaOf(contract.response);
  const data = schema === null ? result.data : conform(schema, result.data);
  const pageExtras =
    result.page === undefined
      ? {}
      : {
          page: result.page.page,
          page_size: PAGE_SIZES.has(result.page.page_size) ? result.page.page_size : 25,
          total: result.page.total,
          total_is_estimate: result.page.total_is_estimate ?? false,
        };
  const meta = { ...buildMeta(c, replayed ? { idempotency_replayed: true } : {}), ...pageExtras };
  const envelope = { data, meta };
  const checked = contract.response.safeParse(envelope);
  if (!checked.success) {
    c.get('log').error('response_contract_mismatch', {
      route: `${contract.method} ${contract.path}`,
      issues: checked.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}:${i.code}`),
    });
  }
  if (replayed) c.header('Idempotency-Replayed', 'true');
  c.header('Cache-Control', 'no-store');
  const status = result.status ?? (contract.status === 204 ? 200 : contract.status);
  return c.json(envelope, status);
}
