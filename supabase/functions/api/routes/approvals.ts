/**
 * Approval routes (IMPLEMENTATION_PLAN T-6.01, T-6.05; API_CONTRACTS §8.6, all [IK]):
 * API-APR-01 `POST /approvals`, API-APR-02 `PATCH /approvals/:id`, API-APR-03
 * `POST /approvals/:id/approve`, API-APR-04 `POST /approvals/:id/reject` and API-APR-05
 * `POST /approvals/:id/device-execution` (R-18). The approval rows are written only through the
 * service functions (`create_approval`, `transition_approval`, `edit_approval_payload`,
 * `start_device_execution`); an HTTP replay re-renders the current approval.
 */
import type { MiddlewareHandler } from 'hono';
import {
  ApprovalApproveBody,
  ApprovalEditBody,
  ApprovalIdParams,
  ApprovalProposeBody,
  ApprovalRejectBody,
  DeviceExecutionBody,
  routes,
} from '@da/validation';
import { APPROVAL_VIA_VALUES } from '@da/domain';
import { currentUser } from '../../_shared/auth/user.ts';
import { AppError } from '../../_shared/errors.ts';
import type { AppContext, AppEnv } from '../../_shared/http/context.ts';
import {
  mountRoute,
  parseJsonBody,
  rawBody,
  validateRequest,
  validBody,
  validParams,
} from '../../_shared/http/validate.ts';
import { serverLocale } from '../../_shared/i18n/catalog.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { pokeWorker } from '../../_shared/jobs/client.ts';
import { approveApproval } from '../../_shared/services/approvals/approve.ts';
import type { ApprovalServiceDeps } from '../../_shared/services/approvals/context.ts';
import { deviceExecution } from '../../_shared/services/approvals/device.ts';
import { editApproval } from '../../_shared/services/approvals/edit.ts';
import { proposeApproval } from '../../_shared/services/approvals/propose.ts';
import { rejectApproval } from '../../_shared/services/approvals/reject.ts';
import { toApprovalView } from '../../_shared/services/approvals/view.ts';
import type { RequestRepos, RouteKit, RouteRegistrar } from '../deps.ts';

function serviceDeps(c: AppContext, kit: RouteKit, repos: RequestRepos): ApprovalServiceDeps {
  const log = c.get('log');
  return {
    repo: repos.approvals,
    audit: kit.deps.audit,
    now: kit.now,
    locale: serverLocale(c.get('locale')),
    correlationId: c.get('correlationId'),
    enqueue: (input) =>
      repos.jobs.enqueue({ ...input, correlationId: input.correlationId ?? null }),
    pokeWorker: async (reason) => {
      await pokeWorker({
        baseUrl: kit.deps.env.SUPABASE_URL,
        secret: kit.deps.env.CRON_SECRET,
        reason,
        log,
        ...(kit.deps.fetch === undefined ? {} : { fetch: kit.deps.fetch }),
      });
    },
    ...(repos.eventPrecondition === undefined
      ? {}
      : { eventPrecondition: repos.eventPrecondition }),
  };
}

async function currentView(
  c: AppContext,
  repos: RequestRepos,
  userId: string,
  id: string | undefined,
) {
  const row = id === undefined ? null : await repos.approvals.get(userId, id);
  if (row === null) throw new AppError('NOT_FOUND');
  return toApprovalView(row, { locale: serverLocale(c.get('locale')) });
}

const VIA = new Set<string>(APPROVAL_VIA_VALUES);

/**
 * R-03: every `approved_via` is a tap; a spoken approval (`voice`) or any other value is refused
 * with `details.reason` before the schema check.
 */
const tapOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  const raw = rawBody(c) as { approved_via?: unknown } | undefined;
  const via = raw?.approved_via;
  if (typeof via === 'string' && !VIA.has(via)) {
    throw new AppError('VALIDATION_FAILED', {
      details: { reason: via === 'voice' ? 'voice_approval_not_allowed' : 'approved_via_invalid' },
      fieldErrors: [
        { path: 'approved_via', code: 'invalid_value', message_key: 'validation.invalid_value' },
      ],
    });
  }
  await next();
};

