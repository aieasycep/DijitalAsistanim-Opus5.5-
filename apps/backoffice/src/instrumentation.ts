import type { Instrumentation } from 'next';

import { reportRequestError, startServerSentry } from '@/server/sentry-server';

/*
 * Server instrumentation (BACKOFFICE_PLAN §2.2 `instrumentation.ts`): Sentry starts only when a DSN
 * is configured (`server/sentry-server.ts`); `onRequestError` reports server-component, route and
 * action errors through the scrubber, a no-op without a DSN.
 */

export async function register(): Promise<void> {
  await startServerSentry();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  await reportRequestError(error, request, context);
};
