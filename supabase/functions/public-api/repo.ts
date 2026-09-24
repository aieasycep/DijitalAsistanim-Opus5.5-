/**
 * Supabase-backed `PublicRepo` (migration 20260924002220): every call is a service-role wrapper of a
 * `private.*` function; `public-api` never reads or writes tables directly.
 */
import { toByteaHex } from '../_shared/crypto/encoding.ts';
import type { DbClient } from '../_shared/db/clients.ts';
import { DB_FN, rpc } from '../_shared/db/functions.ts';
import { OTP_POLICY } from './limits.ts';
import type { DeletionStatusRow, PublicRepo } from './deps.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function supabasePublicRepo(system: DbClient): PublicRepo {
  return {
    supportTicket: (input) =>
      rpc(system, DB_FN.publicSupportTicket, {
        p_email: input.email,
        p_name: input.name,
        p_category: input.category,
        p_subject: input.subject,
        p_message: input.message,
      }),
    async inboundNote(input) {
      const result = await rpc<{ stored?: boolean; reason?: string } | null>(
        system,
        DB_FN.supportInboundNote,
        {
          p_message_id: input.messageId,
          p_reference: input.reference,
          p_sender: input.sender,
          p_body: input.body,
          p_digest: toByteaHex(input.digest),
        },
      );
      return {
        stored: result?.stored === true,
        ...(result?.reason === undefined ? {} : { reason: result.reason }),
      };
    },
    async deletionSubject(email) {
      const row = await rpc<{ user_id: string; is_admin: boolean } | null>(
        system,
        DB_FN.publicDeletionSubject,
        {
          p_email: email,
        },
      );
      return row ?? null;
    },
    async otpLockSeconds(subject) {
      const seconds = await rpc<number | null>(system, DB_FN.publicOtpLockSeconds, {
        p_subject: subject,
        p_lock_seconds: OTP_POLICY.lockSeconds,
      });
      return typeof seconds === 'number' ? seconds : 0;
    },
    otpRecordFailure: (subject) =>
      rpc(system, DB_FN.publicOtpRecordFailure, {
        p_subject: subject,
        p_max: OTP_POLICY.maxFailures,
        p_window_seconds: OTP_POLICY.windowSeconds,
        p_lock_seconds: OTP_POLICY.lockSeconds,
      }),
    createDeletionRequest: (input) =>
      rpc(system, DB_FN.createDeletionRequest, {
        p_user: input.userId,
        p_kind: 'account',
        p_origin: 'web_otp',
        p_confirmation: 'email_otp',
        p_status_token_hash: toByteaHex(input.statusTokenHash),
        p_subject_email_hash: toByteaHex(input.subjectEmailHash),
        p_scope: null,
        p_account: null,
        p_source: 'web',
        p_correlation_id:
          input.correlationId !== null && UUID_RE.test(input.correlationId)
            ? input.correlationId
            : null,
      }),
    async subscriptionActive(userId) {
      return (
        (await rpc<boolean>(system, DB_FN.publicSubscriptionActive, { p_user: userId })) === true
      );
    },
    async deletionStatus(requestId) {
      const row = await rpc<DeletionStatusRow | null>(system, DB_FN.publicDeletionStatus, {
        p_request_id: requestId,
      });
      return row ?? null;
    },
    plans: () => rpc(system, DB_FN.publicPlans, {}),
    referralResolve: (code) => rpc(system, DB_FN.publicReferralResolve, { p_code: code }),
    async webAnalyticsIncrement(day, event, dims) {
      await rpc<null>(system, DB_FN.webAnalyticsIncrement, {
        p_day: day,
        p_event: event,
        p_dims: dims,
      });
    },
  };
}
