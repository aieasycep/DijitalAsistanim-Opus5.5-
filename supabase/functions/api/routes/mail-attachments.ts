/**
 * API-MAIL-09 `GET /mail/:messageId/attachments` (DESIGN_MAPPING DEV-41/DEV-47; SCREEN_AND_FLOW_MAP
 * M-CAP-03, M-MAIL-03): the attachment metadata of a message with signed `attachment_ref`s for
 * `POST /captures`. Metadata only — no content is fetched here; a message synced before metadata
 * was kept is listed from its provider once. `ai_data_access.attachments` and the account's
 * "Ekleri analiz et" toggle must be on (`DATA_SOURCE_DISABLED` otherwise); `Cache-Control: no-store`.
 */
import { MessageIdParams, routes } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validParams,
} from '../../_shared/http/validate.ts';
import { listMessageAttachments } from '../../_shared/services/integrations/attachments.ts';
import type { IntegrationRuntime } from '../../_shared/services/integrations/runtime.ts';
import type { RouteRegistrar } from '../deps.ts';
import { assistOf } from './assist-api.ts';

export function mailAttachmentRoutes(rt: IntegrationRuntime): RouteRegistrar {
  return (app, kit) => {
    const list = routes['GET /mail/:messageId/attachments'];
    mountRoute(
      app,
      list,
      ...kit.chain({ gate: true, rateLimit: 'mail_original' }),
      parseJsonBody(list),
      validateRequest(list),
      async (c) => {
        const auth = currentUser(c);
        const params = validParams(c, MessageIdParams);
        const user = await assistOf(kit).intel.ai.users.load(auth.userId);
        const data = await listMessageAttachments(rt, {
          userId: auth.userId,
          messageId: params.messageId,
          attachmentsAllowed: user.dataAccess.attachments,
          correlationId: c.get('correlationId'),
          log: c.get('log'),
        });
        c.header('Cache-Control', 'no-store');
        return sendData(c, data, 200);
      },
    );
  };
}
