'use client';

import { useEffect } from 'react';

import { reportBoundaryError } from '@/components/sentry-browser';
import { ErrorState } from '@/components/states/error-state';

/** Segment error boundary: the standard error state with [Tekrar dene] (BACKOFFICE_PLAN §5.3). */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // Reported with the correlation id shown to the admin (a no-op without a Sentry DSN).
  useEffect(() => {
    void reportBoundaryError(error, 'admin');
  }, [error]);
  return <ErrorState correlationId={error.digest} onRetry={retry} />;
}
