'use client';

import { ErrorState } from '@/components/states/error-state';

/** Root error boundary (catches failures of nested layouts such as the admin shell). */
export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-4">
      <ErrorState correlationId={error.digest} onRetry={retry} />
    </main>
  );
}
