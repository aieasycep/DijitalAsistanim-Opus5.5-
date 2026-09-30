'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useEffectEvent, useRef, useState, useTransition } from 'react';

import { endSessionAction, heartbeatAction, logoutAction } from '@/actions/session';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCountdown } from '@/lib/format';

/*
 * SessionWatcher (BACKOFFICE_PLAN §3.7, ADR-06):
 * - mirrors the server's idle (30 min) and absolute (12 h) deadlines. They arrive as durations
 *   measured against admin-api's `server_time`, so a skewed client clock cannot end a session early
 *   or keep it alive late;
 * - admin input (pointer, keys, returning to the tab) sends a throttled `POST /session/heartbeat`;
 * - at T−2 min shows "Oturumun kapanmak üzere" with [Oturumu sürdür] and [Çıkış yap];
 * - at the deadline signs out on this device → `/login?reason=idle` or `expired`;
 * - a background probe (`x-da-activity: background`, never extends the session) re-syncs the
 *   deadlines and notices a revoked session → `/login?reason=revoked`.
 */

export const WARNING_BEFORE_MS = 2 * 60_000;
export const HEARTBEAT_THROTTLE_MS = 60_000;
export const PROBE_INTERVAL_MS = 60_000;

type EndReason = 'idle' | 'expired' | 'revoked';

export function SessionWatcher({
  idleRemainingMs,
  absoluteRemainingMs,
}: {
  idleRemainingMs: number;
  absoluteRemainingMs: number;
}) {
  const t = useTranslations('backoffice.session');
  const router = useRouter();
  const [deadlines, setDeadlines] = useState(() => {
    const now = Date.now();
    return { idle: now + idleRemainingMs, absolute: now + absoluteRemainingMs };
  });
  const [now, setNow] = useState(() => Date.now());
  const [absoluteDismissed, setAbsoluteDismissed] = useState(false);
  const [ending, setEnding] = useState<EndReason | null>(null);
  const [pending, startTransition] = useTransition();
  const lastBeat = useRef(0);

  const deadline = Math.min(deadlines.idle, deadlines.absolute);
  const kind: 'idle' | 'absolute' = deadlines.absolute <= deadlines.idle ? 'absolute' : 'idle';
  const remaining = deadline - now;
  const expired = remaining <= 0;
  const warning =
    !expired &&
    ending === null &&
    remaining <= WARNING_BEFORE_MS &&
    !(kind === 'absolute' && absoluteDismissed);

  function syncIdle(remainingIdleMs: number) {
    setDeadlines((current) => ({ ...current, idle: Date.now() + remainingIdleMs }));
  }

  // One-second clock (Playwright's fake clock drives it in the idle-expiry test).
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // Deadline passed (or the probe saw a revoked session): sign out here, land on /login?reason=….
  const reason: EndReason | null =
    ending ?? (expired ? (kind === 'absolute' ? 'expired' : 'idle') : null);
  const ended = useRef(false);
  useEffect(() => {
    if (reason === null || ended.current) return;
    ended.current = true;
    void endSessionAction(reason);
  }, [reason]);

  // Admin input extends the idle window, at most once a minute (the page load itself counted).
  const onHeartbeat = useEffectEvent((result: Awaited<ReturnType<typeof heartbeatAction>>) => {
    if (result.ok) syncIdle(result.idleRemainingMs);
    else if (result.redirectTo !== null) router.replace(result.redirectTo);
  });
  useEffect(() => {
    lastBeat.current = Date.now();
    function onActivity() {
      if (document.visibilityState !== 'visible') return;
      const at = Date.now();
      if (at - lastBeat.current < HEARTBEAT_THROTTLE_MS) return;
      lastBeat.current = at;
      void heartbeatAction().then(onHeartbeat);
    }
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    document.addEventListener('visibilitychange', onActivity);
    return () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      document.removeEventListener('visibilitychange', onActivity);
    };
  }, []);

  // Background probe: re-syncs deadlines (activity in other tabs) and detects revocation.
  useEffect(() => {
    const timer = setInterval(() => {
      fetch('/api/admin/me', { cache: 'no-store', headers: { accept: 'application/json' } })
        .then(async (response) => {
          const body = (await response.json()) as {
            session?: { idle_remaining_ms: number; absolute_remaining_ms: number };
            error?: { code?: string; reason?: string };
          };
          if (response.ok && body.session !== undefined) {
            const at = Date.now();
            setDeadlines({
              idle: at + body.session.idle_remaining_ms,
              absolute: at + body.session.absolute_remaining_ms,
            });
          } else if (response.status === 401) {
            const why = body.error?.reason;
            setEnding(why === 'idle' || why === 'expired' ? why : 'revoked');
          }
        })
        .catch((error: unknown) => error);
    }, PROBE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  function stayActive() {
    startTransition(async () => {
      const result = await heartbeatAction();
      lastBeat.current = Date.now();
      if (result.ok) syncIdle(result.idleRemainingMs);
      else if (result.redirectTo !== null) router.replace(result.redirectTo);
    });
  }

  return (
    <Dialog
      open={warning}
      onOpenChange={(open) => {
        if (open) return;
        if (kind === 'absolute') setAbsoluteDismissed(true);
        else stayActive();
      }}
    >
      {warning ? (
        <DialogContent>
          <DialogTitle>{t('warningTitle')}</DialogTitle>
          <DialogDescription>
            {kind === 'absolute' ? t('absoluteText') : t('warningText')}
          </DialogDescription>
          <p className="text-bo-body text-ink tabular-nums" role="timer" aria-live="off">
            {t('remaining', { time: formatCountdown(remaining / 1000) })}
          </p>
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  await logoutAction();
                });
              }}
            >
              {t('signOut')}
            </Button>
            {kind === 'idle' ? (
              <Button disabled={pending} onClick={stayActive}>
                {t('continue')}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
