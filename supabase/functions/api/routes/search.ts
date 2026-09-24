/**
 * API-SRCH-01 `GET /search` (IMPLEMENTATION_PLAN T-5.07; M§26, M§95). Free: FTS keyword mode over
 * every type except `memory` (`meta.locked_types=['memory']` when requested). Pro: hybrid (query
 * embedding within `semantic_search_daily`, degrading to `fts_only` — never an error), and
 * `mode=answer` with a grounded answer or "Bunu kayıtlarında bulamadım.". RPC-02 runs with the
 * caller's JWT, so results are RLS-scoped and retention-filtered.
 */
import { routes, SearchQuery } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { AppError } from '../../_shared/errors.ts';
import { sendData } from '../../_shared/http/respond.ts';
import { mountRoute, validateRequest, validQuery } from '../../_shared/http/validate.ts';
import { embedTexts } from '../../_shared/services/memory/embed.ts';
import { runSearch } from '../../_shared/services/memory/search.ts';
import type { RouteRegistrar } from '../deps.ts';

export const registerSearchRoutes: RouteRegistrar = (app, kit) => {
  const route = routes['GET /search'];
  mountRoute(
    app,
    route,
    ...kit.chain({ gate: true, rateLimit: 'search' }),
    validateRequest(route),
    async (c) => {
      const api = kit.deps.intel;
      if (api === undefined) throw new AppError('SERVICE_UNAVAILABLE', { details: { reason: 'intel_not_configured' } });
      const auth = currentUser(c);
      const query = validQuery(c, SearchQuery);
      const user = await api.ai.users.load(auth.userId);
      if (query.mode === 'answer' && !user.isPro) {
        throw new AppError('ENTITLEMENT_REQUIRED', { details: { feature: 'memory_search' } });
      }
      const repo = api.search(auth);
      const correlationId = c.get('correlationId');
      const outcome = await runSearch(
        {
          search: (args) => repo.search(args),
          contactsNamed: (names) => repo.contactsNamed(names),
          ownsContact: (id) => repo.ownsContact(id),
          semanticQuota: () => repo.semanticQuota(),
          embedQuery: user.isPro
            ? (text) =>
                embedTexts(api.ai.runtime, {
                  feature: 'embedding_query',
                  userId: user.userId,
                  plan: user.plan,
                  profile: user.profile,
                  flags: user.flags,
                  inputs: [text],
                  correlationId,
                })
            : null,
        },
        {
          q: query.q,
          mode: query.mode,
          types: query.types,
          contact_id: query.contact_id,
          from: query.from,
          to: query.to,
          limit: query.limit,
          cursor: query.cursor,
        },
        { isPro: user.isPro, now: kit.now(), timeZone: user.timeZone, locale: user.locale },
      );
      const retention = await repo.retention();
      const last = outcome.data.results[outcome.data.results.length - 1];
      const nextCursor =
        last !== undefined && outcome.data.results.length >= query.limit
          ? btoa(`${last.score}|${last.type}|${last.id}`)
          : null;
      return sendData(
        c,
        { ...outcome.data, ...(retention === null ? {} : { retention }) },
        200,
        {
          next_cursor: nextCursor,
          ...(outcome.lockedTypes.length > 0 ? { locked_types: [...outcome.lockedTypes] } : {}),
          ...(outcome.degraded ? { degraded: true } : {}),
        },
      );
    },
  );
};
