// @vitest-environment happy-dom
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeletionFlow } from '../../src/components/forms/DeletionFlow.tsx';
import { SupportForm } from '../../src/components/forms/SupportForm.tsx';
import { loadWebMessages } from '../../src/i18n/messages.ts';
import { renderWithIntl } from './render.tsx';

/*
 * The web request flows against PUB-01 (support), PUB-02/03 (deletion start/verify) and PUB-07
 * (status): success, validation, rate limit, OTP invalid/locked, network and server failures.
 * `fetch` is scripted per route; the components and copy are real.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
});

vi.mock('@/i18n/navigation.ts', () => import('../stubs/i18n-navigation.tsx'));

const TR = loadWebMessages('tr');
const EN = loadWebMessages('en');
const FLOW = TR.webPages.deletion.flow;
const REQUEST_ID = '0190f5e0-0000-7000-8000-000000000123';

type Reply = Response | Error;
function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Routes `fetch` by path suffix; each route answers from its queue (the last reply repeats). */
function scriptFetch(routes: Record<string, Reply[]>) {
  const fetch = vi.fn((url: string, _init?: RequestInit) => {
    const path = new URL(url).pathname.replace('/functions/v1/public-api', '');
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    const queue = key === undefined ? undefined : routes[key];
    const reply = queue === undefined ? json(404, {}) : queue.length > 1 ? queue.shift() : queue[0];
    if (reply === undefined) return Promise.resolve(json(404, {}));
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const accepted = () => json(202, { data: { status: 'code_sent_if_account_exists' } });
const verified = (active: boolean) =>
  json(202, {
    data: {
      reference: 'DEL-10240',
      request_id: REQUEST_ID,
      status: 'queued',
      status_token: 'tok_1',
      subscription_notice: { active },
    },
  });

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function requestCode(email = 'yunus@example.com') {
  fireEvent.change(screen.getByLabelText(FLOW.emailLabel), { target: { value: email } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: FLOW.sendCode }));
    await Promise.resolve();
  });
  await flush();
}

