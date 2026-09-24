'use client';

import { ErrorState } from '@/components/states/error-state';

/** Segment error boundary: the standard error state with [Tekrar dene] (BACKOFFICE_PLAN §5.3). */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorState correlationId={error.digest} onRetry={retry} />;
}
