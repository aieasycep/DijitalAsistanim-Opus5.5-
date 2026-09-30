/**
 * API-MAIL-06 `POST /followups/:threadId/draft` (IMPLEMENTATION_PLAN T-5.12; M§17): a follow-up
 * draft (`kind='follow_up'`, prompt `follow_up`) on the user's last sent message of a thread that
 * waits for the other side. Pro (`follow_up`, route gate), quota `reply_drafts_daily`. Sending
 * still needs API-MAIL-05 and the tap on the approval.
 */
import { FollowupDraftBody, routes } from '@da/validation';
import { currentUser } from '../../_shared/auth/user.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
  validParams,
} from '../../_shared/http/validate.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { AppError } from '../../_shared/errors.ts';
import type { RouteRegistrar } from '../deps.ts';
import { assistOf, replyDraftView } from './assist-api.ts';
import { createFollowUpDraft } from './mail.ts';

export const registerFollowupRoutes: RouteRegistrar = (app, kit) => {
  const idem = { repo: kit.deps.idempotency, now: () => kit.now().getTime() };
  const route = routes['POST /followups/:threadId/draft'];
  mountRoute(
    app,
    route,
    ...kit.chain({ gate: true, rateLimit: 'reply_draft' }),
    parseJsonBody(route),
    validateRequest(route),
    (c) => {
      const auth = currentUser(c);
      const params = validParams(c, route.request.params);
      const body = validBody(c, FollowupDraftBody);
      return withIdempotency(c, idem, {
        status: 201,
        async execute() {
          const out = await createFollowUpDraft(kit, auth, {
            threadId: params.threadId,
            tone: body.tone,
            language: body.language,
            instructions: body.instructions,
            correlationId: c.get('correlationId'),
          });
          return {
            data: replyDraftView(out.row, out.webLink),
            ref: { type: 'reply_draft', id: out.row.id },
          };
        },
        async replay(ref) {
          const { assist } = assistOf(kit);
          const row = await assist.store.replyDraft(auth.userId, ref.id ?? '');
          if (row === null)
            throw new AppError('NOT_FOUND', { details: { resource: 'reply_draft' } });
          const link =
            row.message_id === null
              ? null
              : await assist.store.messageWebLink(auth.userId, row.message_id);
          return replyDraftView(row, link);
        },
      });
    },
  );
};
