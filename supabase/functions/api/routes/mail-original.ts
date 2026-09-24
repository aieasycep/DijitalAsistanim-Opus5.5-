/**
 * API-MAIL-01 `GET /mail/:messageId/original` (T-4.03, T-4.07): the provider body, fetched on demand,
 * sanitised, never stored or logged; `Cache-Control: no-store`.
 */
import { MailOriginalQuery, MessageIdParams, routes } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validParams,
  validQuery,
} from '../../_shared/http/validate.ts';
import { fetchMailOriginal } from '../../_shared/services/integrations/mail-original.ts';
import type { IntegrationRuntime } from '../../_shared/services/integrations/runtime.ts';
import type { RouteRegistrar } from '../deps.ts';

export function mailOriginalRoutes(rt: IntegrationRuntime): RouteRegistrar {
  return (app, kit) => {
    const original = routes['GET /mail/:messageId/original'];
    mountRoute(
      app,
      original,
      ...kit.chain({ gate: true, rateLimit: 'mail_original' }),
      parseJsonBody(original),
      validateRequest(original),
      async (c) => {
        const auth = currentUser(c);
        const params = validParams(c, MessageIdParams);
        const query = validQuery(c, MailOriginalQuery);
        const data = await fetchMailOriginal(rt, {
          userId: auth.userId,
          messageId: params.messageId,
          remoteImages: query.remote_images,
          correlationId: c.get('correlationId'),
          log: c.get('log'),
        });
        c.header('Cache-Control', 'no-store');
        return sendData(c, data, 200);
      },
    );
  };
}
