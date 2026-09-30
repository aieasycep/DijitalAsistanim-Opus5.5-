/**
 * API-APR-05 `POST /approvals/:id/device-execution` (R-18, API_CONTRACTS §6.7): on-device writes for
 * EventKit, CalendarContract and Apple Reminders.
 *
 * - `claim`: the destination installation (`X-DA-Installation-Id` = body `installation_id` =
 *   `device_installation_id`) moves an `approved` approval to `executing` and receives a fresh
 *   one-time `device_token` plus the instructions; only the token's sha256 is stored.
 * - `result`: the same installation reports `executed` (with the marker probe's
 *   `already_existed` and `device_ref_hash`) or `failed` (`DEVICE_WRITE_FAILED`, the device error
 *   code as message). The token is checked against the stored hash; a repeat on a finished
 *   approval with the right token returns the current view and writes nothing.
 * - Calendar results enqueue an `insight_refresh {scope:'calendar'}`; the app then uploads a fresh
 *   device snapshot (API-INT-06).
 */
import type { ApprovalPayload, ApprovalView } from '@da/validation';
import { toHex } from '../../crypto/encoding.ts';
import { sha256, timingSafeEqual } from '../../crypto/hmac.ts';
import { fromHex } from '../../crypto/encoding.ts';
import { AppError } from '../../errors.ts';
import { newDeviceToken } from './approve.ts';
import { type ApprovalServiceDeps, requireApproval, stateConflict } from './context.ts';
import type { ApprovalRow, InstallationInfo } from './model.ts';
import { toApprovalView } from './view.ts';

export type DeviceErrorCode =
  'permission_denied' | 'calendar_read_only' | 'not_found' | 'cancelled_by_user' | 'unknown';

export type DeviceExecutionRequest =
  | { readonly phase: 'claim'; readonly installation_id: string }
  | {
      readonly phase: 'result';
      readonly installation_id: string;
      readonly device_token: string;
      readonly status: 'executed' | 'failed';
      readonly already_existed: boolean;
      readonly device_ref_hash?: string | undefined;
      readonly error_code?: DeviceErrorCode | undefined;
    };

export type DeviceExecutionResult =
  | {
      readonly phase: 'claim';
      readonly data: {
        approval: ApprovalView;
        device_token: string;
        instructions: ApprovalPayload;
      };
    }
  | { readonly phase: 'result'; readonly data: ApprovalView };

function forbidden(reason: string): AppError {
  return new AppError('FORBIDDEN', { details: { reason } });
}

async function destination(
  deps: ApprovalServiceDeps,
  userId: string,
  row: ApprovalRow,
  headerInstallation: string | null,
  bodyInstallation: string,
): Promise<InstallationInfo> {
  if (headerInstallation === null || headerInstallation !== bodyInstallation.toLowerCase()) {
    throw forbidden('installation_mismatch');
  }
  const installation = await deps.repo.installationByClientId(userId, bodyInstallation);
  if (
    installation === null ||
    row.executor !== 'device' ||
    installation.id !== row.device_installation_id
  ) {
    throw forbidden('installation_mismatch');
  }
  return installation;
}

async function tokenMatches(
  row: ApprovalRow,
  token: string,
  storedHashHex: string | null,
): Promise<boolean> {
  if (storedHashHex === null) return false;
  const provided = await sha256(token);
  return timingSafeEqual(provided, fromHex(storedHashHex)) && row.executor === 'device';
}

const CALENDAR_ACTIONS = new Set(['calendar_create', 'calendar_update']);

export async function deviceExecution(
  deps: ApprovalServiceDeps,
  input: {
    userId: string;
    approvalId: string;
    headerInstallation: string | null;
    body: DeviceExecutionRequest;
  },
): Promise<DeviceExecutionResult> {
  const row = await requireApproval(deps, input.userId, input.approvalId);
  await destination(deps, input.userId, row, input.headerInstallation, input.body.installation_id);

  if (input.body.phase === 'claim') {
    if (row.status !== 'approved' && row.status !== 'executing') throw stateConflict(row);
    const { token, hashHex } = await newDeviceToken();
    const started = await deps.repo.startDeviceExecution(
      row.id,
      input.userId,
      row.device_installation_id ?? '',
      hashHex,
    );
    await deps.audit.append({
      actorType: 'user',
      actorId: input.userId,
      action: 'user.approval.device_claimed',
      targetType: 'approval_action',
      targetId: row.id,
      targetUserId: input.userId,
      result: 'success',
      details: { action_type: row.action_type },
      correlationId: deps.correlationId,
    });
    return {
      phase: 'claim',
      data: {
        approval: toApprovalView(started, { locale: deps.locale }),
        device_token: token,
        instructions: started.payload,
      },
    };
  }

  const body = input.body;
  const storedHash = await deps.repo.deviceTokenHash(input.userId, row.id);
  if (!(await tokenMatches(row, body.device_token, storedHash)))
    throw forbidden('device_token_invalid');
  if (row.status === 'executed' || row.status === 'failed') {
    return { phase: 'result', data: toApprovalView(row, { locale: deps.locale }) };
  }
  if (row.status !== 'executing') throw stateConflict(row);

  const hashHex = toHex(await sha256(body.device_token));
  const finished = await deps.repo.transition(
    body.status === 'executed'
      ? {
          id: row.id,
          to: 'executed',
          actor: 'user',
          actorId: input.userId,
          idempotencyKey: null,
          reason: body.already_existed ? 'device_already_existed' : 'device_executed',
          result: {
            target: 'device',
            already_existed: body.already_existed,
            ...(body.device_ref_hash === undefined
              ? {}
              : { provider_idempotency_ref: body.device_ref_hash }),
          },
          deviceTokenHashHex: hashHex,
        }
      : {
          id: row.id,
          to: 'failed',
          actor: 'user',
          actorId: input.userId,
          idempotencyKey: null,
          reason: 'device_failed',
          result: { target: 'device', retryable: true },
          errorCode: 'DEVICE_WRITE_FAILED',
          errorMessage: body.error_code ?? 'unknown',
          deviceTokenHashHex: hashHex,
        },
  );
  if (CALENDAR_ACTIONS.has(row.action_type)) {
    await deps.enqueue({
      type: 'insight_refresh',
      idempotencyKey: `insight_refresh:${input.userId}:pending`,
      payload: { user_id: input.userId, scope: 'calendar', reason: 'device_write' },
      userId: input.userId,
    });
  }
  await deps.audit.append({
    actorType: 'user',
    actorId: input.userId,
    action: finished.status === 'executed' ? 'user.approval.executed' : 'user.approval.failed',
    targetType: 'approval_action',
    targetId: row.id,
    targetUserId: input.userId,
    result: finished.status === 'executed' ? 'success' : 'failure',
    details: {
      target: 'device',
      action_type: row.action_type,
      ...(body.status === 'failed' ? { failure_code: body.error_code ?? 'unknown' } : {}),
    },
    correlationId: deps.correlationId,
  });
  return { phase: 'result', data: toApprovalView(finished, { locale: deps.locale }) };
}
