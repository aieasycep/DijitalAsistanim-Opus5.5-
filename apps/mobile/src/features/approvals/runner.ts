/**
 * The approve path of one pending approval (SCREEN_AND_FLOW_MAP Part 2 §0.5, Part 3 §0.4), shared
 * by the inline approval sheet (M-APPR-04 pattern), the reply screen's "Göndermeyi Onayla"
 * (`in_place`), the plan proposal and conflict sheets and the post-meeting "Kaydet":
 * - every approval is a tap (R-03); `approved_via` names the surface;
 * - with `undo`, the tap starts a client-side 5 s delay with "Onaylandı · 1 işlem · Geri al"
 *   (R-06); nothing is sent until it ends, and backgrounding the app cancels it (the approval stays
 *   `pending`);
 * - `POST /approvals/:id/approve {idempotency_key, payload_version, approved_via}` reuses the key
 *   on every retry (a `failed` retry is the same key: `failed → executing`);
 * - a missing write capability (`scope_status` or 424 `PROVIDER_SCOPE_MISSING`) opens the scope
 *   upgrade sheet and resumes with the same key; a stale version (409) refetches the row;
 * - then the `approval_actions` row is polled (R-19): 1 s for 5 s, 2 s to 20 s, 5 s to 60 s, then
 *   "İşlem sürüyor. Bitince bildireceğim." Success is rendered only from `executed`.
 * Approvals are never queued offline (§0.4): the tap is blocked with a toast.
 */
import { hold } from '@da/design-tokens';
import { isApiError, qk } from '@da/api-client';
import { apiMutationOptions, useApiClient } from '@da/api-client/react';
import { approvalFailurePolicy, type ApprovalFailurePolicy } from '@da/domain';
import { useToast } from '@da/ui';
import type { ScopeUpgrade } from '@da/validation/api/common';
import type { ApprovalView } from '@da/validation/api/approvals';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { unwrap } from '../../lib/data/rpc';
import { track } from '../../lib/events';
import { openScopeUpgrade } from '../actions/scope';
import { useOfflineGuard } from '../actions/ui';

export const UNDO_DELAY_MS = hold.undoToast;
export const SLOW_AFTER_MS = 60_000;

export type ApprovalPhase =
  | 'review'
  | 'undo'
  | 'sending'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'rejected'
  | 'expired'
  | 'device';

type Status = ApprovalView['status'];

const TERMINAL: readonly Status[] = ['executed', 'failed', 'rejected', 'expired'];

export function phaseOf(status: Status): ApprovalPhase {
  switch (status) {
    case 'pending':
      return 'review';
    case 'approved':
    case 'executing':
      return 'executing';
    case 'executed':
      return 'executed';
    case 'failed':
      return 'failed';
    case 'rejected':
      return 'rejected';
    case 'expired':
      return 'expired';
  }
}

/** Poll cadence after approve (§0.5 result tracking). */
export function pollInterval(elapsedMs: number): number {
  if (elapsedMs < 5_000) return 1_000;
  if (elapsedMs < 20_000) return 2_000;
  if (elapsedMs < SLOW_AFTER_MS) return 5_000;
  return 15_000;
}

interface StatusRow {
  readonly id: string;
  readonly status: Status;
  readonly last_error_code: string | null;
  readonly payload_version: number;
  readonly idempotency_key: string;
}

async function fetchStatus(id: string): Promise<StatusRow> {
  return unwrap(
    await getSupabase()
      .from('approval_actions')
      .select('id,status,last_error_code,payload_version,idempotency_key')
      .eq('id', id)
      .single(),
  );
}

export type ApprovedVia = 'inline_sheet' | 'in_place' | 'approval_center';

export interface ApprovalRunnerOptions {
  readonly via: ApprovedVia;
  /** R-06 client undo window (inline sheet). */
  readonly undo: boolean;
  /** Queries refreshed after a terminal result. */
  readonly invalidate?: readonly QueryKey[];
  readonly onExecuted?: (view: ApprovalView) => void;
  readonly onRejected?: () => void;
}

