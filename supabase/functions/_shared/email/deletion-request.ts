/**
 * `deletion_request` recipients of JOB-31 (API_CONTRACTS JOB-23 step 9, JOB-31 step 1): the address
 * is the sealed `data_deletion_requests.notify_email_ciphertext` the account deletion job stored
 * before the auth user was deleted. It is opened only here, at send time, and wiped once the
 * confirmation was sent (`steps.confirmation_email = 'sent'`).
 */
import type { TokenKeyring } from '../crypto/token-cipher.ts';
import { openNotifyEmail } from '../services/privacy/notify-email.ts';
import type { PrivacyRepo } from '../services/privacy/repo.ts';
import type { RecipientResolver } from './transactional.ts';

export interface DeletionRecipientDeps {
  readonly repo: Pick<PrivacyRepo, 'getDeletionRequest' | 'updateDeletionRequest'>;
  readonly keyring: () => Promise<TokenKeyring>;
}

export function deletionRequestRecipient(deps: DeletionRecipientDeps): {
  resolve: RecipientResolver;
  onSent: (id: string) => Promise<void>;
} {
  return {
    async resolve(id) {
      const row = await deps.repo.getDeletionRequest(id);
      if (row === null || row.kind !== 'account' || row.notify_email_ciphertext === null)
        return null;
      return await openNotifyEmail(await deps.keyring(), row.id, row.notify_email_ciphertext);
    },
    async onSent(id) {
      await deps.repo.updateDeletionRequest(id, {
        clearNotify: true,
        steps: { confirmation_email: 'sent' },
      });
    },
  };
}
