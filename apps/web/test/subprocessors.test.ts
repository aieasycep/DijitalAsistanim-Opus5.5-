import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import enWebPages from '../messages/en/webPages.json';
import trWebPages from '../messages/tr/webPages.json';
import { buildSubprocessors, type SubprocessorId } from '../src/content/subprocessors.ts';

/*
 * Completeness of the published sub-processor list (PRIVACY.md "AI providers and sub-processors";
 * SECURITY_AND_PRIVACY_PLAN §4.10): every external service the Edge Functions send user data to has
 * a row. The adapters are read from the source tree, so a new adapter file without a decision here
 * fails the test instead of silently missing from the policy.
 */

const functionsDir = new URL('../../../supabase/functions/_shared/', import.meta.url);

/** Adapter file → the sub-processor row that discloses it, or `null` for internal modules. */
const AI_ADAPTERS: Readonly<Record<string, SubprocessorId | null>> = {
  'anthropic.ts': 'anthropic',
  'openai.ts': 'openai',
  'openai-audio.ts': 'openai',
  'voyage.ts': 'voyage',
  'deepgram.ts': 'deepgram',
  'azure-tts.ts': 'tts',
  'elevenlabs.ts': 'tts',
  'fixture.ts': null,
  'index.ts': null,
  'capabilities.ts': null,
};

const EMAIL_ADAPTERS: Readonly<Record<string, SubprocessorId | null>> = {
  'resend.ts': 'email',
  'postmark.ts': 'email',
  'provider.ts': null,
  'transactional.ts': null,
  'templates.ts': null,
  'types.ts': null,
  'seal.ts': null,
  'deletion-request.ts': null,
};

/** Other data-bearing integrations of the Edge Functions and the apps. */
const OTHER_SERVICES: readonly [string, SubprocessorId][] = [
  ['services/billing/revenuecat.ts', 'revenuecat'],
  ['services/notifications/expo-push.ts', 'expo'],
  ['observability/sentry.ts', 'sentry'],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(new URL(dir, functionsDir)).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );
}

describe('sub-processor list completeness', () => {
  const rows = buildSubprocessors({ turnstileEnabled: true, emailProvider: 'postmark' });
  const ids = new Set(rows.map((row) => row.id));

  it('maps every AI adapter to a listed sub-processor', () => {
    for (const file of sourceFiles('ai/providers/')) {
      expect(Object.keys(AI_ADAPTERS), `decide how ${file} is disclosed`).toContain(file);
      const id = AI_ADAPTERS[file];
      if (id !== null && id !== undefined) expect(ids.has(id), file).toBe(true);
    }
  });

  it('maps every e-mail adapter to the e-mail row', () => {
    for (const file of sourceFiles('email/')) {
      expect(Object.keys(EMAIL_ADAPTERS), `decide how ${file} is disclosed`).toContain(file);
      const id = EMAIL_ADAPTERS[file];
      if (id !== null && id !== undefined) expect(ids.has(id), file).toBe(true);
    }
  });

  it('lists RevenueCat, Expo push and Sentry', () => {
    for (const [file, id] of OTHER_SERVICES) {
      expect(readFileSync(new URL(file, functionsDir), 'utf8').length, file).toBeGreaterThan(0);
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('lists Deepgram, the configurable server speech-to-text fallback, in both languages', () => {
    const deepgram = rows.find((row) => row.id === 'deepgram');
    expect(deepgram?.condition).toBe('sttFallback');
    expect(trWebPages.legal.subprocessors.rows.deepgram.name).toBe('Deepgram');
    expect(enWebPages.legal.subprocessors.rows.deepgram.purpose).toMatch(/speech recognition/);
    expect(trWebPages.legal.subprocessors.conditions.sttFallback).toBeTruthy();
    expect(enWebPages.legal.subprocessors.conditions.sttFallback).toBeTruthy();
  });
});
