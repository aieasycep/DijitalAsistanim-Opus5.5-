import type { PublicRouteKey } from '../../src/public/routes.ts';
import type { PricingDisplay } from '../../src/public/schemas.ts';
import { B64_32, TS, ok, uuid } from './samples.ts';
import type { RouteFixture } from './types.ts';

export const pricing: PricingDisplay = {
  storefront: 'TR',
  currency: 'TRY',
  as_of: '2026-09-01',
  verified: true,
  monthly: { app_store: 199.99, play: 209.99 },
  annual: { app_store: 1799.99, play: 1799.99 },
  intro_offer: null,
};

export const publicFixtures = {
  'POST /support': {
    valid: {
      body: {
        email: 'yunus@example.com',
        category: 'billing',
        message: 'Aboneliğim görünmüyor.',
        locale: 'tr',
        website: '',
      },
      response: ok({ reference: 'DA-2026-000123' }),
    },
    invalid: [
      {
        part: 'body',
        why: 'honeypot filled',
        value: {
          email: 'a@b.co',
          category: 'other',
          message: 'Yardım lazım lütfen.',
          locale: 'tr',
          website: 'spam',
        },
      },
      {
        part: 'body',
        why: 'unknown locale',
        value: {
          email: 'a@b.co',
          category: 'other',
          message: 'Yardım lazım lütfen.',
          locale: 'de',
        },
      },
      { part: 'response', why: 'reference format', value: ok({ reference: 'ticket-1' }) },
    ],
  },
  'POST /data-deletion/start': {
    valid: {
      body: { email: 'yunus@example.com', locale: 'tr' },
      response: ok({ status: 'code_sent_if_account_exists' }),
    },
    invalid: [
      { part: 'body', why: 'email malformed', value: { email: 'yunus', locale: 'tr' } },
      {
        part: 'response',
        why: 'never reveals whether an account exists',
        value: ok({ status: 'code_sent' }),
      },
    ],
  },
  'POST /data-deletion/verify': {
    valid: {
      body: { email: 'yunus@example.com', code: '123456', confirmation: 'DELETE', locale: 'en' },
      response: ok({
        reference: 'DEL-1',
        request_id: uuid(81),
        status: 'queued',
        status_token: B64_32,
        subscription_notice: { active: true },
      }),
    },
    invalid: [
      {
        part: 'body',
        why: 'code must be 6 digits',
        value: { email: 'yunus@example.com', code: '12345', confirmation: 'SİL', locale: 'tr' },
      },
      {
        part: 'body',
        why: 'confirmation token mismatch',
        value: { email: 'yunus@example.com', code: '123456', confirmation: 'yes', locale: 'tr' },
      },
      {
        part: 'response',
        why: 'status token malformed',
        value: ok({
          reference: 'DEL-1',
          request_id: uuid(81),
          status: 'queued',
          status_token: 'abc',
          subscription_notice: { active: false },
        }),
      },
    ],
  },
  'GET /referrals/:code': {
    valid: {
      params: { code: 'AB3K7M9Q' },
      response: ok({
        valid: true,
        reward_days: 14,
        apply_window_days: 7,
        store_urls: {
          ios: 'https://apps.apple.com/app/id1234567890',
          android:
            'https://play.google.com/store/apps/details?id=com.dijitalasistan.app&referrer=code%3DAB3K7M9Q',
        },
        deep_link: 'dijitalasistan://settings/referral?code=AB3K7M9Q',
        message_key: 'referral.landing',
      }),
    },
    invalid: [
      { part: 'params', why: 'ambiguous alphabet', value: { code: 'IOL01X' } },
      {
        part: 'response',
        why: 'referrer identity is never exposed',
        value: ok({
          valid: true,
          reward_days: 14,
          apply_window_days: 7,
          store_urls: { ios: 'https://a.test', android: 'https://b.test' },
          deep_link: 'dijitalasistan://settings/referral?code=AB3K7M9Q',
          message_key: 'referral.landing',
          referrer_name: 'Ahmet',
        }),
      },
    ],
  },
  'GET /plans': {
    valid: {
      response: ok({
        free: { mail_accounts: 1, calendars: 1, ai_analyses_per_day: 50 },
        pro: { mail_accounts: 'multiple', calendars: 'multiple', ai_policy: 'fair_use' },
        pricing,
        updated_at: TS,
      }),
    },
    invalid: [
      {
        part: 'response',
        why: 'Pro is fair use only',
        value: ok({
          free: { mail_accounts: 1, calendars: 1, ai_analyses_per_day: 50 },
          pro: { mail_accounts: 'multiple', calendars: 'multiple', ai_policy: 'none' },
          pricing: null,
          updated_at: TS,
        }),
      },
      {
        part: 'response',
        why: 'pricing storefront is TR',
        value: ok({
          free: { mail_accounts: 1, calendars: 1, ai_analyses_per_day: 50 },
          pro: { mail_accounts: 'multiple', calendars: 'multiple', ai_policy: 'fair_use' },
          pricing: { ...pricing, storefront: 'US' },
          updated_at: TS,
        }),
      },
    ],
  },
  'POST /web-events': {
    valid: {
      body: {
        event: 'web_cta_click',
        page: '/pricing',
        locale: 'tr',
        device_class: 'mobile',
        theme: 'light',
        props: { cta: 'app_store', placement: 'hero' },
      },
      response: undefined,
    },
    invalid: [
      {
        part: 'body',
        why: 'page carries a query string',
        value: {
          event: 'web_page_view',
          page: '/r/AB3K7M?utm=1',
          locale: 'tr',
          device_class: 'desktop',
          theme: 'dark',
        },
      },
      {
        part: 'body',
        why: 'event not snake_case',
        value: {
          event: 'WebPageView',
          page: '/',
          locale: 'tr',
          device_class: 'desktop',
          theme: 'dark',
        },
      },
      { part: 'response', why: '204 has no body', value: { accepted: true } },
    ],
  },
  'GET /data-deletion/:requestId/status': {
    valid: {
      params: { requestId: uuid(81) },
      query: { token: B64_32 },
      response: ok({
        reference: 'DEL-1',
        kind: 'account',
        status: 'processing',
        requested_at: TS,
        completed_at: null,
        steps_public: {
          provider_revoke: 'done',
          storage_purged: 'pending',
          db_purged: 'pending',
          auth_user_deleted: 'pending',
        },
      }),
    },
    invalid: [
      { part: 'query', why: 'token required', value: {} },
      {
        part: 'response',
        why: 'no identifiers in the public status',
        value: ok({
          reference: 'DEL-1',
          kind: 'account',
          status: 'completed',
          requested_at: TS,
          completed_at: TS,
          steps_public: {
            provider_revoke: 'done',
            storage_purged: 'done',
            db_purged: 'done',
            auth_user_deleted: 'done',
          },
          email: 'yunus@example.com',
        }),
      },
    ],
  },
  'POST /support/inbound-email': {
    valid: {
      body: {
        from: 'yunus@example.com',
        to: 'support+DA-7K3M9Q@mail.dijitalasistan.app',
        subject: 'Re: Destek',
        text: 'Teşekkürler, çözüldü.',
        message_id: '<abc@example.com>',
        attachments: [],
      },
      response: { ok: true },
    },
    invalid: [
      {
        part: 'body',
        why: 'message id required',
        value: { from: 'a@b.co', to: 'support@x', subject: 's', text: 't' },
      },
      { part: 'response', why: 'ack is ok:true', value: { ok: false } },
    ],
  },
} satisfies Record<PublicRouteKey, RouteFixture>;