export interface ApprovalRunner {
  readonly view: ApprovalView;
  readonly phase: ApprovalPhase;
  readonly slow: boolean;
  readonly failure: ApprovalFailurePolicy | null;
  readonly approve: () => void;
  readonly retry: () => void;
  readonly reject: (reason?: 'user_cancel' | 'user_reject') => void;
  readonly rejecting: boolean;
  /** Replaces the view after an edit (`PATCH /approvals/:id` returns a new version and key). */
  readonly replace: (next: ApprovalView) => void;
}

export function useApprovalRunner(
  initial: ApprovalView,
  options: ApprovalRunnerOptions,
): ApprovalRunner {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useTranslations('approvals');
  const tc = useTranslations('common.actions');
  const blocked = useOfflineGuard();
  const [view, setView] = useState(initial);
  const [phase, setPhase] = useState<ApprovalPhase>(phaseOf(initial.status));
  const [failureCode, setFailureCode] = useState<string | null>(initial.failure?.code ?? null);
  const [slow, setSlow] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const isAlive = (): boolean => alive.current;
  const toastId = useRef<string | null>(null);
  const reported = useRef<Status | null>(null);

  const approveMutation = useMutation(apiMutationOptions(client, 'POST /approvals/:id/approve'));
  const rejectMutation = useMutation(apiMutationOptions(client, 'POST /approvals/:id/reject'));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.approvals.all });
    for (const key of options.invalidate ?? [])
      void queryClient.invalidateQueries({ queryKey: key });
  };

  const settle = (current: ApprovalView, status: Status, code: string | null) => {
    if (reported.current === status) return;
    reported.current = status;
    setSlow(false);
    setView({ ...current, status });
    setPhase(phaseOf(status));
    if (status === 'executed') {
      track('approval_execution_result', { action_type: current.action_type, status: 'executed' });
      track('approval_executed', { type: current.action_type, result: 'executed' });
      refresh();
      options.onExecuted?.({ ...current, status });
    } else if (status === 'failed') {
      setFailureCode(code);
      track('approval_execution_result', {
        action_type: current.action_type,
        status: 'failed',
        ...(code === null ? {} : { error_code: code }),
      });
      track('approval_executed', { type: current.action_type, result: 'failed' });
      refresh();
    }
  };

  /** Polls the row until a terminal status (R-19); never renders success before `executed`. */
  const watch = (current: ApprovalView) => {
    if (pollTimer.current !== null) clearTimeout(pollTimer.current);
    reported.current = null;
    const started = Date.now();
    const tick = async () => {
      if (!alive.current) return;
      let row: StatusRow | null = null;
      try {
        row = await fetchStatus(current.id);
      } catch {
        row = null;
      }
      // The screen may have closed while the request was in flight.
      if (!isAlive()) return;
      if (row !== null && TERMINAL.includes(row.status)) {
        settle(current, row.status, row.last_error_code);
        return;
      }
      const elapsed = Date.now() - started;
      if (elapsed >= SLOW_AFTER_MS) setSlow(true);
      pollTimer.current = setTimeout(() => {
        void tick();
      }, pollInterval(elapsed));
    };
    pollTimer.current = setTimeout(() => {
      void tick();
    }, pollInterval(0));
  };

  useEffect(() => {
    alive.current = true;
    if (initial.status === 'approved' || initial.status === 'executing') watch(initial);
    return () => {
      alive.current = false;
      if (pollTimer.current !== null) clearTimeout(pollTimer.current);
      if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    };
    // Mount only: an approval opened while in flight resumes polling once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Backgrounding during the undo window sends nothing (R-06).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && undoTimer.current !== null) {
        clearTimeout(undoTimer.current);
        undoTimer.current = null;
        if (toastId.current !== null) toast.dismiss(toastId.current);
        setPhase('review');
      }
    });
    return () => {
      subscription.remove();
    };
  }, [toast]);

  const scopeUpgrade = (upgrade: ScopeUpgrade | undefined, resume: () => void): boolean => {
    if (upgrade === undefined) return false;
    openScopeUpgrade({
      accountId: upgrade.account_id,
      provider: upgrade.provider,
      capability:
        upgrade.capability === 'mail_send' ||
        upgrade.capability === 'calendar_write' ||
        upgrade.capability === 'tasks_write'
          ? upgrade.capability
          : 'calendar_write',
      approvalId: view.id,
      onGranted: resume,
    });
    return true;
  };

  const send = (current: ApprovalView) => {
    setPhase('sending');
    track('approval_decided', {
      action_type: current.action_type,
      type: current.action_type,
      decision: 'approved',
      via: options.via,
      origin: current.origin,
    });
    approveMutation.mutate(
      {
        input: {
          params: { id: current.id },
          body: {
            idempotency_key: current.idempotency_key,
            payload_version: current.payload_version,
            approved_via: options.via,
          },
        },
        idempotencyKey: current.idempotency_key,
      },
      {
        onSuccess: (data) => {
          setView(data.approval);
          if (data.execution.mode === 'device') {
            setPhase('device');
            refresh();
            return;
          }
          if (TERMINAL.includes(data.approval.status)) {
            settle(data.approval, data.approval.status, data.approval.failure?.code ?? null);
            return;
          }
          setPhase('executing');
          watch(data.approval);
        },
        onError: (error) => {
          if (isApiError(error) && error.code === 'PROVIDER_SCOPE_MISSING') {
            setPhase('review');
            const upgrade = (error.details as { upgrade?: ScopeUpgrade }).upgrade;
            if (
              scopeUpgrade(upgrade, () => {
                send(current);
              })
            ) {
              return;
            }
          }
          if (
            isApiError(error) &&
            (error.code === 'APPROVAL_STATE_CONFLICT' || error.code === 'STATE_CONFLICT')
          ) {
            setPhase('review');
            toast.show({ message: t('m2.updated') });
            void fetchStatus(current.id).then((row) => {
              setView((v) => ({
                ...v,
                status: row.status,
                payload_version: row.payload_version,
                idempotency_key: row.idempotency_key,
              }));
              setPhase(phaseOf(row.status));
            });
            return;
          }
          if (isApiError(error) && (error.kind === 'offline' || error.kind === 'network')) {
            setPhase('review');
            toast.show({ message: t('m2.networkFailed'), kind: 'error' });
            return;
          }
          setFailureCode(isApiError(error) ? error.code : null);
          setPhase('failed');
        },
      },
    );
  };

  const approve = () => {
    if (phase !== 'review' || blocked('approve')) return;
    if (
      view.scope_status.state === 'upgrade_required' &&
      scopeUpgrade(view.scope_status.upgrade, approve)
    ) {
      return;
    }
    if (!options.undo) {
      send(view);
      return;
    }
    const pending = view;
    setPhase('undo');
    toastId.current = toast.show({
      message: t('undo', { count: 1 }),
      kind: 'success',
      durationMs: UNDO_DELAY_MS,
      action: {
        label: tc('undo'),
        onPress: () => {
          if (undoTimer.current !== null) clearTimeout(undoTimer.current);
          undoTimer.current = null;
          track('approval_undo', { mode: 'single', count: 1 });
          setPhase('review');
        },
      },
    });
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      send(pending);
    }, UNDO_DELAY_MS);
  };

  const retry = () => {
    if (blocked('approve')) return;
    track('approval_retry', { action_type: view.action_type });
    send(view);
  };

  const reject = (reason: 'user_cancel' | 'user_reject' = 'user_cancel') => {
    if (blocked('reject')) return;
    rejectMutation.mutate(
      {
        input: {
          params: { id: view.id },
          body: { reason, learn: reason === 'user_reject' },
        },
      },
      {
        onSuccess: (data) => {
          track('approval_decided', {
            action_type: view.action_type,
            type: view.action_type,
            decision: reason === 'user_reject' ? 'rejected' : 'cancelled',
            via: options.via,
            origin: view.origin,
          });
          setView(data);
          setPhase('rejected');
          refresh();
          options.onRejected?.();
        },
        onError: () => {
          toast.show({ message: t('m2.networkFailed'), kind: 'error' });
        },
      },
    );
  };

  const failure =
    phase === 'failed' ? approvalFailurePolicy(failureCode ?? view.failure?.code ?? null) : null;

  return {
    view,
    phase,
    slow,
    failure,
    approve,
    retry,
    reject,
    rejecting: rejectMutation.isPending,
    replace: (next) => {
      setView(next);
      setPhase(phaseOf(next.status));
    },
  };
}
