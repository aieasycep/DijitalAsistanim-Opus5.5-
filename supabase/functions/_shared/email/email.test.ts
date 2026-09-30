/**
 * Email adapter and JOB-31 `transactional_email` (IMPLEMENTATION_PLAN T-10.01): configuration,
 * Postmark and Resend requests and error semantics, sealed parameters, templates (i18n text,
 * escaped HTML) and the job (recipient resolution at send time, sealed invite tokens, the
 * plus-addressed reply routing, final vs retryable failures). No network: every fetch is stubbed.
 */
import { assert, assertEquals, assertMatch, assertNotEquals, assertRejects } from '@std/assert';
import { loadKeyring } from '../crypto/token-cipher.ts';
import { JobError, type JobContext, type JobRow } from '../jobs/types.ts';
import { createLogger, memorySink } from '../logging/logger.ts';
import { testDb } from '../testing/db.ts';
import { randomBase64, TEST_SUPABASE_URL } from '../testing/env.ts';
import { jsonResponse, stubFetch } from '../testing/fetch.ts';
import { createPostmarkProvider, POSTMARK_URL } from './postmark.ts';
import { createEmailProvider, emailConfig } from './provider.ts';
import { createResendProvider, RESEND_URL } from './resend.ts';
import { openEmailParam, SealError, sealEmailParam } from './seal.ts';
import {
  escapeHtml,
  fill,
  renderAdminInvite,
  renderSecurityRecovery,
  renderSupportReply,
} from './templates.ts';
import {
  plusAddress,
  type TransactionalEmailPayload,
  transactionalEmailJob,
} from './transactional.ts';
import {
  EmailSendError,
  type EmailConfig,
  type EmailMessage,
  type EmailProvider,
} from './types.ts';

const CONFIG: EmailConfig = {
  provider: 'postmark',
  apiKey: 'server-token-for-tests',
  from: 'Dijital Asistan <destek@mail.dijitalasistan.app>',
  replyTo: 'destek@mail.dijitalasistan.app',
};
const MESSAGE: EmailMessage = {
  to: 'yunus@example.com',
  subject: 'Konu',
  text: 'Metin',
  html: '<p>Metin</p>',
  replyTo: 'destek+DA-7K3M9Q@mail.dijitalasistan.app',
  tag: 'support_reply',
  metadata: { job_id: 'job-1' },
};
const EMAIL_ENV = {
  EMAIL_PROVIDER: 'postmark',
  EMAIL_API_KEY: 'server-token-for-tests',
  EMAIL_FROM_ADDRESS: 'destek@mail.dijitalasistan.app',
  EMAIL_REPLY_TO: 'destek@mail.dijitalasistan.app',
  ADMIN_ORIGIN: 'https://admin.dijitalasistan.app/',
};
const TICKET = '00000000-0000-4000-8000-000000000082';
const NOTE = '00000000-0000-4000-8000-000000000104';
const ADMIN = '00000000-0000-4000-8000-000000000100';

// ── Configuration ────────────────────────────────────────────────────────────

Deno.test('email config: the three keys are required and the provider must be supported', () => {
  const missing = emailConfig({ EMAIL_PROVIDER: 'postmark' });
  assertEquals(missing.configured, false);
  assert(!missing.configured && missing.reason === 'external_credential_required');
  assert(!missing.configured && missing.missing.includes('EMAIL_API_KEY'));
  const unsupported = emailConfig({ ...EMAIL_ENV, EMAIL_PROVIDER: 'smtp' });
  assert(!unsupported.configured && unsupported.reason === 'unsupported_provider');
  const ok = emailConfig(EMAIL_ENV);
  assert(ok.configured);
  assertEquals(ok.config.replyTo, 'destek@mail.dijitalasistan.app');
  assertEquals(createEmailProvider(ok.config).id, 'postmark');
  assertEquals(createEmailProvider({ ...ok.config, provider: 'resend' }).id, 'resend');
});

// ── Postmark ─────────────────────────────────────────────────────────────────

Deno.test(
  'postmark: sends one JSON message with the server token and returns the message id',
  async () => {
    const { fetch, calls } = stubFetch(() =>
      jsonResponse({ ErrorCode: 0, MessageID: 'pm-1', Message: 'OK' }),
    );
    const sent = await createPostmarkProvider(CONFIG, { fetch }).send(MESSAGE);
    assertEquals(sent, { messageId: 'pm-1' });
    const call = calls[0];
    assertEquals([call?.url, call?.method], [POSTMARK_URL, 'POST']);
    assertEquals(call?.headers.get('x-postmark-server-token'), CONFIG.apiKey);
    const body = JSON.parse(call?.body ?? '{}');
    assertEquals(
      [body.From, body.To, body.ReplyTo, body.Tag, body.MessageStream],
      [CONFIG.from, MESSAGE.to, MESSAGE.replyTo, 'support_reply', 'outbound'],
    );
    assertEquals(body.Metadata, { job_id: 'job-1' });
  },
);

