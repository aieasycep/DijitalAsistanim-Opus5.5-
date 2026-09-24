/**
 * API-DEV-04 `POST /notifications/test` [IK] (IMPLEMENTATION_PLAN T-6.07): a user test push to one
 * installation through the full decision and render path (3 per hour). Quiet hours, a disabled
 * category or a missing device answer `409 STATE_CONFLICT` with `details.reason`.
 */
import { routes, UserTestPushBody } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
} from '../../_shared/http/validate.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { pokeWorker } from '../../_shared/jobs/client.ts';
import {
  sendUserTestPush,
  type TestPushResult,
} from '../../_shared/services/notifications/test-push.ts';
import type { RouteRegistrar } from '../deps.ts';

export const registerNotificationRoutes: RouteRegistrar = (app, kit) => {
  const test = routes['POST /notifications/test'];
  mountRoute(
    app,
    test,
    ...kit.chain({ gate: true, rateLimit: 'notifications_test' }),
    parseJsonBody(test),
    validateRequest(test),
    (c) => {
      const auth = currentUser(c);
      const body = validBody(c, UserTestPushBody);
      const repos = kit.deps.repos(auth);
      return withIdempotency(
        c,
        { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
        {
          status: 202,
          async execute() {
            const data = await sendUserTestPush(
              {
                repo: repos.notifications,
                installationRow: (userId, installationId) =>
                  repos.approvals.installationByClientId(userId, installationId),
                jobByKey: (key) => repos.jobs.byKey(key),
                enqueue: (input) => repos.jobs.enqueue(input),
                pushConfigured: kit.deps.capabilities.push,
                now: kit.now,
                correlationId: c.get('correlationId'),
              },
              {
                userId: auth.userId,
                installationId: body.installation_id,
                category: body.category,
              },
            );
            await pokeWorker({
              baseUrl: kit.deps.env.SUPABASE_URL,
              secret: kit.deps.env.CRON_SECRET,
              reason: 'user_test_push',
              log: c.get('log'),
              ...(kit.deps.fetch === undefined ? {} : { fetch: kit.deps.fetch }),
            });
            return {
              data,
              ref: {
                type: 'notification',
                id: data.notification_id,
                ack: { job_id: data.job.job_id },
              },
            };
          },
          replay(ref) {
            const jobId = typeof ref.ack?.job_id === 'string' ? ref.ack.job_id : '';
            const result: TestPushResult = {
              notification_id: ref.id ?? '',
              job: { job_id: jobId, status: 'queued', poll_after_ms: 1500 },
              deferred_until: null,
            };
            return Promise.resolve(result);
          },
        },
      );
    },
  );
};
