'use server';

import { MAX_ADMIN_MFA_FACTORS } from '@da/validation/admin/session';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { sessionRedirect } from '@/lib/error-copy';
import { uuidv7 } from '@/lib/ids';
import { currentOriginCheck, failure, toActionFailure, type ActionResult } from '@/server/action';
import { adminApi } from '@/server/admin-api';
import { serverSupabase } from '@/server/supabase';

/*
 * "Yedek cihaz ekle" (BACKOFFICE_PLAN §3.3): a second TOTP factor, at most two. The factor is
 * enrolled and verified with the admin's own Auth session (an abandoned unverified factor is
 * removed first), then `POST /me/mfa-factors` confirms it server-side and writes the audit row
 * `admin.mfa_factor_added`. Removal is the module mutation `DELETE /me/mfa-factors/:factorId`
 * (step-up, at least one factor stays).
 */

export interface BackupEnrolment {
  readonly factorId: string;
  readonly qrCode: string;
  readonly secret: string;
}

export async function startBackupFactorAction(): Promise<ActionResult<BackupEnrolment>> {
  const origin = await currentOriginCheck();
  if (!origin.ok) return failure('CSRF_ORIGIN', 'errors.csrf', 403);
  const supabase = await serverSupabase();
  const listed = await supabase.auth.mfa.listFactors();
  if (listed.error !== null) return failure('SERVICE_UNAVAILABLE', 'errors.upstream', 503);
  if (listed.data.totp.length >= MAX_ADMIN_MFA_FACTORS) {
    return failure('STATE_CONFLICT', 'settings.security.backup.max', 409);
  }
  for (const stale of listed.data.all) {
    if (stale.factor_type === 'totp' && stale.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
  }
  const enrolled = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Yedek ${uuidv7().slice(-6)}`,
  });
  if (enrolled.error !== null) return failure('SERVICE_UNAVAILABLE', 'errors.upstream', 503);
  return {
    ok: true,
    data: {
      factorId: enrolled.data.id,
      qrCode: enrolled.data.totp.qr_code,
      secret: enrolled.data.totp.secret,
    },
  };
}

const ConfirmInput = z.strictObject({
  factorId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export async function confirmBackupFactorAction(
  input: z.infer<typeof ConfirmInput>,
): Promise<ActionResult<{ verified_factors: number }>> {
  const origin = await currentOriginCheck();
  if (!origin.ok) return failure('CSRF_ORIGIN', 'errors.csrf', 403);
  const parsed = ConfirmInput.safeParse(input);
  if (!parsed.success)
    return failure('VALIDATION_FAILED', 'settings.security.backup.codeFormat', 422);
  const supabase = await serverSupabase();
  const verified = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (verified.error !== null) {
    return failure('MFA_INVALID', 'settings.security.backup.codeInvalid', 422);
  }
  const confirmed = await adminApi(
    'POST /me/mfa-factors',
    { body: { factor_id: parsed.data.factorId } },
    { token: verified.data.access_token, idempotencyKey: uuidv7() },
  );
  if (!confirmed.ok) {
    const to = sessionRedirect(confirmed.error);
    if (to !== null) redirect(to);
    return { ok: false, error: toActionFailure(confirmed.error) };
  }
  revalidatePath('/settings');
  return { ok: true, data: { verified_factors: confirmed.data.verified_factors } };
}
