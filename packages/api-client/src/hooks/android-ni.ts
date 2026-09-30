/**
 * Android Notification Intelligence (T-8.26): API-ANI-01 `POST /android-notifications/signals`,
 * the batch upload of on-device-extracted structured signals (Pro, Android only; `[IK]`). The
 * caller derives the idempotency key from the batch so a retried batch reuses it; the server also
 * dedupes by `signal_hash`. Business errors (402 `ENTITLEMENT_REQUIRED`, `FEATURE_DISABLED`,
 * `VALIDATION_FAILED`) are final; the uploader keeps the batch on the device and retries later.
 */
import { mutationOptions } from '@tanstack/react-query';

import type { ApiClient, ApiInput } from '../api.ts';
import { mk } from '../query-keys.ts';

export type AniSignalsUploadBody = NonNullable<
  ApiInput<'POST /android-notifications/signals'>['body']
>;

export interface AniSignalsUploadVariables {
  readonly body: AniSignalsUploadBody;
  readonly idempotencyKey?: string;
}

export function aniSignalsUploadMutationOptions(client: ApiClient) {
  return mutationOptions({
    mutationKey: mk.ani.uploadSignals,
    mutationFn: async ({ body, idempotencyKey }: AniSignalsUploadVariables) =>
      (
        await client.call(
          'POST /android-notifications/signals',
          { body },
          idempotencyKey === undefined ? {} : { idempotencyKey },
        )
      ).data,
    retry: false,
  });
}
