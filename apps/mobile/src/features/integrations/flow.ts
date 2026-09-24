/**
 * The connect actions behind every "Bağla" / "Yeniden Bağlan" / "İzin Ver" control: cloud
 * providers go through `/start` (or `/upgrade` when the same provider's account exists and only a
 * read capability is missing), device calendars through the OS permission, the calendar picker and
 * a snapshot upload. The outcome is presented (toasts, gates) and returned for the caller's state.
 */
import type { Provider } from '@da/domain/enums';

import { track } from '../../lib/events';
import { isOffline } from '../../lib/query/online-manager';
import { sheets } from '../../providers/SheetHost';
import { showToast } from '../../providers/ToastHost';
import { translator } from '../../i18n/translate';
import type { AccountRow } from './accounts';
import { startConnect, startUpgrade, type ConnectOutcome } from './connect';
import { requestDevicePermission, type DevicePermission } from './device-calendar';
import type { OAuthProvider, ReadCapability, ReturnTo } from './pending';
import { presentConnectOutcome } from './present';
import { CALENDAR_DENIED_SHEET } from './sheets/CalendarDeniedSheet';
import { CALENDAR_PICKER_SHEET } from './sheets/CalendarPickerSheet';

export interface CloudConnect {
  readonly provider: OAuthProvider;
  readonly capability: ReadCapability;
  readonly returnTo: ReturnTo;
  /** Existing accounts; a same-provider account missing `capability` is upgraded instead. */
  readonly accounts?: readonly AccountRow[];
  /** Reconnect (re-consent) of this account. */
  readonly reconnect?: AccountRow;
}

function blockedOffline(): boolean {
  if (!isOffline()) return false;
  showToast({ message: translator()('states.offline.blockedToast'), kind: 'offline' });
  return true;
}

/** Runs the OAuth flow and presents its outcome. */
export async function connectCloud(request: CloudConnect): Promise<ConnectOutcome | null> {
  if (blockedOffline()) return null;
  const upgradeTarget =
    request.reconnect === undefined
      ? request.accounts?.find(
          (a) =>
            a.provider === request.provider &&
            !a.capabilities_granted.includes(request.capability) &&
            a.status !== 'needs_reauth',
        )
      : undefined;
  let outcome: ConnectOutcome;
  if (upgradeTarget !== undefined) {
    outcome = await startUpgrade({
      accountId: upgradeTarget.id,
      provider: request.provider,
      capability: request.capability,
      returnTo: request.returnTo,
    });
  } else {
    if (request.reconnect !== undefined) {
      track('account_reconnect_started', { provider: request.reconnect.provider });
    }
    outcome = await startConnect({
      provider: request.provider,
      capabilities: [request.capability],
      returnTo: request.returnTo,
      ...(request.reconnect === undefined
        ? {}
        : {
            accountId: request.reconnect.id,
            ...(request.reconnect.account_email === null
              ? {}
              : { loginHint: request.reconnect.account_email }),
          }),
    });
  }
  presentConnectOutcome(outcome, {
    provider: request.provider,
    capability: request.capability,
    returnTo: request.returnTo,
  });
  return outcome;
}

/** Device calendar: OS permission → calendar picker (which uploads the snapshot). */
export async function connectDeviceCalendar(): Promise<DevicePermission> {
  const status = await requestDevicePermission();
  track('calendar_os_permission_result', {
    status: status === 'granted' ? 'granted' : status === 'blocked' ? 'blocked' : 'denied',
  });
  if (status === 'granted') {
    sheets.open(CALENDAR_PICKER_SHEET, { kind: 'device' });
  } else {
    sheets.open(CALENDAR_DENIED_SHEET, { blocked: status === 'blocked' });
  }
  return status;
}

/** The read capability a provider row connects. */
export function capabilityProvider(provider: Provider): OAuthProvider | null {
  return provider === 'google' || provider === 'microsoft' || provider === 'demo' ? provider : null;
}
