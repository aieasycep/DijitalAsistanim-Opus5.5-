/**
 * `SUBPROCESSORS` (SCREEN_AND_FLOW_MAP Part 5 §3.2 `#alt-isleyiciler`; SECURITY_AND_PRIVACY_PLAN
 * §4.10): every service that processes user data on our behalf, with location and the condition
 * under which it is involved. Names, purposes and data categories are translated in
 * `webPages.legal.subprocessors.rows.<id>`; configuration decides a few cells (email provider,
 * Sentry region, whether bot protection is on).
 */

export type SubprocessorLocation =
  | {
      readonly kind: 'key';
      readonly key: 'euFrankfurt' | 'euEdge' | 'us' | 'global' | 'configured';
    }
  | { readonly kind: 'custom'; readonly label: string };

export type SubprocessorCondition =
  'always' | 'fallback' | 'memory' | 'push' | 'gmail' | 'premiumTts' | 'turnstile';

export type SubprocessorId =
  | 'supabase'
  | 'vercel'
  | 'anthropic'
  | 'openai'
  | 'voyage'
  | 'expo'
  | 'pushNetworks'
  | 'revenuecat'
  | 'sentry'
  | 'email'
  | 'pubsub'
  | 'tts'
  | 'turnstile';

export interface Subprocessor {
  readonly id: SubprocessorId;
  readonly location: SubprocessorLocation;
  readonly condition: SubprocessorCondition;
  /** Display name override (the configured email provider). */
  readonly providerName?: string;
}

export interface SubprocessorConfig {
  readonly dataRegionLabel?: string | undefined;
  readonly sentryRegionLabel?: string | undefined;
  readonly emailProvider?: 'resend' | 'postmark' | 'ses' | 'smtp' | undefined;
  readonly turnstileEnabled: boolean;
}

const EMAIL_PROVIDER_NAMES = { resend: 'Resend', postmark: 'Postmark', ses: 'Amazon SES' } as const;

const key = (k: Extract<SubprocessorLocation, { kind: 'key' }>['key']): SubprocessorLocation => ({
  kind: 'key',
  key: k,
});

export function buildSubprocessors(config: SubprocessorConfig): Subprocessor[] {
  const emailName =
    config.emailProvider !== undefined && config.emailProvider !== 'smtp'
      ? EMAIL_PROVIDER_NAMES[config.emailProvider]
      : undefined;
  const rows: Subprocessor[] = [
    {
      id: 'supabase',
      location:
        config.dataRegionLabel === undefined || config.dataRegionLabel === 'eu-central-1'
          ? key('euFrankfurt')
          : { kind: 'custom', label: config.dataRegionLabel },
      condition: 'always',
    },
    { id: 'vercel', location: key('euEdge'), condition: 'always' },
    { id: 'anthropic', location: key('us'), condition: 'always' },
    { id: 'openai', location: key('us'), condition: 'fallback' },
    { id: 'voyage', location: key('us'), condition: 'memory' },
    { id: 'expo', location: key('us'), condition: 'push' },
    { id: 'pushNetworks', location: key('global'), condition: 'push' },
    { id: 'revenuecat', location: key('us'), condition: 'always' },
    {
      id: 'sentry',
      location:
        config.sentryRegionLabel === undefined
          ? key('configured')
          : { kind: 'custom', label: config.sentryRegionLabel },
      condition: 'always',
    },
    {
      id: 'email',
      location: key('configured'),
      condition: 'always',
      ...(emailName === undefined ? {} : { providerName: emailName }),
    },
    { id: 'pubsub', location: key('global'), condition: 'gmail' },
    { id: 'tts', location: key('configured'), condition: 'premiumTts' },
  ];
  if (config.turnstileEnabled) {
    rows.push({ id: 'turnstile', location: key('global'), condition: 'turnstile' });
  }
  return rows;
}

/** The AI sub-processors named in the policy's AI section (Anthropic, OpenAI fallback, Voyage). */
export const AI_SUBPROCESSOR_IDS = ['anthropic', 'openai', 'voyage'] as const;
