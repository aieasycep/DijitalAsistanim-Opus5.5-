/**
 * The production `MailBodySource` (T-5.01…T-5.12 integration gap): a transient provider fetch of
 * one message body through the integration runtime — the provider registry resolves the account's
 * adapter (`MailProvider.getMessageBody`), `providerContextFor` supplies the single-flight token
 * source (`_shared/providers/token-source.ts`) and the account's provider quota. The body is
 * returned to the caller only: never stored, never logged. Accounts that are disconnected, need
 * re-authentication or have `mail_read` off yield `null` (the pipeline degrades to metadata).
 */
import type { Provider, TransientMailBody } from '@da/domain';
import type { Logger } from '../../logging/logger.ts';
import { isServerProvider, providerContextFor } from '../integrations/context.ts';
import type { IntegrationRuntime } from '../integrations/runtime.ts';
import { togglesOf } from '../integrations/status.ts';
import type { MailBodySource } from './store.ts';

const READABLE_STATUSES: ReadonlySet<string> = new Set(['healthy', 'syncing', 'partial']);

export function integrationMailBodySource(rt: IntegrationRuntime, log: Logger): MailBodySource {
  return {
    async fetch(input): Promise<TransientMailBody | null> {
      if (!isServerProvider(input.provider as Provider)) return null;
      const account = await rt.store.getAccount(input.accountId);
      if (account === null || account.user_id !== input.userId) return null;
      if (!READABLE_STATUSES.has(account.status) || !togglesOf(account).mail_read) return null;
      const adapters = rt.providers.resolve(account.provider as 'google' | 'microsoft' | 'demo');
      if (adapters.mail === undefined) return null;
      const ctx = await providerContextFor(rt, account, {
        owner: `mail_body:${input.correlationId}`,
        correlationId: input.correlationId,
        log,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      return await adapters.mail.getMessageBody(ctx, input.providerMessageId, {
        maxBytes: input.maxBytes,
      });
    },
  };
}
