'use client';

import { useEffect } from 'react';

import { reportBoundaryError } from '@/components/sentry-browser';
import { ErrorState } from '@/components/states/error-state';

/** Root error boundary (catches failures of nested layouts such as the admin shell). */
export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // Reported with the correlation id shown to the admin (a no-op without a Sentry DSN).
  useEffect(() => {
    void reportBoundaryError(error, 'root');
  }, [error]);
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-4">
      <ErrorState correlationId={error.digest} onRetry={retry} />
    </main>
  );
}
