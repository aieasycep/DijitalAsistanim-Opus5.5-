/**
 * Integration routes (API_CONTRACTS §8.3; T-4.01, T-4.11, T-4.12, T-4.13):
 * API-INT-07 `POST /integrations/oauth/complete` (registered before the `:accountId` routes),
 * API-INT-06 `POST /integrations/device-calendar/snapshot`, API-INT-01 `POST /integrations/:provider/start`,
 * API-INT-02 `POST /integrations/:accountId/upgrade`, API-INT-03 `POST /integrations/:accountId/disconnect`,
 * API-INT-04 `POST /integrations/:accountId/sync`, API-INT-05 `PATCH /integrations/:accountId/data-sources`.
 */
import type { MiddlewareHandler } from 'hono';
import {
  AccountIdParams,
  DataSourcesPatch,
  DeviceSnapshotBody,
  DisconnectBody,
  IntegrationStartBody,
  IntegrationStartParams,
  IntegrationUpgradeBody,
  OAuthCompleteBody,
  routes,
  SyncBody,
} from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { fieldError } from '../../_shared/errors.ts';
import type { AppEnv } from '../../_shared/http/context.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
  validParams,
} from '../../_shared/http/validate.ts';
import { type JsonValue, withIdempotency } from '../../_shared/idempotency.ts';
import { enforceRateLimit } from '../../_shared/ratelimit.ts';
import {
  completeOAuth,
  type CompleteResult,
  startConnect,
  type StartReplay,
  startResultOf,
  startUpgrade,
  type UpgradeResult,
} from '../../_shared/services/integrations/connect.ts';
import {
  calendarViews,
  type Consequence,
  requestForcedAnalysis,
  requestManualSync,
  updateDataSources,
} from '../../_shared/services/integrations/controls.ts';
import {
  acceptDeviceSnapshot,
  type SnapshotAccepted,
} from '../../_shared/services/integrations/device.ts';
import {
  disconnectAccount,
  type DisconnectResult,
} from '../../_shared/services/integrations/disconnect.ts';
import { jobRef } from '../../_shared/services/integrations/enqueue.ts';
import type { IntegrationRuntime } from '../../_shared/services/integrations/runtime.ts';
import { summaryOf } from '../../_shared/services/integrations/status.ts';
import type { RouteKit, RouteRegistrar } from '../deps.ts';

function hourlyStartLimit(kit: RouteKit): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await enforceRateLimit(
      c,
      { store: kit.deps.rateLimits, scope: 'api', now: () => kit.now().getTime() },
      'integrations_start_hourly',
    );
    await next();
  };
}

/** API-INT-06 says device providers use the snapshot route: 422, not a path error. */
const rejectDeviceProviders: MiddlewareHandler<AppEnv> = async (c, next) => {
  const provider = c.req.param('provider');
  if (provider === 'apple_device' || provider === 'android_device')
    throw fieldError('provider', 'use_device_snapshot');
  await next();
};

async function jobRefs(rt: IntegrationRuntime, ids: readonly string[]) {
  const statuses = new Map((await rt.store.jobStatuses(ids)).map((j) => [j.id, j.status] as const));
  return ids.map((id) => jobRef(id, statuses.get(id) ?? 'queued'));
}

function ackOf(value: Record<string, unknown>): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

