import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { safeNextPath } from '@/server/request-meta';
import { serverSupabase } from '@/server/supabase';
import { MfaFlow, type MfaFlowProps } from './mfa-forms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.auth');
  return { title: t('mfaTitle') };
}

async function flowProps(next: string, recovered: boolean): Promise<MfaFlowProps> {
  const supabase = await serverSupabase();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (claimsData === null) redirect('/login');

  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error !== null) return { mode: 'unavailable', next };
  const verified = factors.data.totp[0];
  if (verified !== undefined) {
    return claimsData.claims.aal === 'aal2'
      ? { mode: 'complete', next }
      : { mode: 'challenge', factorId: verified.id, next };
  }
  for (const stale of factors.data.all) {
    if (stale.factor_type === 'totp' && stale.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
  }
  const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Birincil' });
  if (enrolled.error !== null) return { mode: 'unavailable', next };
  return {
    mode: 'enroll',
    factorId: enrolled.data.id,
    qrCode: enrolled.data.totp.qr_code,
    secret: enrolled.data.totp.secret,
    next,
    recovered,
  };
}

/**
 * `/mfa` (BACKOFFICE_PLAN §3.3): TOTP is mandatory. Without a verified factor the admin enrols
 * ("İki adımlı doğrulamayı kur": QR + manual key; an abandoned unverified factor is removed first);
 * otherwise they are challenged, with the recovery-code path behind "Kimlik doğrulayıcıma
 * erişemiyorum". Success yields aal2, `POST /session/start` and, when needed, recovery codes. The
 * flow is one client component so its state (e.g. the one-time recovery codes) survives the
 * re-render that follows the session change.
 */
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null);
  return <MfaFlow {...await flowProps(next, params.recovered === '1')} />;
}
