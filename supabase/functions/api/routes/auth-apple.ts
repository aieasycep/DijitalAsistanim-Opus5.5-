/** API-DEV-03 `POST /auth/apple/exchange` [IK]: store the encrypted SIWA refresh token. */
import { AppleExchangeBody, routes } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
} from '../../_shared/http/validate.ts';
import { exchangeAppleCode } from '../../_shared/services/apple.ts';
import type { RouteRegistrar } from '../deps.ts';

export const registerAppleRoutes: RouteRegistrar = (app, kit) => {
  const route = routes['POST /auth/apple/exchange'];
  mountRoute(
    app,
    route,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    parseJsonBody(route),
    validateRequest(route),
    (c) => {
      const auth = currentUser(c);
      const body = validBody(c, AppleExchangeBody);
      return withIdempotency(
        c,
        { repo: kit.deps.idempotency, now: () => kit.now().getTime() },
        {
          status: route.status,
          async execute() {
            const data = await exchangeAppleCode(
              {
                env: kit.deps.raw,
                credentials: kit.deps.credentials,
                keyring: kit.deps.keyring,
                appleSub: kit.deps.appleSub,
                audit: kit.deps.audit,
                correlationId: c.get('correlationId'),
                now: kit.now,
                ...(kit.deps.fetch === undefined ? {} : { fetch: kit.deps.fetch }),
              },
              auth.userId,
              body,
            );
            return { data, ref: { type: 'oauth_credential', ack: { stored: data.stored } } };
          },
          replay: (ref) => Promise.resolve({ stored: ref.ack?.stored === true }),
        },
      );
    },
  );
};