async function submitCode(code = '123456', word = 'SİL') {
  fireEvent.change(screen.getByLabelText(FLOW.codeLabel), { target: { value: code } });
  fireEvent.change(screen.getByLabelText(FLOW.confirmLabel.replace('{word}', 'SİL')), {
    target: { value: word },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: FLOW.submit }));
    await Promise.resolve();
  });
  await flush();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DeletionFlow (W-DEL-01, PUB-02/03/07)', () => {
  it('validates the address locally before calling PUB-02', async () => {
    const fetch = scriptFetch({});
    renderWithIntl(<DeletionFlow turnstileSiteKey={undefined} nonce={undefined} />);
    await requestCode('not-an-email');
    expect(screen.getByRole('alert').textContent).toContain(FLOW.errors.emailInvalid);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [json(422, { error: { code: 'VALIDATION_FAILED' } }), FLOW.errors.emailInvalid],
    [
      json(429, { error: { code: 'RATE_LIMITED' } }, { 'retry-after': '120' }),
      FLOW.errors.rateLimited.replace('{minutes}', '2'),
    ],
    [new TypeError('offline'), FLOW.errors.startNetwork],
    [json(500, { error: { code: 'INTERNAL_ERROR' } }), FLOW.errors.serviceUnavailable],
  ])('maps a failed start to the right message (%#)', async (reply, message) => {
    scriptFetch({ '/data-deletion/start': [reply] });
    renderWithIntl(<DeletionFlow turnstileSiteKey={undefined} nonce={undefined} />);
    await requestCode();
    expect(screen.getByRole('alert').textContent).toContain(message);
    expect(screen.getByRole('button', { name: FLOW.sendCode })).toBeTruthy();
  });

  it.each([
    [json(422, { error: { code: 'OTP_INVALID' } }), FLOW.errors.otpInvalid],
    [
      json(429, { error: { code: 'RATE_LIMITED' } }, { 'retry-after': '30' }),
      FLOW.errors.rateLimited.replace('{minutes}', '1'),
    ],
    [new TypeError('offline'), FLOW.errors.verifyNetwork],
    [json(503, { error: { code: 'SERVICE_UNAVAILABLE' } }), FLOW.errors.serviceUnavailable],
  ])('keeps the code step with a message when PUB-03 fails (%#)', async (reply, message) => {
    scriptFetch({ '/data-deletion/start': [accepted()], '/data-deletion/verify': [reply] });
    renderWithIntl(<DeletionFlow turnstileSiteKey={undefined} nonce={undefined} />);
    await requestCode();
    await submitCode();
    expect(screen.getByRole('alert').textContent).toContain(message);
    expect(screen.getByLabelText(FLOW.codeLabel)).toBeTruthy();
  });

  it('locks the flow after OTP_LOCKED and points to the app and support', async () => {
    scriptFetch({
      '/data-deletion/start': [accepted()],
      '/data-deletion/verify': [json(423, { error: { code: 'OTP_LOCKED' } })],
    });
    const { container } = renderWithIntl(
      <DeletionFlow turnstileSiteKey={undefined} nonce={undefined} />,
    );
    await requestCode();
    await submitCode();
    expect(container.querySelector('[data-step="locked"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: FLOW.lockedTitle })).toBeTruthy();
    expect(container.querySelector('a[href="/support?category=privacy#contact"]')).not.toBeNull();
  });

  it('shows the reference, the subscription warning and the PUB-07 status on success', async () => {
    const fetch = scriptFetch({
      '/data-deletion/start': [accepted()],
      '/data-deletion/verify': [verified(true)],
      [`/data-deletion/${REQUEST_ID}/status`]: [
        json(200, {
          data: {
            reference: 'DEL-10240',
            status: 'queued',
            requested_at: '2026-09-24T09:00:00Z',
            completed_at: null,
          },
        }),
        json(500, {}),
      ],
    });
    const { container } = renderWithIntl(
      <DeletionFlow turnstileSiteKey={undefined} nonce={undefined} />,
    );
    await requestCode();
    await submitCode();
    expect(container.querySelector('[data-step="done"]')).not.toBeNull();
    expect(container.textContent).toContain('DEL-10240');
    expect(container.textContent).toContain('y***@example.com'.slice(0, 1));
    expect(screen.getByTestId('subscription-warning')).toBeTruthy();
    const verifyBody = JSON.parse((fetch.mock.calls[1]?.[1] as { body: string }).body) as Record<
      string,
      string
    >;
    expect(verifyBody).toMatchObject({ code: '123456', kind: 'account', confirmation: 'SİL' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: FLOW.statusCheck }));
      await Promise.resolve();
    });
    await flush();
    expect(container.textContent).toContain(TR.web.deletion.statuses.queued);
    expect(String(fetch.mock.calls[2]?.[0])).toContain('?token=tok_1');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: FLOW.statusCheck }));
      await Promise.resolve();
    });
    await flush();
    expect(container.textContent).toContain(FLOW.statusUnavailable);
  });

  it('resends after the cooldown and can go back to the email step', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = scriptFetch({ '/data-deletion/start': [accepted(), accepted()] });
    renderWithIntl(<DeletionFlow turnstileSiteKey={undefined} nonce={undefined} />);
    await requestCode();
    const resend = screen.getByRole('button', { name: FLOW.resend });
    expect(resend).toHaveProperty('disabled', true);
    expect(screen.getByText(FLOW.resendIn.replace('{seconds}', '60'))).toBeTruthy();
    for (let i = 0; i < 61; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });
    }
    expect(screen.getByRole('button', { name: FLOW.resend })).toHaveProperty('disabled', false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: FLOW.resend }));
      await Promise.resolve();
    });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.click(await screen.findByRole('button', { name: FLOW.changeEmail }));
    expect(screen.getByLabelText<HTMLInputElement>(FLOW.emailLabel).value).toBe('');
  });

  it('rejects a short code on submit and accepts DELETE in English', async () => {
    scriptFetch({
      '/data-deletion/start': [accepted()],
      '/data-deletion/verify': [verified(false)],
    });
    const EFLOW = EN.webPages.deletion.flow;
    const { container } = renderWithIntl(
      <DeletionFlow turnstileSiteKey={undefined} nonce={undefined} />,
      'en',
    );
    fireEvent.change(screen.getByLabelText(EFLOW.emailLabel), {
      target: { value: 'yunus@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: EFLOW.sendCode }));
      await Promise.resolve();
    });
    await flush();
    fireEvent.change(screen.getByLabelText(EFLOW.codeLabel), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText(EFLOW.confirmLabel.replace('{word}', 'DELETE')), {
      target: { value: 'delete' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: EFLOW.submit }));
      await Promise.resolve();
    });
    await flush();
    expect(container.querySelector('[data-step="done"]')).not.toBeNull();
    expect(screen.queryByTestId('subscription-warning')).toBeNull();
  });

  it('shows the offline notice and disables sending while offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderWithIntl(<DeletionFlow turnstileSiteKey={undefined} nonce={undefined} />);
    expect(screen.getByRole('status').textContent).toContain(TR.webPages.common.offline);
    expect(screen.getByRole('button', { name: FLOW.sendCode })).toHaveProperty('disabled', true);
  });
});