Deno.test('postmark: 422 refusals are final, 429/5xx and network errors retryable', async () => {
  const cases: [Response | Error, boolean][] = [
    [jsonResponse({ ErrorCode: 406, Message: 'inactive recipient' }, 422), false],
    [jsonResponse({ ErrorCode: 10, Message: 'bad token' }, 401), false],
    [jsonResponse({}, 429), true],
    [jsonResponse({}, 503), true],
    [new TypeError('connection reset'), true],
  ];
  for (const [answer, retryable] of cases) {
    const { fetch } = stubFetch(() => {
      if (answer instanceof Error) throw answer;
      return answer;
    });
    const error = await assertRejects(
      () => createPostmarkProvider(CONFIG, { fetch }).send(MESSAGE),
      EmailSendError,
    );
    assertEquals(error.retryable, retryable);
  }
});

// ── Resend ───────────────────────────────────────────────────────────────────

Deno.test('resend: bearer key, array recipient, reply_to and template tag', async () => {
  const { fetch, calls } = stubFetch(() => jsonResponse({ id: 're-1' }));
  const sent = await createResendProvider({ ...CONFIG, provider: 'resend' }, { fetch }).send(
    MESSAGE,
  );
  assertEquals(sent.messageId, 're-1');
  assertEquals(calls[0]?.url, RESEND_URL);
  assertEquals(calls[0]?.headers.get('authorization'), `Bearer ${CONFIG.apiKey}`);
  const body = JSON.parse(calls[0]?.body ?? '{}');
  assertEquals(
    [body.to, body.reply_to, body.tags],
    [[MESSAGE.to], MESSAGE.replyTo, [{ name: 'template', value: 'support_reply' }]],
  );
  const failing = stubFetch(() => jsonResponse({ name: 'validation_error' }, 422));
  const error = await assertRejects(
    () =>
      createResendProvider({ ...CONFIG, provider: 'resend' }, { fetch: failing.fetch }).send(
        MESSAGE,
      ),
    EmailSendError,
  );
  assertEquals([error.retryable, error.code], [false, 'resend_validation_error']);
});

// ── Sealed parameters ────────────────────────────────────────────────────────

async function keyring() {
  return await loadKeyring({
    token_encryption_keys: { 1: randomBase64(32) },
    TOKEN_ENC_ACTIVE_VERSION: 1,
  });
}

Deno.test('seal: round trip, bound to its purpose, never readable in the sealed form', async () => {
  const ring = await keyring();
  const token = 'A'.repeat(43);
  const sealed = await sealEmailParam(ring, token, `admin_invite|${ADMIN}`);
  assertMatch(sealed, /^s1\.1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert(!sealed.includes(token));
  assertEquals(await openEmailParam(ring, sealed, `admin_invite|${ADMIN}`), token);
  const other = await assertRejects(
    () => openEmailParam(ring, sealed, 'admin_invite|someone-else'),
    SealError,
  );
  assertEquals(other.reason, 'open_failed');
  assertEquals(
    (await assertRejects(() => openEmailParam(ring, 'plain-token', 'x'), SealError)).reason,
    'format',
  );
  assertNotEquals(await sealEmailParam(ring, token, 'x'), await sealEmailParam(ring, token, 'x'));
});

// ── Templates ────────────────────────────────────────────────────────────────

Deno.test('templates: Turkish and English text from the i18n catalogue, HTML escaped', () => {
  const tr = renderAdminInvite('tr', {
    name: 'Selin <b>Kaya</b>',
    url: 'https://admin.dijitalasistan.app/invite?token=x&y=1',
  });
  const en = renderAdminInvite('en', {
    name: 'Selin',
    url: 'https://admin.dijitalasistan.app/invite?token=x',
  });
  assertNotEquals(tr.subject, en.subject);
  assert(tr.text.includes('Selin <b>Kaya</b>'), 'plain text keeps the value');
  assert(
    tr.html.includes('Selin &lt;b&gt;Kaya&lt;/b&gt;') && !tr.html.includes('<b>Kaya'),
    'values never become markup',
  );
  assert(tr.html.includes('token=x&amp;y=1'));
  const reply = renderSupportReply('tr', {
    reference: 'DA-7K3M9Q',
    body: 'Merhaba,\nsorun giderildi.',
  });
  assert(reply.subject.includes('DA-7K3M9Q'));
  assert(reply.html.includes('Merhaba,<br>sorun giderildi.'));
  const notice = renderSecurityRecovery('en', { time: 'Sep 24, 2026, 1:00 PM' });
  assert(notice.text.includes('Sep 24, 2026'));
  for (const rendered of [tr, en, reply, notice])
    assert(!/\{[a-z_]+\}/i.test(rendered.text), 'every argument filled');
  assertEquals(fill('{a} {b}', { a: '1' }), '1 {b}');
  assertEquals(
    escapeHtml(`<a href="x">'&'</a>`),
    '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
  );
});

// ── The transactional_email job ──────────────────────────────────────────────

function jobRow(payload: TransactionalEmailPayload): JobRow {
  return {
    id: '00000000-0000-4000-8000-000000000070',
    type: 'transactional_email',
    status: 'running',
    user_id: null,
    connected_account_id: null,
    payload: payload as unknown as JobRow['payload'],
    idempotency_key: 'transactional_email:x',
    attempts: 1,
    max_attempts: 5,
    correlation_id: '77777777-7777-4777-8777-777777777777',
    lease_owner: 'w1',
    lease_expires_at: null,
    run_after: '2026-09-24T10:00:00Z',
  };
}

function context(payload: TransactionalEmailPayload): JobContext<TransactionalEmailPayload> {
  return {
    job: jobRow(payload),
    payload,
    signal: new AbortController().signal,
    log: createLogger({ fn: 'worker', sink: memorySink().sink }),
    correlationId: '77777777-7777-4777-8777-777777777777',
    workerId: 'w1',
    enqueue: () => Promise.reject(new Error('no follow-up jobs')),
    progress: () => Promise.resolve(),
    now: () => new Date('2026-09-24T10:00:00Z'),
  };
}

function recordingProvider(
  outcome: 'ok' | EmailSendError = 'ok',
): EmailProvider & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    id: 'postmark',
    sent,
    send(message) {
      sent.push(message);
      return outcome === 'ok' ? Promise.resolve({ messageId: 'pm-1' }) : Promise.reject(outcome);
    },
  };
}

