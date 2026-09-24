/**
 * T-8.04 app shell, end to end on the real `app/` routes: entry resolution and guards, the four
 * tabs with their bootstrap-driven states, the blocking screens, not-found, deep-link replay and
 * the two callbacks.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { registerOAuthCompletionHandler } from '../src/features/integrations/IntegrationCallbackScreen';
import { bufferedEventsForTests } from '../src/lib/events';
import { savePendingLink } from '../src/lib/deeplinks';
import { installApi, json, renderApp, resetAppState, installFakeSupabase } from './helpers/app';
import { bootstrap, errorBody, ok, session } from './helpers/fixtures';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

function signedIn(data = bootstrap()) {
  installFakeSupabase(session());
  return installApi({ 'GET /me/bootstrap': () => json(200, ok(data)) });
}

function events(name: string) {
  return bufferedEventsForTests().filter((e) => e.event === name);
}

beforeEach(async () => {
  await resetAppState();
});

describe('entry and guards', () => {
  it('lands a signed-in, onboarded user on Today behind the tab bar', async () => {
    signedIn();
    const { router } = await renderApp('/');
    expect(await screen.findByText('Her şey kontrol altında.')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/today');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t): unknown => t.props.accessibilityLabel)).toEqual([
      'Bugün, sekme 1/4',
      'Akış, sekme 2/4',
      'Plan, sekme 3/4',
      'Asistan, sekme 4/4',
    ]);
    expect(tabs[0]?.props.accessibilityState).toMatchObject({ selected: true });
    expect(events('entry_resolved').at(-1)?.props).toEqual({ target: 'today' });
  });

  it('keeps the launch view for an onboarding step whose screen is not in this build', async () => {
    signedIn(
      bootstrap({
        profile: {
          ...bootstrap().profile,
          onboarding: { step: 'personalization', completed_at: null },
        },
      }),
    );
    const { router } = await renderApp('/');
    await waitFor(() => {
      expect(events('entry_resolved').at(-1)?.props).toEqual({
        target: 'onboarding_step',
        step: 'personalization',
      });
    });
    expect(router.getPathname()).toBe('/');
    expect(screen.getByTestId('launch-screen')).toBeOnTheScreen();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('routes an unsupported version to the blocking update screen', async () => {
    signedIn(bootstrap({ config: { ...bootstrap().config, upgrade_required: true } }));
    const { router } = await renderApp('/');
    expect(await screen.findByText('Yeni bir sürüm gerekli.')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/update-required');
    expect(screen.getByRole('button', { name: 'Güncelle' })).toBeOnTheScreen();
    expect(events('update_required_shown').at(-1)?.props).toEqual({ current: 10000, min: 10000 });
  });

  it('shows a disabled account its state with support and sign-out, never the app', async () => {
    const fake = installFakeSupabase(session());
    installApi({
      'GET /me/bootstrap': () => json(200, ok(bootstrap({ account_state: 'disabled' }))),
    });
    await renderApp('/');
    expect(
      await screen.findByText('Hesabın geçici olarak devre dışı. Destek ile iletişime geç.'),
    ).toBeOnTheScreen();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıkış Yap' }));
    await waitFor(() => {
      expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });
    expect(await screen.findByText('Hesabını oluştur')).toBeOnTheScreen();
  });

  it('shows the error screen with retry when bootstrap fails without a cached copy', async () => {
    installFakeSupabase(session());
    let fail = true;
    installApi({
      'GET /me/bootstrap': () =>
        fail ? json(403, errorBody('FORBIDDEN')) : json(200, ok(bootstrap())),
    });
    const { router } = await renderApp('/');
    expect(await screen.findByText('Bir şeyler ters gitti.')).toBeOnTheScreen();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar Dene' }));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/today');
    });
  });

  it('shows the offline screen when offline without a cached bootstrap', async () => {
    installFakeSupabase(session());
    installApi({ 'GET /me/bootstrap': () => json(200, ok(bootstrap())) });
    onlineManager.setOnline(false);
    await renderApp('/');
    expect(await screen.findByText('İnternet bağlantısı yok.')).toBeOnTheScreen();
  });

  it('replays a link stored while the guards blocked it once Today is reached', async () => {
    signedIn();
    savePendingLink('/plan');
    const { router } = await renderApp('/');
    await waitFor(() => {
      expect(router.getPathname()).toBe('/plan');
    });
    expect(await screen.findByText('Bugün takvimin oldukça sakin.')).toBeOnTheScreen();
  });

  it('stores a deep link that arrives before the session is known and replays it', async () => {
    signedIn();
    const { router } = await renderApp('/assistant');
    await waitFor(() => {
      expect(router.getPathname()).toBe('/assistant');
    });
    expect(events('deep_link_opened')[0]?.props).toEqual({
      route_pattern: '/assistant',
      source: 'link',
      guarded: true,
    });
  });
});

describe('tabs', () => {
  it('switches tabs, keeps them in the bar and records tab_selected', async () => {
    signedIn();
    const { router } = await renderApp('/');
    await screen.findByText('Her şey kontrol altında.');
    await fireEvent.press(screen.getByRole('tab', { name: 'Plan, sekme 3/4' }));
    expect(router.getPathname()).toBe('/plan');
    expect(await screen.findByText('Bugün takvimin oldukça sakin.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: 'Plan, sekme 3/4' }));
    expect(router.getPathname()).toBe('/plan');
    expect(events('tab_selected').map((e) => e.props)).toEqual([
      { tab: 'plan', reselect: false },
      { tab: 'plan', reselect: true },
    ]);
  });

  it('takes the Today empty-state CTA to the Flow tab', async () => {
    signedIn();
    const { router } = await renderApp('/');
    await screen.findByText('Her şey kontrol altında.');
    await fireEvent.press(screen.getByRole('button', { name: 'Akışa göz at' }));
    expect(router.getPathname()).toBe('/flow');
    expect(await screen.findByText('Bu filtrede şu an bir şey yok.')).toBeOnTheScreen();
  });

  it('shows the connect state without a dead CTA while the accounts screen does not exist', async () => {
    signedIn(bootstrap({ accounts: [] }));
    await renderApp('/');
    expect(await screen.findByText('Mailini bağla.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Hesap Bağla' })).toBeNull();
    // Nor an avatar: `/settings` has no screen yet.
    expect(screen.queryByLabelText('Profil ve ayarlar')).toBeNull();
  });

  it('shows the Assistant tab the server-reported unavailability honestly', async () => {
    signedIn(
      bootstrap({
        service_status: {
          unavailable_features: [{ feature: 'assistant', reason: 'external_credential_required' }],
        },
      }),
    );
    const { router } = await renderApp('/');
    await screen.findByText('Her şey kontrol altında.');
    await fireEvent.press(screen.getByRole('tab', { name: 'Asistan, sekme 4/4' }));
    expect(router.getPathname()).toBe('/assistant');
    expect(
      await screen.findByLabelText(
        'Bu özellik bu ortamda yapılandırılmamış (harici kimlik bilgisi gerekli).',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Ne öğrenmek istersin?')).toBeOnTheScreen();
  });

  it('asks for a calendar on Plan when no account granted calendar access', async () => {
    const mailOnly = bootstrap().accounts.map((a) => ({
      ...a,
      capabilities_granted: ['mail_read' as const],
    }));
    signedIn(bootstrap({ accounts: mailOnly }));
    await renderApp('/');
    await screen.findByText('Her şey kontrol altında.');
    await fireEvent.press(screen.getByRole('tab', { name: 'Plan, sekme 3/4' }));
    expect(await screen.findByText('Takvimini bağla.')).toBeOnTheScreen();
  });
});

describe('not found, demo and callbacks', () => {
  it('sends unknown links to not-found with "Bugün\'e Dön"', async () => {
    signedIn();
    const { router } = await renderApp('/does/not/exist');
    expect(await screen.findByText('Bu sayfa bulunamadı.')).toBeOnTheScreen();
    expect(events('not_found_shown').at(-1)?.props).toEqual({ path_pattern: 'unknown' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: "Bugün'e Dön" })).toBeOnTheScreen();
    });
    await fireEvent.press(screen.getByRole('button', { name: "Bugün'e Dön" }));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/today');
    });
  });

  it('refuses the demo setup route outside demo builds', async () => {
    signedIn();
    await renderApp('/demo/setup?scenario=standard');
    expect(await screen.findByText('Bu sayfa bulunamadı.')).toBeOnTheScreen();
    expect(screen.queryByTestId('demo.setup.working')).toBeNull();
  });

  it('shows the declined state for a denied integration consent', async () => {
    signedIn();
    await renderApp('/integrations/callback?provider=google&result=denied');
    expect(await screen.findByText('Erişim izni reddedildi.')).toBeOnTheScreen();
  });

  it('never marks anything connected from the redirect alone', async () => {
    signedIn();
    const code = 'A'.repeat(43);
    await renderApp(
      `/integrations/callback?provider=google&result=pending_confirmation&completion_code=${code}`,
    );
    expect(await screen.findByText('Bağlantı tamamlanamadı.')).toBeOnTheScreen();
  });

  it('hands a pending confirmation to the registered completion step (T-8.07)', async () => {
    signedIn();
    const complete = jest.fn(() => Promise.resolve({ href: '/plan' }));
    registerOAuthCompletionHandler(complete);
    const code = 'B'.repeat(43);
    const { router } = await renderApp(
      `/oauth/done?provider=microsoft&result=pending_confirmation&completion_code=${code}`,
    );
    await waitFor(() => {
      expect(router.getPathname()).toBe('/plan');
    });
    registerOAuthCompletionHandler(null);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'microsoft', completionCode: code }),
    );
  });

  it('finishes a sign-in whose auth session was lost on the auth callback', async () => {
    const fake = installFakeSupabase(null);
    installApi({
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
    fake.auth.exchangeCodeForSession.mockImplementation(() => {
      fake.setSession(session());
      return Promise.resolve({ data: { user: session().user, session: session() }, error: null });
    });
    const { router } = await renderApp('/auth/callback?code=lost-session-code');
    await waitFor(() => {
      expect(router.getPathname()).toBe('/today');
    });
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('lost-session-code');
    expect(within(screen.getByTestId('shell.tabBar')).getAllByRole('tab')).toHaveLength(4);
  });
});