describe('SupportForm (W-SUP-01, PUB-01)', () => {
  const FORM = TR.web.support.form;
  const PAGE_ERRORS = TR.webPages.support.form.errors as Record<string, string>;

  function fill() {
    fireEvent.change(screen.getByLabelText(FORM.email), {
      target: { value: 'yunus@example.com' },
    });
    fireEvent.change(screen.getByLabelText(FORM.topic), { target: { value: 'billing' } });
    fireEvent.change(screen.getByLabelText(FORM.message), {
      target: { value: 'Faturam iki kez kesildi, yardım eder misiniz?' },
    });
  }

  async function send() {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: FORM.submit }));
      await Promise.resolve();
    });
    await flush();
  }

  it('sends the trimmed ticket and shows the reference; "another" resets the form', async () => {
    const fetch = scriptFetch({ '/support': [json(202, { data: { reference: 'DA-10240' } })] });
    renderWithIntl(
      <SupportForm initialCategory={null} turnstileSiteKey={undefined} nonce={undefined} />,
    );
    fill();
    fireEvent.change(screen.getByLabelText(FORM.name), { target: { value: '  Yunus  ' } });
    await send();
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as { body: string }).body) as Record<
      string,
      string
    >;
    expect(body).toMatchObject({ email: 'yunus@example.com', category: 'billing', name: 'Yunus' });
    expect(screen.getByTestId('support-success').textContent).toContain('DA-10240');
    fireEvent.click(screen.getByRole('button', { name: FORM.another }));
    expect(screen.getByLabelText<HTMLInputElement>(FORM.email).value).toBe('');
  });

  it('maps server field errors and a failed captcha', async () => {
    scriptFetch({
      '/support': [
        json(422, {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'x',
            field_errors: [
              { path: 'email', code: 'invalid_format' },
              { path: 'name', code: 'too_big' },
              { path: 'category', code: 'invalid_value' },
              { path: 'message', code: 'too_big' },
              { path: 'captcha_token', code: 'invalid' },
            ],
          },
        }),
      ],
    });
    renderWithIntl(
      <SupportForm initialCategory={null} turnstileSiteKey={undefined} nonce={undefined} />,
    );
    fill();
    await send();
    expect(screen.getByLabelText(FORM.email).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(FORM.message).getAttribute('aria-invalid')).toBe('true');
    expect(
      screen
        .getAllByRole('alert')
        .map((a) => a.textContent)
        .join(' '),
    ).toContain(FORM.captchaFailed);
  });

  it.each([
    ['rate limit', json(429, { error: { code: 'RATE_LIMITED' } }), PAGE_ERRORS.rateLimited],
    ['network', new TypeError('offline'), PAGE_ERRORS.network],
    ['server', json(500, { error: { code: 'INTERNAL_ERROR' } }), FORM.serverError],
    ['bad response', json(202, { data: {} }), FORM.serverError],
  ] as const)('shows the %s error in the summary', async (_name, reply, message) => {
    scriptFetch({ '/support': [reply] });
    renderWithIntl(
      <SupportForm initialCategory={null} turnstileSiteKey={undefined} nonce={undefined} />,
    );
    fill();
    await send();
    expect(
      screen
        .getAllByRole('alert')
        .map((a) => a.textContent)
        .join(' '),
    ).toContain(message);
  });

  it('rejects a malformed address and a too-long name locally', async () => {
    const fetch = scriptFetch({});
    renderWithIntl(
      <SupportForm initialCategory="other" turnstileSiteKey={undefined} nonce={undefined} />,
    );
    fireEvent.change(screen.getByLabelText(FORM.email), { target: { value: 'a@b' } });
    fireEvent.change(screen.getByLabelText(FORM.name), { target: { value: 'x'.repeat(121) } });
    fireEvent.change(screen.getByLabelText(FORM.message), { target: { value: 'kısa' } });
    await send();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText(FORM.name).getAttribute('aria-invalid')).toBe('true');
  });
});