/** A service client whose table reads answer from `tables` (PostgREST over a stubbed fetch). */
function tablesDb(tables: Record<string, Record<string, unknown> | null>) {
  return testDb(
    stubFetch((call) => {
      const table = new URL(call.url).pathname.replace('/rest/v1/', '');
      const row = tables[table] ?? null;
      assert(call.url.startsWith(TEST_SUPABASE_URL));
      return jsonResponse(row === null ? [] : [row]);
    }).fetch,
  );
}

Deno.test(
  'job: a support reply goes to the ticket contact with plus-addressed reply routing',
  async () => {
    const provider = recordingProvider();
    const job = transactionalEmailJob({
      system: tablesDb({
        support_tickets: { contact_email: 'yunus@example.com' },
        support_notes: { body: 'Merhaba, sorun giderildi.', ticket_id: TICKET },
      }),
      raw: EMAIL_ENV,
      keyring,
      provider,
    });
    const payload: TransactionalEmailPayload = {
      template_key: 'support_reply',
      recipient_ref: { type: 'support_ticket', id: TICKET },
      locale: 'tr',
      params: { reference: 'DA-7K3M9Q', note_id: NOTE },
    };
    assertEquals(job.payload.safeParse(payload).success, true);
    const result = await job.handler(context(payload));
    assertEquals(result, {
      message_id: 'pm-1',
      template_key: 'support_reply',
      provider: 'postmark',
    });
    const message = provider.sent[0];
    assertEquals(
      [message?.to, message?.replyTo],
      ['yunus@example.com', 'destek+DA-7K3M9Q@mail.dijitalasistan.app'],
    );
    assert(message?.text.includes('Merhaba, sorun giderildi.'));
    assert(
      !JSON.stringify(result).includes('yunus@example.com'),
      'the job result holds the message id only',
    );
  },
);

Deno.test('job: an admin invite opens the sealed token into the backoffice link', async () => {
  const ring = await keyring();
  const provider = recordingProvider();
  const token = 'B'.repeat(43);
  const job = transactionalEmailJob({
    system: tablesDb({ admin_users: { email: 'new@dijitalasistan.app', display_name: 'Selin' } }),
    raw: EMAIL_ENV,
    keyring: () => Promise.resolve(ring),
    provider,
  });
  await job.handler(
    context({
      template_key: 'admin_invite',
      recipient_ref: { type: 'admin_user', id: ADMIN },
      locale: 'tr',
      params: { invite_token_sealed: await sealEmailParam(ring, token, `admin_invite|${ADMIN}`) },
    }),
  );
  assert(provider.sent[0]?.text.includes(`https://admin.dijitalasistan.app/invite?token=${token}`));
  const forged = transactionalEmailJob({
    system: tablesDb({ admin_users: { email: 'x@y.z' } }),
    raw: EMAIL_ENV,
    keyring: () => Promise.resolve(ring),
    provider,
  });
  const error = await assertRejects(
    () =>
      forged.handler(
        context({
          template_key: 'admin_invite',
          recipient_ref: { type: 'admin_user', id: ADMIN },
          locale: 'tr',
          params: { invite_token_sealed: token },
        }),
      ),
    JobError,
  );
  assertEquals([error.code, error.retryable], ['TEMPLATE_PARAM_INVALID', false]);
});

