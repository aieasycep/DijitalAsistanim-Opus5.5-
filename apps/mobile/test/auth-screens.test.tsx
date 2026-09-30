/**
 * T-8.05 sign-in and e-mail code screens on the real `app/` routes (M-ON-05, M-ON-05E/V): D-04
 * button order, unconfigured providers as disabled rows, offline, cancel vs failure with retry,
 * the sign-up / sign-in toggle, the Microsoft browser flow through the post-sign-in pipeline to
 * Today, and the e-mail code steps (validation, locale, unknown address, wrong code, cooldown).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AuthApiError } from '@supabase/supabase-js';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { router as appRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import type { OpenAuthSession } from '../src/lib/auth/browser-oauth';
import { rememberSignIn } from '../src/lib/auth/memory';
import { bufferedEventsForTests } from '../src/lib/events';
import {
  installApi,
  json,
  renderApp,
  resetAppState,
  installFakeSupabase,
  type FakeSupabase,
} from './helpers/app';
import { bootstrap, ok, session } from './helpers/fixtures';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

const openAuthSession = WebBrowser.openAuthSessionAsync as unknown as jest.Mock<OpenAuthSession>;

type External = Partial<Record<'apple' | 'google' | 'azure' | 'email', boolean>>;
const realFetch = globalThis.fetch;
let settingsCalls = 0;

/** The public GoTrue settings the sign-in screen reads (`GET /auth/v1/settings`). */
function projectProviders(external: External) {
  settingsCalls = 0;
  globalThis.fetch = jest.fn((url: unknown) => {
    settingsCalls += 1;
    expect(String(url)).toBe('https://project-ref.supabase.test/auth/v1/settings');
    return Promise.resolve(json(200, { external }));
  });
}

let api: ReturnType<typeof installApi>;

function signedOut(): FakeSupabase {
  const fake = installFakeSupabase(null);
  api = installApi({
    'GET /me/bootstrap': () => json(200, ok(bootstrap())),
    'POST /devices/register': () =>
      json(
        200,
        ok({
          installation_id: '00000000-0000-4000-8000-000000000099',
          push_enabled: false,
          rebound_from_other_user: false,
          timezone_applied: true,
        }),
      ),
  });
  return fake;
}

function events(name: string) {
  return bufferedEventsForTests().filter((e) => e.event === name);
}

interface TreeNode {
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: readonly (TreeNode | string)[];
}

/** testIDs of the sign-in methods in render order. */
function methodOrder(): string[] {
  const out: string[] = [];
  const visit = (node: TreeNode) => {
    const id: unknown = node.props.testID;
    if (
      typeof id === 'string' &&
      (id.startsWith('auth.provider.') || id === 'auth.notConfigured') &&
      out.at(-1) !== id
    ) {
      out.push(id);
    }
    for (const child of node.children) if (typeof child !== 'string') visit(child);
  };
  visit(screen.getByTestId('auth.signIn'));
  return out;
}