export const registerApprovalRoutes: RouteRegistrar = (app, kit) => {
  const idem = { repo: kit.deps.idempotency, now: () => kit.now().getTime() };

  const propose = routes['POST /approvals'];
  mountRoute(
    app,
    propose,
    ...kit.chain({ gate: true, rateLimit: 'approvals_mutate' }),
    parseJsonBody(propose),
    validateRequest(propose),
    (c) => {
      const auth = currentUser(c);
      const body = validBody(c, ApprovalProposeBody);
      const repos = kit.deps.repos(auth);
      return withIdempotency(c, idem, {
        status: 201,
        async execute() {
          const out = await proposeApproval(serviceDeps(c, kit, repos), {
            userId: auth.userId,
            payload: body.payload,
            origin: body.origin,
            originRefId: body.origin_ref_id,
            source: body.source,
            batchId: body.batch_id,
            actor: 'user',
          });
          return { data: out.view, ref: { type: 'approval_action', id: out.approval.id } };
        },
        replay: (ref) => currentView(c, repos, auth.userId, ref.id),
      });
    },
  );

  const edit = routes['PATCH /approvals/:id'];
  mountRoute(
    app,
    edit,
    ...kit.chain({ gate: true, rateLimit: 'approvals_mutate' }),
    parseJsonBody(edit),
    validateRequest(edit),
    (c) => {
      const auth = currentUser(c);
      const { id } = validParams(c, ApprovalIdParams);
      const body = validBody(c, ApprovalEditBody);
      const repos = kit.deps.repos(auth);
      return withIdempotency(c, idem, {
        status: 200,
        async execute() {
          const out = await editApproval(serviceDeps(c, kit, repos), {
            userId: auth.userId,
            approvalId: id,
            expectedPayloadVersion: body.expected_payload_version,
            patch: body.payload_patch,
          });
          return { data: out.view, ref: { type: 'approval_action', id } };
        },
        replay: (ref) => currentView(c, repos, auth.userId, ref.id),
      });
    },
  );

  const approve = routes['POST /approvals/:id/approve'];
  mountRoute(
    app,
    approve,
    ...kit.chain({ gate: true, rateLimit: 'approvals_mutate' }),
    parseJsonBody(approve),
    tapOnly,
    validateRequest(approve),
    (c) => {
      const auth = currentUser(c);
      const { id } = validParams(c, ApprovalIdParams);
      const body = validBody(c, ApprovalApproveBody);
      const repos = kit.deps.repos(auth);
      const run = () =>
        approveApproval(serviceDeps(c, kit, repos), {
          userId: auth.userId,
          approvalId: id,
          idempotencyKey: body.idempotency_key,
          payloadVersion: body.payload_version,
          approvedVia: body.approved_via,
          installationId: c.get('installationId'),
        });
      return withIdempotency(c, idem, {
        status: 202,
        async execute() {
          return { data: await run(), ref: { type: 'approval_action', id } };
        },
        replay: () => run(),
      });
    },
  );

  const reject = routes['POST /approvals/:id/reject'];
  mountRoute(
    app,
    reject,
    ...kit.chain({ gate: true, rateLimit: 'approvals_mutate' }),
    parseJsonBody(reject),
    validateRequest(reject),
    (c) => {
      const auth = currentUser(c);
      const { id } = validParams(c, ApprovalIdParams);
      const body = validBody(c, ApprovalRejectBody);
      const repos = kit.deps.repos(auth);
      return withIdempotency(c, idem, {
        status: 200,
        async execute() {
          const out = await rejectApproval(serviceDeps(c, kit, repos), {
            userId: auth.userId,
            approvalId: id,
            reason: body.reason,
            learn: body.learn,
            note: body.note,
          });
          return { data: out.view, ref: { type: 'approval_action', id } };
        },
        replay: (ref) => currentView(c, repos, auth.userId, ref.id),
      });
    },
  );

  const device = routes['POST /approvals/:id/device-execution'];
  mountRoute(
    app,
    device,
    ...kit.chain({ gate: true, rateLimit: 'device_execution' }),
    parseJsonBody(device),
    validateRequest(device),
    (c) => {
      const auth = currentUser(c);
      const { id } = validParams(c, ApprovalIdParams);
      const body = validBody(c, DeviceExecutionBody);
      const repos = kit.deps.repos(auth);
      const run = () =>
        deviceExecution(serviceDeps(c, kit, repos), {
          userId: auth.userId,
          approvalId: id,
          headerInstallation: c.get('installationId'),
          body,
        });
      return withIdempotency(c, idem, {
        status: 200,
        async execute() {
          const out = await run();
          return {
            data: out.data,
            ref: { type: 'approval_action', id, ack: { phase: out.phase } },
          };
        },
        async replay(ref) {
          if (ref.ack?.phase === 'claim') return (await run()).data;
          return currentView(c, repos, auth.userId, ref.id);
        },
      });
    },
  );
};