Deno.test('job: missing credentials, recipients and templates are final failures', async () => {
  const base: TransactionalEmailPayload = {
    template_key: 'admin_security_recovery_used',
    recipient_ref: { type: 'admin_user', id: ADMIN },
    locale: 'en',
    params: {},
  };
  const noKey = transactionalEmailJob({
    system: tablesDb({}),
    raw: { EMAIL_PROVIDER: 'postmark' },
    keyring,
  });
  assertEquals(
    (await assertRejects(() => noKey.handler(context(base)), JobError)).code,
    'EXTERNAL_CREDENTIAL_REQUIRED',
  );

  const gone = transactionalEmailJob({
    system: tablesDb({ admin_users: null }),
    raw: EMAIL_ENV,
    keyring,
    provider: recordingProvider(),
  });
  assertEquals(
    (await assertRejects(() => gone.handler(context(base)), JobError)).code,
    'RECIPIENT_MISSING',
  );

  const deletion = transactionalEmailJob({
    system: tablesDb({}),
    raw: EMAIL_ENV,
    keyring,
    provider: recordingProvider(),
  });
  const unsupported = await assertRejects(
    () =>
      deletion.handler(
        context({ ...base, recipient_ref: { type: 'deletion_request', id: ADMIN } }),
      ),
    JobError,
  );
  assertEquals([unsupported.code, unsupported.retryable], ['RECIPIENT_UNSUPPORTED', false]);

  const unknown = transactionalEmailJob({
    system: tablesDb({ admin_users: { email: 'a@b.co' } }),
    raw: EMAIL_ENV,
    keyring,
    provider: recordingProvider(),
  });
  assertEquals(
    (
      await assertRejects(
        () => unknown.handler(context({ ...base, template_key: 'promo' })),
        JobError,
      )
    ).code,
    'TEMPLATE_UNKNOWN',
  );
});

Deno.test('job: provider throttling is retried, a rejected recipient is final', async () => {
  const base: TransactionalEmailPayload = {
    template_key: 'admin_security_recovery_used',
    recipient_ref: { type: 'admin_user', id: ADMIN },
    locale: 'tr',
    params: {},
  };
  const system = tablesDb({ admin_users: { email: 'sa@dijitalasistan.app' } });
  const throttled = transactionalEmailJob({
    system,
    raw: EMAIL_ENV,
    keyring,
    provider: recordingProvider(new EmailSendError('429', true, 429)),
  });
  const retry = await assertRejects(() => throttled.handler(context(base)), JobError);
  assertEquals([retry.code, retry.retryable], ['PROVIDER_UNAVAILABLE', true]);
  const rejected = transactionalEmailJob({
    system,
    raw: EMAIL_ENV,
    keyring,
    provider: recordingProvider(new EmailSendError('406', false, 422)),
  });
  const final = await assertRejects(() => rejected.handler(context(base)), JobError);
  assertEquals([final.code, final.retryable], ['EMAIL_REJECTED', false]);
});

Deno.test('job: extra recipient resolvers can be registered (deletion requests)', async () => {
  const provider = recordingProvider();
  const job = transactionalEmailJob({
    system: tablesDb({}),
    raw: EMAIL_ENV,
    keyring,
    provider,
    resolvers: { deletion_request: () => Promise.resolve('user@example.com') },
  });
  const error = await assertRejects(
    () =>
      job.handler(
        context({
          template_key: 'deletion_confirmation',
          recipient_ref: { type: 'deletion_request', id: ADMIN },
          locale: 'tr',
          params: {},
        }),
      ),
    JobError,
  );
  assertEquals(
    error.code,
    'TEMPLATE_UNKNOWN',
    'the resolver ran; the template belongs to the privacy flows',
  );
  assertEquals(provider.sent.length, 0);
});

Deno.test('plus addressing keeps the domain and tags the local part', () => {
  assertEquals(plusAddress('destek@mail.x', 'DA-1'), 'destek+DA-1@mail.x');
  assertEquals(plusAddress(null, 'DA-1'), null);
  assertEquals(plusAddress('invalid', 'DA-1'), 'invalid');
});
