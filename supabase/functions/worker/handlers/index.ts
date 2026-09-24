/**
 * Job handler registry of the `worker` function (IMPLEMENTATION_PLAN T-3.06). Each later task adds
 * its `defineJob(...)` definitions here; job types without a handler are never claimed.
 */
import { createRegistry, type JobRegistry } from '../../_shared/jobs/registry.ts';
import type { JobDefinition } from '../../_shared/jobs/types.ts';
import type { TokenKeyring } from '../../_shared/crypto/token-cipher.ts';
import {
  credentialReencryptJob,
  type CredentialsRepo,
} from '../../_shared/services/credentials.ts';

export interface HandlerDeps {
  readonly credentials: CredentialsRepo;
  readonly keyring: () => Promise<TokenKeyring>;
}

export function jobDefinitions(deps: HandlerDeps): JobDefinition<never>[] {
  return [
    credentialReencryptJob({
      repo: deps.credentials,
      keyring: deps.keyring,
    }) as unknown as JobDefinition<never>,
  ];
}

export function createHandlerRegistry(deps: HandlerDeps): JobRegistry {
  return createRegistry(jobDefinitions(deps));
}
