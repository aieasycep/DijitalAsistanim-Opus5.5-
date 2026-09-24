/**
 * Post-sign-in step of T-8.06 (M-ON-05 pipeline, hook 4): the first sign-in of a new profile
 * records the app language and the accepted terms version (`PATCH profiles {locale,
 * terms_accepted_at, terms_version}`; continuing on the account screen is the acceptance). The
 * language follows the explicit in-app choice, else the device. Best effort: a failure never undoes
 * the sign-in.
 */
import { registerPostSignInHook } from '../../lib/auth/post-sign-in';
import { now } from '../../lib/clock';
import { getUiPrefs } from '../../lib/ui-prefs';
import { updateProfile } from '../../lib/postgrest';
import { deviceLocale } from '../../i18n/I18nProvider';

/** Mirrors the published legal documents' version (`apps/web/src/content/meta.ts` LEGAL_VERSION). */
export const TERMS_VERSION = '1.0';

export const PROFILE_HOOK = 'onboarding.profile_locale_terms';

registerPostSignInHook(PROFILE_HOOK, async (ctx) => {
  if (!ctx.isNewUser) return;
  const language = getUiPrefs().locale ?? deviceLocale();
  await updateProfile(
    {
      locale: language === 'en' ? 'en-US' : 'tr-TR',
      terms_accepted_at: now().toISOString(),
      terms_version: TERMS_VERSION,
    },
    ctx.userId,
  );
});
