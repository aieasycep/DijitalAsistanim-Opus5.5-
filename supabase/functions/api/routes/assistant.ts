/**
 * Assistant and voice routes (IMPLEMENTATION_PLAN T-5.11; API_CONTRACTS API-AST-01 `POST
 * /assistant/threads`, API-AST-02 `POST /assistant/threads/:id/messages` (SSE), API-AST-03 `POST
 * /assistant/transcribe`; M§24, M§25, M§83, M§114).
 *
 * A message is answered by the T0 grammar and SQL templates, by T1 intent labelling, or by grounded
 * QA over retrieved derived data (`search_result` blocks, sentence-gated citations). The model has
 * no tools (R-04): write intents detected by code become pending approvals built through the
 * API-APR-01 path (`email_send` through the reply-draft service) and stream as `action_proposal`
 * cards; approving is always a tap (R-03). Message content is never logged.
 */
import {
  AssistantMessageBody,
  AssistantThreadBody,
  routes,
  TRANSCRIBE_AUDIO_MIME_VALUES,
  TRANSCRIBE_LIMITS,
  TranscribeForm,
} from '@da/validation';
import type { ApprovalView, AssistantAnswerV1, AssistantRichCardV1 } from '@da/validation';
import { parseDatesTR, routes as links } from '@da/domain';
import { currentUser } from '../../_shared/auth/user.ts';
import { AppError, isAppError, normalizeError, toErrorBody } from '../../_shared/errors.ts';
import type { AppContext, UserAuth } from '../../_shared/http/context.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  validateRequest,
  validBody,
  validParams,
} from '../../_shared/http/validate.ts';
import { interactiveAiError } from '../../_shared/services/assist/common.ts';
import type { AssistantMessageRow, ContactMatch } from '../../_shared/services/assist/store.ts';
import type { AiUser } from '../../_shared/services/ai/runtime.ts';
import { proposeApproval } from '../../_shared/services/approvals/propose.ts';
import { answerGrounded, planQa, type QaResult } from '../../_shared/services/assistant/answer.ts';
import {
  detectIntent,
  type DetectedIntent,
  isWriteIntent,
} from '../../_shared/services/assistant/intents.ts';
import {
  type Citation,
  personChoiceCard,
  resolvePerson,
  retrievalDocs,
  templateAnswer,
} from '../../_shared/services/assistant/tools.ts';
import { clip, copy, formatDay, message } from '../../_shared/services/copy.ts';
import { isOn } from '../../_shared/services/flags.ts';
import { embedTexts } from '../../_shared/services/memory/embed.ts';
import { runSearch } from '../../_shared/services/memory/search.ts';
import { transcribeAudio } from '../../_shared/services/voice/speech.ts';
import type { RequestRepos, RouteKit, RouteRegistrar } from '../deps.ts';
import { serviceDeps } from './approvals.ts';
import { assistOf, requireQuota } from './assist-api.ts';
import { createFollowUpDraft, createReplyDraft, submitDraft } from './mail.ts';

const PING_MS = 15_000;
const STREAM_BUDGET_MS = 120_000;
const FREE_RETRIEVAL_DAYS = 7;
const STREAM_STALE_MS = 3 * 60_000;
const UNCAPPED_REMAINING = 999;

type Send = (event: string, data: unknown) => Promise<void>;

