/**
 * Privacy routes (API_CONTRACTS §8.15; IMPLEMENTATION_PLAN T-11.01…T-11.03; SECURITY_AND_PRIVACY_PLAN
 * §4.6–§4.8; R-16; M§128, M§129).
 *
 * - API-PRV-01 `POST /privacy/export` [IK]: one export in flight per user (`STATE_CONFLICT
 *   {active_request_id}`); the request, JOB-21 and the audit row commit together.
 * - API-PRV-04 `POST /privacy/export/:id/download` [IK]: owner only (another user's id is
 *   `NOT_FOUND`), `ready` and unexpired (`STATE_CONFLICT {status}`); every call, replays included,
 *   mints a fresh 300 s signed URL that is never stored or logged.
 * - API-PRV-02 `POST /privacy/delete-history` [IK]: re-authentication within 10 minutes
 *   (`REAUTH_REQUIRED {max_age_seconds:600}`), explicit `confirm:true`, the counts shown in the
 *   sheet computed before the job is queued, one active history deletion per user.
 * - API-PRV-03 `POST /privacy/delete-account` [IK]: re-authentication, the localized confirmation
 *   word, the store-subscription acknowledgement; the request (`status_token` shown once, only its
 *   sha256 stored), `deletion_pending`, push off and JOB-23 commit together; the other sessions are
 *   signed out. A repeat returns the same request with a fresh status token. This route skips the
 *   account-state gate so a pending (or disabled) account can still confirm its deletion.
 */
import {
  DeleteAccountBody,
  DeleteHistoryBody,
  ExportBody,
  ExportDownloadParams,
  routes,
} from '@da/validation';
import { currentUser, requireRecentAuth } from '../../_shared/auth/user.ts';
import { toBase64Url } from '../../_shared/crypto/encoding.ts';
import { sha256 } from '../../_shared/crypto/hmac.ts';
import { AppError, fieldError } from '../../_shared/errors.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
  validParams,
} from '../../_shared/http/validate.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { pokeWorker } from '../../_shared/jobs/client.ts';
import type { AuthAdmin } from '../../_shared/services/privacy/providers.ts';
import { exportPath, EXPORT_BUCKET } from '../../_shared/services/privacy/export.ts';
import type { HistoryCounts, PrivacyRepo } from '../../_shared/services/privacy/repo.ts';
import type { ObjectStore } from '../../_shared/services/privacy/storage.ts';
import type { RouteKit, RouteRegistrar } from '../deps.ts';

/** R-16: the latest sign-in must be at most 10 minutes old. */
export const REAUTH_MAX_AGE_SECONDS = 600;
export const DOWNLOAD_URL_TTL_SECONDS = 300;

/** What a history deletion keeps (API-PRV-02 `preserved`; privacy.history.willKeep). */
export const HISTORY_PRESERVED = [
  'connections',
  'settings',
  'vip',
  'priority_rules',
  'approved_items',
] as const;

const SUBSCRIPTION_MANAGEMENT_URL: Readonly<Record<string, string>> = {
  app_store: 'https://apps.apple.com/account/subscriptions',
  mac_app_store: 'https://apps.apple.com/account/subscriptions',
  play_store: 'https://play.google.com/store/account/subscriptions',
};

export interface PrivacyApiDeps {
  readonly repo: PrivacyRepo;
  readonly store: ObjectStore;
  readonly authAdmin: Pick<AuthAdmin, 'signOutOthers'>;
}

async function poke(kit: RouteKit, reason: string): Promise<void> {
  await pokeWorker({
    baseUrl: kit.deps.env.SUPABASE_URL,
    secret: kit.deps.env.CRON_SECRET,
    reason,
    log: kit.deps.log,
    ...(kit.deps.fetch === undefined ? {} : { fetch: kit.deps.fetch }),
  });
}

function countsAck(counts: HistoryCounts): Record<string, number> {
  return { ...counts };
}

