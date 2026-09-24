/**
 * Reminder routes (IMPLEMENTATION_PLAN T-6.06; API_CONTRACTS §8.7): API-REM-01
 * `POST /reminders/resolve-time` (pure), API-REM-02 `POST /reminders` (idempotent on
 * `client_reminder_id`: a replay answers 200 with `meta.idempotency_replayed`) and API-REM-03
 * `POST /reminders/:id/cancel` [IK]. Reminders to Apple Reminders, Google Tasks or To Do are
 * proposed as `reminder_create` / `task_create` approvals instead.
 */
import {
  ReminderCancelBody,
  ReminderCreateBody,
  ReminderIdParams,
  ResolveTimeBody,
  routes,
} from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { buildMeta, sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
  validParams,
} from '../../_shared/http/validate.ts';
import { serverLocale } from '../../_shared/i18n/catalog.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { AppError } from '../../_shared/errors.ts';
import {
  cancelReminder,
  createReminder,
  resolveReminderTimes,
  toReminderView,
} from '../../_shared/services/reminders.ts';
import type { RouteRegistrar } from '../deps.ts';

export const registerReminderRoutes: RouteRegistrar = (app, kit) => {
  const resolve = routes['POST /reminders/resolve-time'];
  mountRoute(
    app,
    resolve,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    parseJsonBody(resolve),
    validateRequest(resolve),
    async (c) => {
      const auth = currentUser(c);
      const body = validBody(c, ResolveTimeBody);
      const options = await resolveReminderTimes(kit.deps.repos(auth).reminders, {
        userId: auth.userId,
        presets: body.presets,
        anchorAt: body.anchor_at,
        customAt: body.custom_at,
        durationMinutes: body.duration_minutes_hint,
        now: kit.now(),
        locale: serverLocale(c.get('locale')),
      });
      return sendData(c, { options });
    },
  );

  const create = routes['POST /reminders'];
  mountRoute(
    app,
    create,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    parseJsonBody(create),
    validateRequest(create),
    async (c) => {
      const auth = currentUser(c);
      const body = validBody(c, ReminderCreateBody);
      const out = await createReminder(kit.deps.repos(auth).reminders, {
        userId: auth.userId,
        clientReminderId: body.client_reminder_id,
        title: body.title,
        preset: body.preset,
        fireAt: body.fire_at,
        anchorAt: body.anchor_at,
        channel: body.channel,
        subject: body.subject,
        origin: body.origin,
        now: kit.now(),
        locale: serverLocale(c.get('locale')),
        correlationId: c.get('correlationId'),
      });
      if (out.created) return sendData(c, out.view, 201);
      c.header('Idempotency-Replayed', 'true');
      return c.json(
        { data: out.view, meta: buildMeta(c, { idempotency_replayed: true }, kit.now()) },
        200,
      );
    },
  );

  const cancel = routes['POST /reminders/:id/cancel'];
  mountRoute(
    app,
    cancel,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    parseJsonBody(cancel),
    validateRequest(cancel),
    (c) => {
      const auth = currentUser(c);
      const { id } = validParams(c, ReminderIdParams);
      const body = validBody(c, ReminderCancelBody);
      const repo = kit.deps.repos(auth).reminders;
      return withIdempotency(
        c,
        { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
        {
          status: 200,
          async execute() {
            const view = await cancelReminder(repo, {
              userId: auth.userId,
              id,
              reason: body.reason,
            });
            return { data: view, ref: { type: 'reminder', id } };
          },
          async replay() {
            const [prefs, row] = await Promise.all([
              repo.prefs(auth.userId),
              repo.get(auth.userId, id),
            ]);
            if (row === null) throw new AppError('NOT_FOUND');
            return toReminderView(row, prefs.timeZone);
          },
        },
      );
    },
  );
};
