/**
 * The shell state every guard reads: session status, the bootstrap query, connectivity and the
 * screen registry, combined into the entry context of `router-guards.ts`. The latest guard flags
 * are mirrored into a snapshot for `+native-intent` (which runs outside React).
 */
import { useEffect, useMemo } from 'react';

import { useAppBootstrap } from '../../lib/bootstrap';
import { isScreenAvailable } from '../../lib/deeplinks';
import { useOnline } from '../../lib/query/online-manager';
import {
  guardFlags,
  resolveEntryTarget,
  setGuardSnapshot,
  type EntryContext,
  type EntryTarget,
  type GuardFlags,
} from '../../lib/router-guards';
import { useAuth } from '../../providers/AuthProvider';

export interface ShellState {
  readonly context: EntryContext;
  readonly target: EntryTarget;
  readonly flags: GuardFlags;
  readonly refetchBootstrap: () => void;
  readonly bootstrapFetching: boolean;
}

export function useShell(): ShellState {
  const auth = useAuth();
  const online = useOnline();
  const bootstrap = useAppBootstrap(auth.status === 'signed_in');
  const context = useMemo<EntryContext>(
    () => ({
      auth: auth.status,
      hasSignedInBefore: auth.hasSignedInBefore,
      bootstrap: { status: bootstrap.status, data: bootstrap.data },
      online,
      isScreenAvailable: (path: string) => isScreenAvailable(path),
    }),
    [auth.status, auth.hasSignedInBefore, bootstrap.status, bootstrap.data, online],
  );
  const target = useMemo(() => resolveEntryTarget(context), [context]);
  const flags = useMemo(() => guardFlags(context), [context]);
  useEffect(() => {
    setGuardSnapshot({ auth: auth.status, ...flags });
  }, [auth.status, flags]);
  return {
    context,
    target,
    flags,
    refetchBootstrap: bootstrap.refetch,
    bootstrapFetching: bootstrap.isFetching,
  };
}