export function integrationRoutes(rt: IntegrationRuntime): RouteRegistrar {
  return (app, kit) => {
    const idem = { repo: kit.deps.idempotency, now: () => kit.now().getTime() };

    // API-INT-07 (before the :accountId routes).
    const complete = routes['POST /integrations/oauth/complete'];
    mountRoute(
      app,
      complete,
      ...kit.chain({ gate: true, rateLimit: 'integrations_complete' }),
      parseJsonBody(complete),
      validateRequest(complete),
      (c) => {
        const auth = currentUser(c);
        const body = validBody(c, OAuthCompleteBody);
        return withIdempotency<CompleteResult>(c, idem, {
          status: complete.status,
          async execute() {
            const out = await completeOAuth(rt, {
              userId: auth.userId,
              completionCode: body.completion_code,
              deviceNonce: body.device_nonce,
              correlationId: c.get('correlationId'),
            });
            const { accountId, ...data } = out;
            return {
              data,
              ref: {
                type: 'connected_account',
                ...(accountId === null ? {} : { id: accountId }),
                ack: ackOf({
                  result: data.result,
                  granted: data.granted,
                  missing: data.missing,
                  resume: data.resume,
                  job_ids: data.jobs.map((j) => j.job_id),
                }),
              },
            };
          },
          async replay(ref) {
            const ack = ref.ack ?? {};
            const account = ref.id === undefined ? null : await rt.store.getAccount(ref.id);
            return {
              result: ack.result as CompleteResult['result'],
              account: account === null ? null : await summaryOf(rt, account),
              granted: (ack.granted ?? []) as CompleteResult['granted'],
              missing: (ack.missing ?? []) as CompleteResult['missing'],
              resume: (ack.resume ?? null) as CompleteResult['resume'],
              jobs: await jobRefs(rt, (ack.job_ids ?? []) as string[]),
            };
          },
        });
      },
    );

    // API-INT-06.
    const snapshot = routes['POST /integrations/device-calendar/snapshot'];
    mountRoute(
      app,
      snapshot,
      ...kit.chain({ gate: true, rateLimit: 'api_default' }),
      parseJsonBody(snapshot),
      validateRequest(snapshot),
      (c) => {
        const auth = currentUser(c);
        const body = validBody(c, DeviceSnapshotBody);
        return withIdempotency<SnapshotAccepted>(c, idem, {
          status: snapshot.status,
          async execute() {
            const data = await acceptDeviceSnapshot(rt, {
              userId: auth.userId,
              snapshot: body,
              correlationId: c.get('correlationId'),
            });
            return {
              data,
              ref: {
                type: 'job',
                id: data.job.job_id,
                ack: { connected_account_id: data.connected_account_id },
              },
            };
          },
          async replay(ref) {
            const [job] = await jobRefs(rt, ref.id === undefined ? [] : [ref.id]);
            return {
              job: job ?? jobRef(ref.id ?? ''),
              connected_account_id: String(ref.ack?.connected_account_id ?? ''),
            };
          },
        });
      },
    );

    // API-INT-01.
    const start = routes['POST /integrations/:provider/start'];
    mountRoute(
      app,
      start,
      ...kit.chain({ gate: true, rateLimit: 'integrations_start' }),
      hourlyStartLimit(kit),
      rejectDeviceProviders,
      parseJsonBody(start),
      validateRequest(start),
      (c) => {
        const auth = currentUser(c);
        const params = validParams(c, IntegrationStartParams);
        const body = validBody(c, IntegrationStartBody);
        return withIdempotency(c, idem, {
          status: start.status,
          async execute() {
            const out = await startConnect(rt, {
              userId: auth.userId,
              provider: params.provider,
              capabilities: body.capabilities,
              ...(body.account_id === undefined ? {} : { accountId: body.account_id }),
              ...(body.login_hint === undefined ? {} : { loginHint: body.login_hint }),
              deviceNonceHash: body.device_nonce_hash,
              locale: c.get('locale'),
            });
            return {
              data: out.data,
              ref: {
                type: 'oauth_state',
                id: out.replay.state_id,
                ack: { prompt: out.replay.prompt, locale: out.replay.locale },
              },
            };
          },
          async replay(ref) {
            const state = await rt.store.getState(ref.id ?? '');
            if (state === null) throw fieldError('headers.Idempotency-Key', 'flow_expired');
            const account =
              state.connected_account_id === null
                ? null
                : await rt.store.getAccount(state.connected_account_id);
            const replay: StartReplay = {
              state_id: state.id,
              login_hint: account?.account_email ?? null,
              prompt: ref.ack?.prompt === 'select_account' ? 'select_account' : 'consent',
              locale: ref.ack?.locale === 'en' ? 'en' : 'tr',
            };
            return await startResultOf(rt, state, replay);
          },
        });
      },
    );

    // API-INT-02.
    const upgrade = routes['POST /integrations/:accountId/upgrade'];
    mountRoute(
      app,
      upgrade,
      ...kit.chain({ gate: true, rateLimit: 'integrations_start' }),
      hourlyStartLimit(kit),
      parseJsonBody(upgrade),
      validateRequest(upgrade),
      (c) => {
        const auth = currentUser(c);
        const params = validParams(c, AccountIdParams);
        const body = validBody(c, IntegrationUpgradeBody);
        return withIdempotency<UpgradeResult>(c, idem, {
          status: upgrade.status,
          async execute() {
            const out = await startUpgrade(rt, {
              userId: auth.userId,
              accountId: params.accountId,
              capability: body.capability,
              ...(body.resume === undefined ? {} : { resumeApprovalId: body.resume.approval_id }),
              deviceNonceHash: body.device_nonce_hash,
              locale: c.get('locale'),
            });
            return {
              data: out.data,
              ref:
                out.replay === null
                  ? {
                      type: 'connected_account',
                      id: params.accountId,
                      ack: ackOf({ already_granted: true }),
                    }
                  : {
                      type: 'oauth_state',
                      id: out.replay.state_id,
                      ack: ackOf({
                        already_granted: false,
                        locale: out.replay.locale,
                        missing_scopes: out.missingScopes,
                      }),
                    },
            };
          },
          async replay(ref) {
            if (ref.ack?.already_granted === true) return { already_granted: true };
            const state = await rt.store.getState(ref.id ?? '');
            if (state === null) throw fieldError('headers.Idempotency-Key', 'flow_expired');
            const account =
              state.connected_account_id === null
                ? null
                : await rt.store.getAccount(state.connected_account_id);
            const rendered = await startResultOf(rt, state, {
              state_id: state.id,
              login_hint: account?.account_email ?? null,
              prompt: 'consent',
              locale: ref.ack?.locale === 'en' ? 'en' : 'tr',
            });
            return {
              already_granted: false,
              state_id: state.id,
              auth_url: rendered.auth_url,
              state_expires_at: state.expires_at,
              missing_scopes: (ref.ack?.missing_scopes ?? []) as string[],
            };
          },
        });
      },
    );

    // API-INT-03.
    const disconnect = routes['POST /integrations/:accountId/disconnect'];
    mountRoute(
      app,
      disconnect,
      // A disabled account can still disconnect its integrations.
      ...kit.chain({ gate: false, rateLimit: 'api_default' }),
      parseJsonBody(disconnect),
      validateRequest(disconnect),
      (c) => {
        const auth = currentUser(c);
        const params = validParams(c, AccountIdParams);
        const body = validBody(c, DisconnectBody);
        const run = () =>
          disconnectAccount(rt, {
            userId: auth.userId,
            accountId: params.accountId,
            purgeContent: body.purge_content,
            correlationId: c.get('correlationId'),
            log: c.get('log'),
          });
        return withIdempotency<DisconnectResult>(c, idem, {
          status: disconnect.status,
          async execute() {
            const data = await run();
            return { data, ref: { type: 'connected_account', id: params.accountId } };
          },
          // A repeat returns the current state (the call is a no-op on a disconnected account).
          replay: () => run(),
        });
      },
    );

    // API-INT-04.
    const sync = routes['POST /integrations/:accountId/sync'];
    mountRoute(
      app,
      sync,
      ...kit.chain({ gate: true, rateLimit: 'api_default' }),
      parseJsonBody(sync),
      validateRequest(sync),
      async (c) => {
        const auth = currentUser(c);
        const params = validParams(c, AccountIdParams);
        const body = validBody(c, SyncBody);
        await enforceRateLimit(
          c,
          { store: kit.deps.rateLimits, scope: 'api', now: () => kit.now().getTime() },
          'integrations_sync',
          `a:${params.accountId}`,
        );
        // M-MAIL-03 "Analiz et": `message_ids` + `force_analysis` enqueue `email_analysis` only.
        const data =
          body.message_ids !== undefined && body.force_analysis === true
            ? await requestForcedAnalysis(rt, {
                userId: auth.userId,
                accountId: params.accountId,
                messageIds: body.message_ids,
                correlationId: c.get('correlationId'),
              })
            : await requestManualSync(rt, {
                userId: auth.userId,
                accountId: params.accountId,
                ...(body.resources === undefined ? {} : { resources: body.resources }),
                correlationId: c.get('correlationId'),
              });
        return sendData(c, data, sync.status, {});
      },
    );

    // API-INT-05.
    const dataSources = routes['PATCH /integrations/:accountId/data-sources'];
    mountRoute(
      app,
      dataSources,
      ...kit.chain({ gate: true, rateLimit: 'api_default' }),
      parseJsonBody(dataSources),
      validateRequest(dataSources),
      (c) => {
        const auth = currentUser(c);
        const params = validParams(c, AccountIdParams);
        const body = validBody(c, DataSourcesPatch);
        return withIdempotency(c, idem, {
          status: dataSources.status,
          async execute() {
            const data = await updateDataSources(rt, {
              userId: auth.userId,
              accountId: params.accountId,
              ...(body.data_sources === undefined ? {} : { dataSources: body.data_sources }),
              ...(body.calendars === undefined ? {} : { calendars: body.calendars }),
              ...(body.default_write_calendar_id === undefined
                ? {}
                : { defaultWriteCalendarId: body.default_write_calendar_id }),
              expectedUpdatedAt: body.expected_updated_at,
              correlationId: c.get('correlationId'),
            });
            return {
              data,
              ref: {
                type: 'connected_account',
                id: params.accountId,
                ack: { consequences: data.consequences },
              },
            };
          },
          async replay(ref) {
            const account = await rt.store.getAccount(ref.id ?? '');
            if (account === null || account.user_id !== auth.userId)
              throw fieldError('headers.Idempotency-Key', 'resource_gone');
            return {
              account: await summaryOf(rt, account),
              calendars: await calendarViews(rt, account),
              consequences: (ref.ack?.consequences ?? []) as Consequence[],
            };
          },
        });
      },
    );
  };
}
