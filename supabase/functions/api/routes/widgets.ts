/**
 * API-WDG-01 `GET /widgets/snapshot` (IMPLEMENTATION_PLAN T-6.07): `WidgetSnapshotV1` for the
 * installation in `X-DA-Installation-Id` (a foreign or unknown installation → 404), weak ETag over
 * the rendered payload (`If-None-Match` → 304), 60 requests per hour per installation.
 */
import { routes } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { AppError } from '../../_shared/errors.ts';
import { sendCacheable } from '../../_shared/http/respond.ts';
import { mountRoute } from '../../_shared/http/validate.ts';
import { buildWidgetSnapshot, stableSnapshot } from '../../_shared/services/widgets/snapshot.ts';
import type { RouteRegistrar } from '../deps.ts';

export const registerWidgetRoutes: RouteRegistrar = (app, kit) => {
  const snapshot = routes['GET /widgets/snapshot'];
  mountRoute(
    app,
    snapshot,
    ...kit.chain({ gate: true, rateLimit: 'widgets_snapshot' }),
    async (c) => {
      const auth = currentUser(c);
      const result = await buildWidgetSnapshot(kit.deps.repos(auth).widgets, {
        installationId: c.get('installationId'),
        now: kit.now(),
      });
      if (result === 'not_found')
        throw new AppError('NOT_FOUND', { details: { resource: 'installation' } });
      return sendCacheable(c, result, stableSnapshot(result));
    },
  );
};