beforeEach(async () => {
  await resetAppState();
  projectProviders({ apple: true, google: true, azure: true, email: true });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Opens the auth screens the way the app does: the entry resolver sends a first launch to the intro
 * pager (M-ON-01), from which "Hesap Oluştur" leads to sign-up; a returning device goes straight
 * to sign-in.
 */
async function renderAuth() {
  const rendered = await renderApp('/');
  await waitFor(() => {
    expect(rendered.router.getPathname()).not.toBe('/');
  });
  if (rendered.router.getPathname() === '/welcome') {
    await act(async () => {
      appRouter.push('/sign-in?mode=signup');
      await Promise.resolve();
    });
  }
  return rendered;
}

describe('sign-in (M-ON-05)', () => {
  it('orders Apple first on iOS and shows the unconfigured Google client as a disabled row', async () => {
    signedOut();
    const { router } = await renderAuth();
    expect(await screen.findByText('Hesabını oluştur')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-in');
    await waitFor(() => {
      expect(settingsCalls).toBe(1);
    });
    // Google needs the client IDs this environment does not have (external credential).
    expect(methodOrder()).toEqual([
      'auth.provider.apple',
      'auth.notConfigured',
      'auth.provider.microsoft',
      'auth.provider.email',
    ]);
    expect(screen.getByTestId('apple-native-button')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Google ile devam et, Harici kimlik bilgisi gerekli'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Google ile devam et' })).toBeNull();
    expect(events('auth_screen_viewed').at(-1)?.props).toEqual({ mode: 'sign_up' });
  });

  it('turns a provider the project has not enabled into the same disabled row', async () => {
    projectProviders({ apple: true, google: true, azure: false, email: true });
    signedOut();
    await renderAuth();
    expect(
      await screen.findByLabelText('Microsoft ile devam et, Harici kimlik bilgisi gerekli'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Microsoft ile devam et' })).toBeNull();
  });

  it('opens on "Tekrar hoş geldin" for a returning device and toggles to sign-up', async () => {
    signedOut();
    rememberSignIn('microsoft');
    await renderAuth();
    expect(await screen.findByText('Tekrar hoş geldin')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Hesap oluştur'));
    expect(await screen.findByText('Hesabını oluştur')).toBeOnTheScreen();
    expect(events('auth_screen_viewed').map((e) => e.props)).toEqual([
      { mode: 'sign_in' },
      { mode: 'sign_up' },
    ]);
  });

  it('opens the terms and privacy pages in the in-app browser', async () => {
    signedOut();
    await renderAuth();
    await screen.findByText('Hesabını oluştur');
    await fireEvent.press(screen.getByText('Kullanım Koşulları'));
    await fireEvent.press(screen.getByText('Gizlilik Politikası'));
    const opened = (WebBrowser.openBrowserAsync as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(opened.slice(-2)).toEqual([
      expect.stringMatching(/^https:\/\/[^/]+\/terms$/),
      expect.stringMatching(/^https:\/\/[^/]+\/privacy$/),
    ]);
  });

  it('disables every method offline and says why', async () => {
    signedOut();
    onlineManager.setOnline(false);
    await renderAuth();
    expect(await screen.findByText('Giriş için internet bağlantısı gerekli.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Microsoft ile devam et' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'E-posta ile devam et' })).toBeDisabled();
  });

  it('keeps a cancelled browser flow silent and offers "Tekrar Dene" after a failure', async () => {
    const fake = signedOut();
    fake.auth.signInWithOAuth.mockImplementation(() =>
      Promise.resolve({
        data: { provider: 'azure', url: 'https://login.example/authorize' },
        error: null,
      }),
    );
    openAuthSession.mockResolvedValueOnce({ type: 'cancel' });
    await renderAuth();
    await screen.findByText('Hesabını oluştur');

    await fireEvent.press(screen.getByRole('button', { name: 'Microsoft ile devam et' }));
    await waitFor(() => {
      expect(events('auth_failed').at(-1)?.props).toEqual({
        method: 'microsoft',
        code: 'cancelled',
      });
    });
    expect(screen.queryByTestId('auth.error')).toBeNull();

    fake.auth.signInWithOAuth.mockImplementationOnce(() =>
      Promise.resolve({
        data: { provider: 'azure', url: null },
        error: new AuthApiError('Internal error', 500, 'unexpected_failure'),
      }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Microsoft ile devam et' }));
    expect(await screen.findByText('Giriş tamamlanamadı.')).toBeOnTheScreen();
    expect(screen.getByText('Tekrar dene ya da başka bir yöntem seç.')).toBeOnTheScreen();

    openAuthSession.mockResolvedValueOnce({ type: 'dismiss' });
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar Dene' }));
    await waitFor(() => {
      expect(fake.auth.signInWithOAuth).toHaveBeenCalledTimes(3);
    });
    expect(screen.queryByTestId('auth.error')).toBeNull();
  });

  it('signs in with Microsoft through the auth session, registers the device and lands on Today', async () => {
    const fake = signedOut();
    fake.auth.signInWithOAuth.mockImplementation(() =>
      Promise.resolve({
        data: { provider: 'azure', url: 'https://login.example/authorize' },
        error: null,
      }),
    );
    openAuthSession.mockImplementationOnce((_url, redirect) =>
      Promise.resolve({ type: 'success', url: `${redirect}?code=ms-code` }),
    );
    fake.auth.exchangeCodeForSession.mockImplementation(() => {
      fake.setSession(session());
      return Promise.resolve({ data: { user: session().user, session: session() }, error: null });
    });
    const { router } = await renderAuth();
    await screen.findByText('Hesabını oluştur');
    await fireEvent.press(screen.getByRole('button', { name: 'Microsoft ile devam et' }));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/today');
    });
    expect(fake.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'azure',
      options: {
        redirectTo: expect.stringMatching(/auth\/callback$/),
        skipBrowserRedirect: true,
        scopes: 'email',
      },
    });
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('ms-code');
    await waitFor(() => {
      expect(
        api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/devices/register')),
      ).toBe(true);
    });
    expect(events('auth_succeeded').at(-1)?.props).toMatchObject({ method: 'microsoft' });
  });
});

describe('e-mail code (M-ON-05E / M-ON-05V)', () => {
  async function openEmailStep() {
    const rendered = await renderAuth();
    await screen.findByText(/^(Hesabını oluştur|Tekrar hoş geldin)$/);
    await fireEvent.press(screen.getByRole('button', { name: 'E-posta ile devam et' }));
    expect(await screen.findByText('Sana 6 haneli bir giriş kodu göndereceğiz.')).toBeOnTheScreen();
    return rendered;
  }

  async function typeEmail(value: string) {
    await fireEvent.changeText(screen.getByTestId('auth.email.field'), value);
    await fireEvent(screen.getByTestId('auth.email.field'), 'blur');
  }

  it('validates the address, sends a sign-up code in the app language and asks for the code', async () => {
    const fake = signedOut();
    const { router } = await openEmailStep();
    expect(router.getPathname()).toBe('/email-otp');

    await typeEmail('ahmet@');
    expect(screen.getByText('Geçerli bir e-posta adresi gir.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Kod Gönder' })).toBeDisabled();

    await typeEmail(' Ahmet@Example.com ');
    await fireEvent.press(screen.getByRole('button', { name: 'Kod Gönder' }));
    expect(await screen.findByText('Kodu gir')).toBeOnTheScreen();
    expect(fake.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'ahmet@example.com',
      options: { shouldCreateUser: true, data: { locale: 'tr' } },
    });
    expect(screen.getByText(/ahmet@example\.com adresine gönderdiğimiz/i)).toBeOnTheScreen();
    expect(screen.getByText('Tekrar göndermek için 1:00')).toBeOnTheScreen();
    // The address never reaches the URL.
    expect(JSON.stringify(router.getSearchParams())).not.toContain('example.com');
    expect(events('auth_otp_requested').at(-1)?.props).toEqual({ mode: 'sign_up' });
  });

  it('offers "Hesap Oluştur" when sign-in mode finds no account, and resends as sign-up', async () => {
    const fake = signedOut();
    rememberSignIn('email_otp');
    fake.auth.signInWithOtp.mockImplementationOnce(() =>
      Promise.resolve({
        data: {},
        error: new AuthApiError('Signups not allowed for otp', 422, 'otp_disabled'),
      }),
    );
    await openEmailStep();
    await typeEmail('yeni@example.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Kod Gönder' }));
    expect(await screen.findByText('Bu e-postayla kayıtlı bir hesap bulamadık.')).toBeOnTheScreen();
    expect(fake.auth.signInWithOtp).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ shouldCreateUser: false }) }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Hesap Oluştur' }));
    expect(await screen.findByText('Kodu gir')).toBeOnTheScreen();
    expect(fake.auth.signInWithOtp).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ shouldCreateUser: true }) }),
    );
  });

  it('says a wrong code is wrong, clears it, and signs in with the right one', async () => {
    const fake = signedOut();
    fake.auth.verifyOtp
      .mockImplementationOnce(() =>
        Promise.resolve({
          data: { user: null, session: null },
          error: new AuthApiError('Token has expired or is invalid', 403, 'otp_expired'),
        }),
      )
      .mockImplementationOnce(() => {
        fake.setSession(session());
        return Promise.resolve({ data: { user: session().user, session: session() }, error: null });
      });
    const { router } = await openEmailStep();
    await typeEmail('ahmet@example.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Kod Gönder' }));
    await screen.findByText('Kodu gir');

    await fireEvent.changeText(screen.getByTestId('auth.code.input'), '123456');
    expect(await screen.findByText('Kod hatalı. Tekrar dene.')).toBeOnTheScreen();
    expect(screen.getByTestId('auth.code.input').props.value).toBe('');
    expect(events('auth_otp_failed').at(-1)?.props).toEqual({ code: 'invalid' });

    await fireEvent.changeText(screen.getByTestId('auth.code.input'), '65 43 21');
    await waitFor(() => {
      expect(router.getPathname()).toBe('/today');
    });
    expect(fake.auth.verifyOtp).toHaveBeenLastCalledWith({
      email: 'ahmet@example.com',
      token: '654321',
      type: 'email',
    });
  });

  it('lets the code be resent only after the 60-second cooldown', async () => {
    const fake = signedOut();
    await openEmailStep();
    await typeEmail('ahmet@example.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Kod Gönder' }));
    await screen.findByText('Kodu gir');
    expect(screen.queryByRole('button', { name: 'Kodu tekrar gönder' })).toBeNull();
    for (let i = 0; i < 60; i += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
    }
    await fireEvent.press(await screen.findByRole('button', { name: 'Kodu tekrar gönder' }));
    await waitFor(() => {
      expect(fake.auth.signInWithOtp).toHaveBeenCalledTimes(2);
    });
    expect(events('auth_otp_resent')).toHaveLength(1);
    expect(await screen.findByText('Tekrar göndermek için 1:00')).toBeOnTheScreen();
  });
});