export function privacyRoutes(privacy: PrivacyApiDeps): RouteRegistrar {
  return (app, kit) => {
    const idempotency = { repo: kit.deps.idempotency, now: () => kit.now().getTime() };

    // ── API-PRV-01 ──
    const exportRoute = routes['POST /privacy/export'];
    mountRoute(
      app,
      exportRoute,
      ...kit.chain({ gate: true, rateLimit: 'privacy_export' }),
      parseJsonBody(exportRoute),
      validateRequest(exportRoute),
      (c) => {
        const auth = currentUser(c);
        const body = validBody(c, ExportBody);
        return withIdempotency(c, idempotency, {
          status: 202,
          async execute() {
            const created = await privacy.repo.createExportRequest(
              auth.userId,
              body.include ?? null,
              c.get('correlationId'),
            );
            if (!created.created) {
              throw new AppError('STATE_CONFLICT', {
                details: { active_request_id: created.request_id },
              });
            }
            await poke(kit, 'privacy_export');
            return {
              data: { request_id: created.request_id, status: 'requested' as const },
              ref: { type: 'data_export_request', id: created.request_id },
            };
          },
          async replay(ref) {
            const row = ref.id === undefined ? null : await privacy.repo.getExport(ref.id);
            if (row === null || row.user_id !== auth.userId) throw new AppError('NOT_FOUND');
            return { request_id: row.id, status: row.status };
          },
        });
      },
    );

    // ── API-PRV-04 ──
    const download = routes['POST /privacy/export/:id/download'];
    mountRoute(
      app,
      download,
      ...kit.chain({ gate: true, rateLimit: 'privacy_export_download' }),
      parseJsonBody(download),
      validateRequest(download),
      (c) => {
        const auth = currentUser(c);
        const { id } = validParams(c, ExportDownloadParams);
        const mint = async (first: boolean) => {
          const row = await privacy.repo.getExport(id);
          if (row === null || row.user_id !== auth.userId) throw new AppError('NOT_FOUND');
          const now = kit.now();
          const expired = row.expires_at === null || Date.parse(row.expires_at) <= now.getTime();
          if (row.status !== 'ready' || expired || row.sha256 === null) {
            throw new AppError('STATE_CONFLICT', {
              details: { status: row.status === 'ready' ? 'expired' : row.status },
            });
          }
          const signedUrl = await privacy.store.signedUrl(
            EXPORT_BUCKET,
            row.storage_path ?? exportPath(row.user_id, row.id),
            DOWNLOAD_URL_TTL_SECONDS,
          );
          await privacy.repo.updateExport(row.id, auth.userId, {
            downloaded_at: now.toISOString(),
          });
          if (first) {
            await kit.deps.audit.append({
              actorType: 'user',
              actorId: auth.userId,
              action: 'user.privacy.export_downloaded',
              targetType: 'data_export_request',
              targetId: row.id,
              targetUserId: auth.userId,
              result: 'success',
              correlationId: c.get('correlationId'),
            });
          }
          return {
            signed_url: signedUrl,
            expires_at: new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
            file_size_bytes: row.file_size_bytes ?? 0,
            sha256: row.sha256,
          };
        };
        return withIdempotency(c, idempotency, {
          status: 200,
          async execute() {
            return { data: await mint(true), ref: { type: 'data_export_request', id } };
          },
          replay: () => mint(false),
        });
      },
    );

    // ── API-PRV-02 ──
    const history = routes['POST /privacy/delete-history'];
    mountRoute(
      app,
      history,
      ...kit.chain({ gate: true, rateLimit: 'privacy_delete_history' }),
      parseJsonBody(history),
      validateRequest(history),
      (c) => {
        const auth = currentUser(c);
        requireRecentAuth(auth, REAUTH_MAX_AGE_SECONDS, kit.now());
        const body = validBody(c, DeleteHistoryBody);
        const accountId =
          body.scope.type === 'connected_account' ? body.scope.connected_account_id : null;
        return withIdempotency(c, idempotency, {
          status: 202,
          async execute() {
            const counts = await privacy.repo.historyCounts(auth.userId, accountId);
            const created = await privacy.repo.createDeletionRequest({
              userId: auth.userId,
              kind: 'history',
              statusTokenHash: null,
              scope: body.scope.type,
              accountId,
              correlationId: c.get('correlationId'),
            });
            if (!created.created) {
              throw new AppError('STATE_CONFLICT', {
                details: { active_request_id: created.request_id },
              });
            }
            await poke(kit, 'privacy_history_deletion');
            return {
              data: {
                request_id: created.request_id,
                status: 'queued',
                will_delete: counts,
                preserved: [...HISTORY_PRESERVED],
              },
              ref: {
                type: 'data_deletion_request',
                id: created.request_id,
                ack: countsAck(counts),
              },
            };
          },
          async replay(ref) {
            const row = ref.id === undefined ? null : await privacy.repo.getDeletionRequest(ref.id);
            if (row === null || row.user_id !== auth.userId) throw new AppError('NOT_FOUND');
            const ack = (ref.ack ?? {}) as Record<string, number>;
            return {
              request_id: row.id,
              status: row.status,
              will_delete: {
                summaries: ack.summaries ?? 0,
                priority_decisions: ack.priority_decisions ?? 0,
                memory_chunks: ack.memory_chunks ?? 0,
                assistant_threads: ack.assistant_threads ?? 0,
                learned_preferences: ack.learned_preferences ?? 0,
                insights: ack.insights ?? 0,
                briefings: ack.briefings ?? 0,
              },
              preserved: [...HISTORY_PRESERVED],
            };
          },
        });
      },
    );

    // ── API-PRV-03 ──
    const account = routes['POST /privacy/delete-account'];
    mountRoute(
      app,
      account,
      ...kit.chain({ gate: false, rateLimit: 'privacy_delete_account' }),
      parseJsonBody(account),
      validateRequest(account),
      (c) => {
        const auth = currentUser(c);
        requireRecentAuth(auth, REAUTH_MAX_AGE_SECONDS, kit.now());
        const body = validBody(c, DeleteAccountBody);
        const subscriptionNotice = async () => {
          const sub = await kit.deps.repos(auth).entitlements.subscription(auth.userId);
          const active = sub !== null && sub.is_active && sub.store !== null;
          return {
            active,
            management_url: active ? (SUBSCRIPTION_MANAGEMENT_URL[sub.store ?? ''] ?? null) : null,
          };
        };
        const request = async () => {
          const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
          const created = await privacy.repo.createDeletionRequest({
            userId: auth.userId,
            kind: 'account',
            statusTokenHash: await sha256(token),
            scope: null,
            accountId: null,
            correlationId: c.get('correlationId'),
          });
          return { created, token };
        };
        return withIdempotency(c, idempotency, {
          status: 202,
          async execute() {
            const notice = await subscriptionNotice();
            if (notice.active && !body.acknowledge_subscription) {
              throw fieldError('acknowledge_subscription', 'subscription_ack_required');
            }
            const { created, token } = await request();
            if (!(await privacy.authAdmin.signOutOthers(auth.jwt))) {
              c.get('log').warn('deletion_sign_out_others_failed');
            }
            if (created.created) await poke(kit, 'privacy_account_deletion');
            return {
              data: {
                request_id: created.request_id,
                status: 'queued' as const,
                status_token: token,
                subscription_notice: notice,
              },
              ref: { type: 'data_deletion_request', id: created.request_id },
            };
          },
          async replay(ref) {
            const row = ref.id === undefined ? null : await privacy.repo.getDeletionRequest(ref.id);
            if (row === null || row.user_id !== auth.userId) throw new AppError('NOT_FOUND');
            if (!['requested', 'verified', 'queued', 'processing'].includes(row.status)) {
              throw new AppError('STATE_CONFLICT', { details: { status: row.status } });
            }
            // The token is shown once: a replay rotates it on the same active request.
            const { created, token } = await request();
            return {
              request_id: created.request_id,
              status: 'queued' as const,
              status_token: token,
              subscription_notice: await subscriptionNotice(),
            };
          },
        });
      },
    );
  };
}
