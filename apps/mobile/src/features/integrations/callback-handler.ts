/**
 * Registers the `POST /integrations/oauth/complete` step with the callback route (M-SET-14): a
 * redirect that reached `app/integrations/callback` (cold start, lost auth session, Android intent)
 * is completed with this device's nonce, presented like an in-app completion, and continued on the
 * screen the flow started from (the onboarding step, the account detail, Today, or a resumed
 * approval). Without a pending entry on this device nothing is sent and the route shows its error.
 */
import type { Capability } from '@da/domain/enums';

import {
  registerOAuthCompletionHandler,
  type OAuthCompletionResult,
} from './IntegrationCallbackScreen';
import { handleOAuthCallback, lastCompletedFlow, returnRouteOf } from './connect';
import type { ReadCapability } from './pending';
import { presentConnectOutcome } from './present';

function readCapabilityOf(capabilities: readonly string[]): ReadCapability {
  const first = capabilities.find(
    (c): c is ReadCapability => c === 'mail_read' || c === 'calendar_read' || c === 'tasks_read',
  );
  return first ?? ('mail_read' satisfies Capability);
}

registerOAuthCompletionHandler(async (callback): Promise<OAuthCompletionResult> => {
  const outcome = await handleOAuthCallback(callback);
  const pending = lastCompletedFlow();
  if (outcome.kind !== 'completed' && outcome.kind !== 'already_granted') return { failed: true };
  presentConnectOutcome(outcome, {
    provider: callback.provider,
    capability: readCapabilityOf(pending?.capabilities ?? []),
    returnTo: pending?.return_to ?? 'settings_accounts',
  });
  return { href: returnRouteOf(outcome, pending) };
});