/** A `text/event-stream` response; the upstream is aborted when the client disconnects. */
function sseResponse(
  signal: AbortSignal,
  run: (send: Send, abort: AbortSignal) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  const stop = () => upstream.abort();
  signal.addEventListener('abort', stop, { once: true });
  const budget = setTimeout(stop, STREAM_BUDGET_MS);
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const ping = setInterval(() => write(': ping\n\n'), PING_MS);
      const send: Send = (event, data) => {
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return Promise.resolve();
      };
      run(send, upstream.signal).finally(() => {
        clearInterval(ping);
        clearTimeout(budget);
        signal.removeEventListener('abort', stop);
        if (!closed) {
          closed = true;
          controller.close();
        }
      });
    },
    cancel() {
      closed = true;
      upstream.abort();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

const SPOKEN_HOURS: Readonly<Record<string, number>> = {
  bir: 1,
  iki: 2,
  üç: 3,
  dört: 4,
  beş: 5,
  altı: 6,
  yedi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
  'on bir': 11,
  'on iki': 12,
};

/** Start of the named time: a parsed date-time, or a day plus a spoken hour ("saat onda"). */
export function requestedTime(
  text: string,
  now: Date,
  timeZone: string,
): { start: Date; end: Date | null } | null {
  const dates = parseDatesTR(text, { anchor: now, timeZone }).filter((d) => !d.past);
  const timed = dates.find((d) => d.precision === 'datetime');
  if (timed !== undefined) {
    return { start: timed.start, end: timed.endLocalTime === null ? null : timed.end };
  }
  const day = dates.find((d) => d.precision === 'day');
  const spoken =
    /saat\s+(on iki|on bir|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)(?:[’']?(?:de|da|te|ta))?(?!\p{L})/iu.exec(
      text.toLocaleLowerCase('tr-TR'),
    );
  if (day === undefined || spoken === null) return null;
  let hour = SPOKEN_HOURS[spoken[1] ?? ''] ?? 9;
  if (hour < 8 || /öğleden sonra|akşam/iu.test(text)) hour = hour < 12 ? hour + 12 : hour;
  return { start: new Date(day.start.getTime() + hour * 3_600_000), end: null };
}

interface Proposal {
  readonly approvals: ApprovalView[];
  readonly text: string;
}

async function proposeForIntent(
  c: AppContext,
  kit: RouteKit,
  repos: RequestRepos,
  auth: UserAuth,
  user: AiUser,
  input: {
    text: string;
    intent: DetectedIntent;
    person: ContactMatch | null;
    voice: boolean;
    messageId: string;
  },
): Promise<Proposal> {
  const { assist } = assistOf(kit);
  const L = user.locale;
  const now = kit.now();
  const origin = input.voice ? 'voice' : 'assistant';
  const failed = (text = copy(L, 'assistant.generated.proposalFailed')): Proposal => ({
    approvals: [],
    text,
  });
  const deps = serviceDeps(c, kit, repos);
  const correlationId = c.get('correlationId');
  const emails =
    input.person?.primary_email === null || input.person === null
      ? []
      : [input.person.primary_email];
  switch (input.intent.intent) {
    case 'draft_reply': {
      const [mail] = (
        await assist.store.mailsWith(
          auth.userId,
          emails,
          new Date(now.getTime() - 30 * 86_400_000),
          10,
        )
      ).filter((m) => m.direction === 'inbound');
      if (mail === undefined) return failed(copy(L, 'assistant.generated.personNotFound'));
      const draft = await createReplyDraft(kit, auth, {
        messageId: mail.id,
        tone: 'professional',
        correlationId,
      });
      const out = await submitDraft(kit, c, repos, auth, {
        draftId: draft.row.id,
        expectedVersion: draft.row.version,
        origin: 'assistant',
      });
      return { approvals: [out.approval], text: copy(L, 'assistant.generated.proposal') };
    }
    case 'draft_follow_up': {
      const threads = (await assist.store.awaitingThreadsWith(auth.userId, emails)).filter(
        (t) => t.reply_state === 'awaiting_their_reply',
      );
      const thread = threads[0];
      if (thread === undefined)
        return failed(
          copy(L, 'assistant.generated.replyStatusNone', {
            name: input.person?.display_name ?? '',
          }),
        );
      const draft = await createFollowUpDraft(kit, auth, {
        threadId: thread.id,
        tone: 'short',
        correlationId,
      });
      const out = await submitDraft(kit, c, repos, auth, {
        draftId: draft.row.id,
        expectedVersion: draft.row.version,
        origin: 'assistant',
      });
      return { approvals: [out.approval], text: copy(L, 'assistant.generated.proposal') };
    }
    case 'create_reminder': {
      const time = requestedTime(input.text, now, user.timeZone);
      if (time === null || time.start.getTime() <= now.getTime())
        return failed(copy(L, 'assistant.generated.needTime'));
      const title = clip(
        input.intent.topic ?? message(L, 'assistant.generated.reminderTitle'),
        200,
      );
      const out = await proposeApproval(deps, {
        userId: auth.userId,
        payload: {
          action_type: 'reminder_create',
          destination: { kind: 'in_app', channel: 'push' },
          title,
          preset: 'custom',
          fire_at: time.start.toISOString(),
          time_zone: user.timeZone,
        },
        origin,
        originRefId: input.messageId,
        actor: 'user',
      });
      return { approvals: [out.view], text: copy(L, 'assistant.generated.proposal') };
    }
    case 'create_event': {
      const time = requestedTime(input.text, now, user.timeZone);
      if (time === null || time.start.getTime() <= now.getTime())
        return failed(copy(L, 'assistant.generated.needTime'));
      const calendar = await assist.store.writableCalendar(auth.userId, null);
      if (calendar === null) return failed();
      const title = clip(
        [message(L, 'assistant.generated.eventTitle'), input.person?.display_name]
          .filter(Boolean)
          .join(' · '),
        300,
      );
      const end = time.end ?? new Date(time.start.getTime() + 60 * 60_000);
      const out = await proposeApproval(deps, {
        userId: auth.userId,
        payload: {
          action_type: 'calendar_create',
          target: {
            kind: 'provider',
            connected_account_id: calendar.connected_account_id,
            calendar_id: calendar.id,
          },
          title,
          time: {
            kind: 'timed',
            start: time.start.toISOString(),
            end: end.toISOString(),
            time_zone: user.timeZone,
          },
          attendees: emails.map((email) => ({ email, optional: false })),
          reminders_minutes: [],
        },
        origin,
        originRefId: input.messageId,
        actor: 'user',
      });
      return { approvals: [out.view], text: copy(L, 'assistant.generated.proposal') };
    }
    case 'move_event': {
      const from = input.intent.from ?? now;
      const to = input.intent.to ?? new Date(now.getTime() + 2 * 86_400_000);
      const events = (await assistOf(kit).intel.mail.events(auth.userId, from, to)).filter(
        (e) => e.status !== 'cancelled' && !e.all_day && Date.parse(e.start_at) >= now.getTime(),
      );
      const named =
        input.person === null
          ? []
          : events.filter((e) => e.attendees.some((a) => a.contact_id === input.person?.id));
      const target = named[0] ?? events.find((e) => e.attendee_count > 0) ?? events[0];
      if (target === undefined) return failed();
      const event = await assist.store.meetingEvent(auth.userId, target.id);
      if (event === null || !['google', 'microsoft', 'demo'].includes(event.provider))
        return failed();
      if (!event.organizer_self && !event.can_modify)
        return failed(message(L, 'plan.conflict.notOrganizer'));
      const amount = /(\d+)\s*(dakika|dk|saat)/iu.exec(input.text.toLocaleLowerCase('tr-TR'));
      const minutes = amount === null ? 30 : Number(amount[1]) * (amount[2] === 'saat' ? 60 : 1);
      const sign = /geri al/iu.test(input.text) ? -1 : 1;
      const shift = sign * minutes * 60_000;
      const out = await proposeApproval(deps, {
        userId: auth.userId,
        payload: {
          action_type: 'calendar_update',
          target: {
            kind: 'provider',
            connected_account_id: event.connected_account_id,
            calendar_id: event.calendar_id,
          },
          calendar_event_id: event.id,
          changes: {
            time: {
              kind: 'timed',
              start: new Date(Date.parse(event.start_at) + shift).toISOString(),
              end: new Date(Date.parse(event.end_at) + shift).toISOString(),
              time_zone: user.timeZone,
            },
          },
        },
        origin,
        originRefId: input.messageId,
        actor: 'user',
      });
      return { approvals: [out.view], text: copy(L, 'assistant.generated.proposal') };
    }
    default:
      return failed();
  }
}

function citationPayload(index: number, c: Citation) {
  return { index, source: c.source, title: c.title, snippet: c.snippet.slice(0, 200) };
}

interface Outcome {
  text: string;
  cards: AssistantRichCardV1[];
  citations: Citation[];
  approvals: ApprovalView[];
  finish: QaResult['finish'];
  grounded: boolean;
  route: AssistantAnswerV1['route'];
  promptVersionId: string | null;
  aiRequestId: string | null;
  coverage: number | null;
}

/** API-AST-02 body: meta → status → cards / deltas / proposals → citations → done. */
async function answer(
  c: AppContext,
  kit: RouteKit,
  auth: UserAuth,
  input: {
    user: AiUser;
    thread: { id: string; scope: string; scope_ref_id: string | null };
    text: string;
    voice: boolean;
    assistantMessageId: string;
    history: AssistantMessageRow[];
  },
  send: Send,
  signal: AbortSignal,
): Promise<Outcome> {
  const { assist, intel } = assistOf(kit);
  const user = input.user;
  const L = user.locale;
  const now = kit.now();
  const correlationId = c.get('correlationId');
  const pipeline = {
    runtime: intel.ai.runtime,
    user,
    correlationId,
    canary: intel.ai.canary,
    signal,
  };
  const out: Outcome = {
    text: '',
    cards: [],
    citations: [],
    approvals: [],
    finish: 'stop',
    grounded: true,
    route: 'template',
    promptVersionId: null,
    aiRequestId: null,
    coverage: null,
  };
  const say = async (text: string) => {
    for (let at = 0; at < text.length; at += 500)
      await send('delta', { text: text.slice(at, at + 500) });
    out.text = `${out.text}${out.text === '' ? '' : ' '}${text}`.trim();
  };
  await send('status', { stage: 'retrieving' });
  const detected = await detectIntent(pipeline, {
    text: input.text,
    now,
    history: input.history.filter((m) => m.role === 'user').map((m) => m.content),
  });
  if (detected.kind !== 'ok') throw interactiveAiError(detected.reason);
  const intent = detected.intent;
  const scoped = input.thread.scope === 'person' ? input.thread.scope_ref_id : null;
  const needsPerson = [
    'last_talk_with_person',
    'reply_status_person',
    'draft_reply',
    'draft_follow_up',
  ].includes(intent.intent);
  let person: ContactMatch | null = null;
  if (needsPerson || (isWriteIntent(intent.intent) && intent.people.length > 0)) {
    const found = await resolvePerson(assist.store, auth.userId, intent.people, scoped);
    if (found.kind === 'many') {
      out.cards.push(personChoiceCard(found.contacts, L));
      await send('card', out.cards[0]);
      await say(copy(L, 'assistant.generated.personChoice'));
      return out;
    }
    if (found.kind === 'one') person = found.contact;
    else if (needsPerson) {
      await say(copy(L, 'assistant.generated.personNotFound'));
      out.grounded = false;
      out.finish = 'refused_ungrounded';
      return out;
    }
  }

  // Write intents: code-built pending approvals (R-04); nothing executes from chat or voice.
  if (isWriteIntent(intent.intent)) {
    out.route = 'proposal';
    try {
      const proposal = await proposeForIntent(c, kit, kit.deps.repos(auth), auth, user, {
        text: input.text,
        intent,
        person,
        voice: input.voice,
        messageId: input.assistantMessageId,
      });
      for (const approval of proposal.approvals) {
        out.approvals.push(approval);
        await send('action_proposal', { approval });
      }
      await say(proposal.text);
    } catch (error) {
      if (!isAppError(error) || error.code === 'AI_UNAVAILABLE') throw error;
      await say(copy(L, 'assistant.generated.proposalFailed'));
    }
    return out;
  }

  if (intent.intent === 'reply_status_person' && person !== null) {
    const emails = person.primary_email === null ? [] : [person.primary_email];
    const [thread] = await assist.store.awaitingThreadsWith(auth.userId, emails);
    const name = person.display_name;
    if (thread === undefined) await say(copy(L, 'assistant.generated.replyStatusNone', { name }));
    else if (thread.reply_state === 'awaiting_my_reply')
      await say(copy(L, 'assistant.generated.replyStatusMine', { name }));
    else {
      const since = Date.parse(thread.awaiting_since ?? thread.last_message_at);
      await say(
        copy(L, 'assistant.generated.replyStatusWaiting', {
          days: Math.max(0, Math.floor((now.getTime() - since) / 86_400_000)),
        }),
      );
    }
    if (thread !== undefined) {
      out.citations.push({
        source: {
          source_type: 'email_thread',
          source_id: thread.id,
          source_provider: thread.provider,
          source_timestamp: new Date(thread.last_message_at).toISOString(),
          open_route: links.mailDetail(thread.id),
        },
        title: clip(thread.subject ?? '', 200),
        snippet: clip(thread.ai_summary ?? thread.subject ?? '', 200),
      });
    }
    return out;
  }

  if (intent.intent === 'last_talk_with_person' && person !== null && !user.isPro) {
    const emails = person.primary_email === null ? [] : [person.primary_email];
    const [mail] = await assist.store.mailsWith(
      auth.userId,
      emails,
      new Date(now.getTime() - FREE_RETRIEVAL_DAYS * 86_400_000),
      1,
    );
    if (mail === undefined) {
      await say(copy(L, 'assistant.generated.lastTalkNone', { name: person.display_name }));
      out.grounded = false;
      out.finish = 'refused_ungrounded';
      return out;
    }
    await say(
      copy(L, 'assistant.generated.lastTalk', {
        name: person.display_name,
        subject: clip(mail.subject ?? '', 120),
        date: formatDay(L, mail.received_at, user.timeZone),
      }),
    );
    out.citations.push({
      source: {
        source_type: 'email_message',
        source_id: mail.id,
        source_provider: mail.provider,
        source_timestamp: new Date(mail.received_at).toISOString(),
        open_route: links.mailDetail(mail.id),
      },
      title: clip(mail.subject ?? '', 200),
      snippet: clip(mail.ai_summary ?? mail.snippet ?? '', 200),
    });
    return out;
  }

  if (intent.intent !== 'memory_qa' && intent.intent !== 'last_talk_with_person') {
    const snapshot = await assist.insights.snapshot(auth.userId, now);
    const template = templateAnswer(intent, snapshot, {
      now,
      timeZone: user.timeZone,
      locale: L,
      workingHours: user.workingHours,
    });
    if (template !== null) {
      for (const card of template.cards) {
        out.cards.push(card);
        await send('card', card);
      }
      await say(template.text);
      out.citations.push(...template.citations.slice(0, 6));
      return out;
    }
  }

  // Grounded QA over the user's derived data (Free: last 7 days, FTS; Pro: hybrid memory).
  const repo = intel.search(auth);
  const search = await runSearch(
    {
      search: (args) => repo.search(args),
      contactsNamed: (names) => repo.contactsNamed(names),
      ownsContact: (id) => repo.ownsContact(id),
      semanticQuota: () => repo.semanticQuota(),
      embedQuery: user.isPro
        ? (text) =>
            embedTexts(intel.ai.runtime, {
              feature: 'embedding_query',
              userId: user.userId,
              plan: user.plan,
              profile: user.profile,
              flags: user.flags,
              inputs: [text],
              correlationId,
            })
        : null,
    },
    {
      q: input.text.slice(0, 200).padEnd(2, ' '),
      mode: 'results',
      contact_id: person?.id ?? scoped ?? undefined,
      from: user.isPro
        ? undefined
        : new Date(now.getTime() - FREE_RETRIEVAL_DAYS * 86_400_000).toISOString(),
      limit: 6,
    },
    { isPro: user.isPro, now, timeZone: user.timeZone, locale: L },
  );
  const retrieved = retrievalDocs(search.data.results);
  const plan = await planQa(intel.ai.runtime, user, intel.ai.canary);
  if (plan.kind !== 'ok') throw interactiveAiError(plan.reason);
  out.route = 'grounded_qa';
  await send('status', { stage: 'generating' });
  const qa = await answerGrounded(
    intel.ai.runtime,
    plan,
    {
      user,
      question: input.text,
      history: input.history.slice(-6).map((m) => ({ role: m.role, text: clip(m.content, 600) })),
      results: retrieved.docs,
      correlationId,
      signal,
      ...(person === null ? {} : { scopeLine: `Kişi: ${person.display_name}` }),
    },
    {
      delta: async (text) => {
        await send('delta', { text });
        out.text = `${out.text}${text}`;
      },
      cite: () => Promise.resolve(),
    },
  );
  await send('status', { stage: 'verifying' });
  out.promptVersionId = qa.promptVersionId;
  out.aiRequestId = qa.aiRequestId;
  out.coverage = qa.coverage;
  out.finish = qa.finish;
  out.grounded = qa.grounded;
  out.citations.push(
    ...qa.cited.map((i) => retrieved.citations[i]).filter((x): x is Citation => x !== undefined),
  );
  if (!qa.grounded && qa.finish !== 'client_disconnected')
    await say(copy(L, 'assistant.generated.notFound'));
  out.text = out.text.trim();
  return out;
}

function storedAnswer(
  row: AssistantMessageRow,
  actions: { approval_id: string; action_type: string }[],
): AssistantAnswerV1 {
  const citations = row.citations as ReturnType<typeof citationPayload>[];
  return {
    message_id: row.id,
    route:
      actions.length > 0 ? 'proposal' : row.prompt_version_id !== null ? 'grounded_qa' : 'template',
    blocks:
      row.content === ''
        ? []
        : [
            {
              text: row.content,
              verified: row.grounded,
              citations: citations.map((c) => ({ result_index: c.index, cited_text: c.snippet })),
            },
          ],
    source_cards: citations.map((c) => ({
      result_index: c.index,
      source_type: c.source.source_type,
      icon: c.source.source_type === 'calendar_event' ? 'event' : 'mail',
      src_label: c.source.label ?? c.source.source_provider,
      date_label: c.source.source_timestamp.slice(0, 10),
      title: c.title,
      summary: c.snippet,
      deeplink: c.source.open_route ?? '',
      page_no: null,
    })),
    rich_cards: row.cards as AssistantRichCardV1[],
    proposed_actions: actions,
    coverage: null,
    confidence_label: null,
    unknown: !row.grounded,
    followup_suggestions: [],
  };
}

export const registerAssistantRoutes: RouteRegistrar = (app, kit) => {
  const threads = routes['POST /assistant/threads'];
  mountRoute(
    app,
    threads,
    ...kit.chain({ gate: true, rateLimit: 'api_default' }),
    parseJsonBody(threads),
    validateRequest(threads),
    async (c) => {
      const auth = currentUser(c);
      const body = validBody(c, AssistantThreadBody);
      const { assist } = assistOf(kit);
      const view = (t: {
        id: string;
        scope: string;
        scope_ref_id: string | null;
        created_at: string;
      }) => ({
        id: t.id,
        scope:
          t.scope === 'person'
            ? { type: 'person', contact_id: t.scope_ref_id }
            : { type: 'global' },
        created_at: new Date(t.created_at).toISOString(),
      });
      const existing = await assist.store.assistantThreadByClient(
        auth.userId,
        body.client_thread_id,
      );
      if (existing !== null) {
        c.header('Idempotency-Replayed', 'true');
        return sendData(c, view(existing), 201, { idempotency_replayed: true });
      }
      if (
        body.scope.type === 'person' &&
        (await assist.store.contact(auth.userId, body.scope.contact_id)) === null
      ) {
        throw new AppError('NOT_FOUND', { details: { resource: 'contact' } });
      }
      const row = await assist.store.insertAssistantThread({
        user_id: auth.userId,
        scope: body.scope.type,
        scope_ref_id: body.scope.type === 'person' ? body.scope.contact_id : null,
        client_thread_id: body.client_thread_id,
      });
      return sendData(c, view(row), 201);
    },
  );

  const messages = routes['POST /assistant/threads/:id/messages'];
  mountRoute(
    app,
    messages,
    ...kit.chain({ gate: true, rateLimit: 'assistant_message' }),
    parseJsonBody(messages),
    validateRequest(messages),
    async (c) => {
      const auth = currentUser(c);
      const params = validParams(c, messages.request.params);
      const body = validBody(c, AssistantMessageBody);
      const { assist, intel } = assistOf(kit);
      const user = await intel.ai.users.load(auth.userId);
      if (!isOn(user.flags, 'ai.feature.assistant_qa')) {
        throw new AppError('FEATURE_DISABLED', { details: { feature: 'assistant_qa' } });
      }
      if (body.input_mode === 'voice' && !isOn(user.flags, 'feature.voice')) {
        throw new AppError('FEATURE_DISABLED', { details: { feature: 'voice' } });
      }
      const thread = await assist.store.assistantThread(auth.userId, params.id);
      if (thread === null)
        throw new AppError('NOT_FOUND', { details: { resource: 'assistant_thread' } });
      const replay = await assist.store.assistantMessageByClient(thread.id, body.client_message_id);
      if (replay !== null) {
        if (replay.status === 'streaming') {
          throw new AppError('IDEMPOTENCY_REPLAY', { details: { reason: 'in_progress' } });
        }
        const repos = kit.deps.repos(auth);
        const actions = [];
        for (const id of replay.proposed_approval_ids) {
          const row = await repos.approvals.get(auth.userId, id);
          if (row !== null) actions.push({ approval_id: row.id, action_type: row.action_type });
        }
        c.header('Idempotency-Replayed', 'true');
        return sendData(
          c,
          {
            assistant_message: {
              id: replay.id,
              thread_id: thread.id,
              answer: storedAnswer(replay, actions),
              finish_reason: replay.finish_reason ?? 'stop',
              created_at: new Date(replay.created_at).toISOString(),
            },
          },
          200,
          { idempotency_replayed: true },
        );
      }
      const now = kit.now();
      if (
        (await assist.store.streamingMessage(
          auth.userId,
          new Date(now.getTime() - STREAM_STALE_MS),
        )) !== null
      ) {
        throw new AppError('RATE_LIMITED', { details: { reason: 'stream_in_progress' } });
      }
      const quota = await requireQuota(kit, auth, 'assistant_messages_daily');
      const history = await assist.store.assistantHistory(thread.id, 8);
      const userMessage = await assist.store.insertAssistantMessage({
        user_id: auth.userId,
        thread_id: thread.id,
        role: 'user',
        content: body.content,
        cards: [],
        citations: [],
        proposed_approval_ids: [],
        followup_suggestions: [],
        status: 'complete',
        grounded: false,
        input_channel: body.input_mode,
        client_message_id: null,
        finish_reason: null,
        prompt_version_id: null,
        ai_request_id: null,
      });
      const reply = await assist.store.insertAssistantMessage({
        user_id: auth.userId,
        thread_id: thread.id,
        role: 'assistant',
        content: '',
        cards: [],
        citations: [],
        proposed_approval_ids: [],
        followup_suggestions: [],
        status: 'streaming',
        grounded: false,
        input_channel: body.input_mode,
        client_message_id: body.client_message_id,
        finish_reason: null,
        prompt_version_id: null,
        ai_request_id: null,
      });
      const remaining = Math.max(0, (quota.limit ?? UNCAPPED_REMAINING) - (quota.used ?? 0) - 1);
      const correlationId = c.get('correlationId');
      const locale = c.get('locale');
      return sseResponse(c.req.raw.signal, async (send, signal) => {
        await send('meta', {
          thread_id: thread.id,
          user_message_id: userMessage.id,
          assistant_message_id: reply.id,
          correlation_id: correlationId,
        });
        try {
          const out = await answer(
            c,
            kit,
            auth,
            {
              user,
              thread,
              text: body.content,
              voice: body.input_mode === 'voice',
              assistantMessageId: reply.id,
              history,
            },
            send,
            signal,
          );
          const citations = out.citations.slice(0, 6).map((cit, i) => citationPayload(i, cit));
          for (const citation of citations) await send('citation', citation);
          const finish = signal.aborted ? 'client_disconnected' : out.finish;
          await assist.store.updateAssistantMessage(reply.id, {
            content: out.text.slice(0, 8000),
            cards: out.cards,
            citations,
            proposed_approval_ids: out.approvals.map((a) => a.id),
            status: finish === 'refused_ungrounded' ? 'refused' : 'complete',
            grounded: out.grounded,
            finish_reason: finish,
            prompt_version_id: out.promptVersionId,
            ai_request_id: out.aiRequestId,
          });
          await assist.store.touchAssistantThread(thread.id, kit.now());
          await send('done', {
            assistant_message_id: reply.id,
            finish_reason: finish,
            grounded: out.grounded,
            usage: { remaining_messages: remaining },
          });
        } catch (error) {
          const appError = normalizeError(error);
          await assist.store.updateAssistantMessage(reply.id, {
            status: 'failed',
            finish_reason: null,
          });
          await send('error', toErrorBody(appError, correlationId, locale).error);
        }
      });
    },
  );

  const transcribe = routes['POST /assistant/transcribe'];
  mountRoute(app, transcribe, ...kit.chain({ gate: true, rateLimit: 'transcribe' }), async (c) => {
    const auth = currentUser(c);
    const { intel } = assistOf(kit);
    const user = await intel.ai.users.load(auth.userId);
    if (!isOn(user.flags, 'feature.voice') || !isOn(user.flags, 'voice.stt_server')) {
      throw new AppError('FEATURE_DISABLED', { details: { feature: 'voice.stt_server' } });
    }
    const declared = Number(c.req.header('Content-Length') ?? '0');
    if (declared > TRANSCRIBE_LIMITS.max_bytes + 64 * 1024) {
      throw new AppError('PAYLOAD_TOO_LARGE', {
        details: { limit_bytes: TRANSCRIBE_LIMITS.max_bytes },
      });
    }
    if (!/^multipart\/form-data/i.test(c.req.header('Content-Type') ?? '')) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', {
        details: { expected: 'multipart/form-data' },
      });
    }
    const form = await c.req.formData();
    const audio = form.get('audio');
    const durationMs = Number(form.get('duration_ms') ?? 'NaN');
    if (Number.isFinite(durationMs) && durationMs > TRANSCRIBE_LIMITS.max_seconds * 1000) {
      throw new AppError('PAYLOAD_TOO_LARGE', {
        details: { limit_seconds: TRANSCRIBE_LIMITS.max_seconds },
      });
    }
    const fields = TranscribeForm.safeParse({
      language: form.get('language'),
      purpose: form.get('purpose'),
      duration_ms: form.get('duration_ms'),
    });
    if (!fields.success || !(audio instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { details: { reason: 'transcribe_form' } });
    }
    const mime = audio.type.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!(TRANSCRIBE_AUDIO_MIME_VALUES as readonly string[]).includes(mime)) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', {
        details: { allowed: [...TRANSCRIBE_AUDIO_MIME_VALUES] },
      });
    }
    if (audio.size > TRANSCRIBE_LIMITS.max_bytes) {
      throw new AppError('PAYLOAD_TOO_LARGE', {
        details: { limit_bytes: TRANSCRIBE_LIMITS.max_bytes },
      });
    }
    const bytes = new Uint8Array(await audio.arrayBuffer());
    if (!audioMagicMatches(bytes, mime)) {
      throw new AppError('UPLOAD_INVALID', { details: { reason: 'magic_mismatch' } });
    }
    const container = wavSeconds(bytes);
    if (container !== null && container > TRANSCRIBE_LIMITS.max_seconds + 1) {
      throw new AppError('PAYLOAD_TOO_LARGE', {
        details: { limit_seconds: TRANSCRIBE_LIMITS.max_seconds },
      });
    }
    const seconds = Math.ceil(container ?? fields.data.duration_ms / 1000);
    await requireQuota(kit, auth, 'transcribe_seconds_daily', seconds);
    const result = await transcribeAudio(
      intel.ai.runtime,
      {
        userId: user.userId,
        plan: user.plan,
        profile: user.profile,
        flags: user.flags,
        correlationId: c.get('correlationId'),
      },
      {
        audio: bytes,
        mime,
        language: fields.data.language === 'en-US' ? 'en' : 'tr',
        expectedSeconds: seconds,
      },
    );
    if (result.kind !== 'ok') throw interactiveAiError(result.reason);
    return sendData(c, {
      text: result.text.slice(0, 10000),
      duration_s: result.seconds,
      language: fields.data.language,
      confidence: result.confidence,
    });
  });
};

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

/** Magic bytes of the allowed audio containers (API_CONTRACTS §2.10). */
export function audioMagicMatches(bytes: Uint8Array, mime: string): boolean {
  switch (mime) {
    case 'audio/m4a':
    case 'audio/mp4':
      return ascii(bytes, 4, 8) === 'ftyp';
    case 'audio/aac':
      return bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xf6) === 0xf0;
    case 'audio/wav':
      return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE';
    case 'audio/webm':
      return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case 'audio/ogg':
      return ascii(bytes, 0, 4) === 'OggS';
    default:
      return false;
  }
}

/** Duration from a WAV header (byte rate and data size); null for other containers. */
export function wavSeconds(bytes: Uint8Array): number | null {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WAVE' || bytes.byteLength < 44)
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = view.getUint32(28, true);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') return byteRate > 0 ? size / byteRate : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}
