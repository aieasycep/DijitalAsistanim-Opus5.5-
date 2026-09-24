'use client';

import { useMessage } from '@/components/admin-provider';
import { Icon } from '@/components/icon';
import type { AuthFormState } from '@/actions/auth';

/** Renders an auth action's error or notice (`role=alert` / `role=status`), linked by id. */
export function FormStatus({ state, id }: { state: AuthFormState; id: string }) {
  const message = useMessage();
  if (state.status === 'error') {
    return (
      <p
        id={id}
        role="alert"
        className="flex items-start gap-2 rounded-tile bg-tone-critical-soft p-3 text-bo-body text-tone-critical-text"
      >
        <Icon name="error" size={16} className="mt-0.5" />
        <span>{message(state.messageKey, state.values)}</span>
      </p>
    );
  }
  if (state.status === 'notice') {
    return (
      <p
        id={id}
        role="status"
        className="rounded-tile bg-tone-info-soft p-3 text-bo-body text-tone-info-text"
      >
        {message(state.messageKey, state.values)}
      </p>
    );
  }
  return null;
}

export const INITIAL_AUTH_STATE: AuthFormState = { status: 'idle' };
