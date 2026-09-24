/**
 * Shared setup for the Flow / Mail / Reply / Commitments / Plan / Meeting screen tests: a signed-in
 * user (Free or Pro), the real API client over scripted routes and the PostgREST / RPC double.
 */
import type { BootstrapData } from '@da/validation/api/bootstrap';

import { installApi, installFakeSupabase, json, type Responder } from '../helpers/app';
import { bootstrap, ok, session, TS, uuid } from '../helpers/fixtures';
import type { DataRoutes } from '../helpers/supabase-data';
import { bufferedEventsForTests } from '../../src/lib/events';

export interface SetupOptions {
  readonly pro?: boolean;
  readonly api?: Readonly<Record<string, Responder>>;
  readonly data?: DataRoutes;
  readonly bootstrap?: Partial<BootstrapData>;
}

export function setup(options: SetupOptions = {}) {
  const base = bootstrap(options.bootstrap);
  const data: BootstrapData = options.pro
    ? { ...base, entitlement: { ...base.entitlement, is_active: true, source: 'store' } }
    : base;
  const fake = installFakeSupabase(session());
  fake.data.set(options.data ?? {});
  const api = installApi({ 'GET /me/bootstrap': () => json(200, ok(data)), ...options.api });
  return { fake, api };
}

export const okJson =
  (body: unknown, status = 200) =>
  () =>
    json(status, ok(body));

export function events(name: string) {
  return bufferedEventsForTests().filter((e) => e.event === name);
}

export const SOURCE = {
  source_type: 'email_message',
  source_id: uuid(90),
  source_provider: 'google',
  source_timestamp: TS,
  label: 'Gmail · Mehmet Yılmaz · 08:42',
};

/** A pending `commitment_create` approval (internal record, approved in place). */
export function commitmentApproval(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(n),
    action_type: 'commitment_create',
    status: 'pending',
    payload_version: 1,
    idempotency_key: `approval:${uuid(n)}:v1`,
    type_label_key: 'approvals.type.commitment_create',
    what: { title: 'Teklif gönder', summary: 'Taahhüt olarak kaydedilir.' },
    why: { text: 'Toplantı notundan çıktı.', reason_code: 'post_meeting' },
    source: null,
    exact_change: { kind: 'create', fields: [] },
    destination: {
      target_kind: 'in_app',
      provider: 'in_app',
      account_label: null,
      container_label: null,
    },
    side_effects: [{ code: 'internal_record', text: 'Taahhütlerine eklenir.' }],
    scope_status: { state: 'not_applicable' },
    requires_confirmation: false,
    pro_required: true,
    origin: 'post_meeting',
    origin_ref_id: null,
    executor: 'server',
    device_installation_id: null,
    batch_id: null,
    created_at: TS,
    approval_expires_at: '2026-09-30T08:00:00Z',
    approved_at: null,
    rejected_at: null,
    approved_via: null,
    executed_at: null,
    result: null,
    failure: null,
    ...overrides,
  };
}

/** `POST /approvals/:id/approve` answer for a server-executed approval. */
export function approved(view: Record<string, unknown>) {
  return {
    approval: {
      ...view,
      status: 'executed',
      approved_via: 'in_place',
      approved_at: TS,
      executed_at: TS,
    },
    job: null,
    execution: { mode: 'server', device_token: null, instructions: null },
  };
}
