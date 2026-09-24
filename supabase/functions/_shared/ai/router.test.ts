import { assert, assertEquals } from '@std/assert';
import { jsonResponse, stubFetch } from '../testing/fetch.ts';
import { testDb } from '../testing/db.ts';
import {
  resolveRoute,
  type RouterDeps,
  staticModelConfigSource,
  supabaseBreakerSource,
  supabaseModelConfigSource,
  supabaseProfileSource,
} from './router.ts';
import { allFlags, configRow } from '../testing/ai.ts';
import type { ModelConfigRow, ProviderId, RouteDecision } from './types.ts';

function deps(
  rows: ModelConfigRow[],
  options: { available?: ProviderId[]; open?: string[] } = {},
): RouterDeps {
  const available = new Set(options.available ?? ['anthropic', 'openai', 'voyage']);
  return {
    configs: staticModelConfigSource(rows),
    providerAvailable: (p) => available.has(p),
    breakers: { isOpen: (p, m) => Promise.resolve((options.open ?? []).includes(`${p}|${m}`)) },
  };
}

function chainOf(decision: RouteDecision): string[] {
  return decision.kind === 'route'
    ? decision.route.chain.map((t) => `${t.provider}|${t.model}`)
    : [`t0:${decision.reason}`];
}

Deno.test(
  'the route follows ai_model_config: primary then fallbacks, with config id, version and cache TTL',
  async () => {
    const decision = await resolveRoute(deps([configRow()]), {
      feature: 'thread_summary',
      profile: 'balanced',
      flags: allFlags(),
    });
    assertEquals(chainOf(decision), ['anthropic|primary-model', 'openai|fallback-model']);
    assert(decision.kind === 'route');
    assertEquals(decision.route.configId, 'cfg-1');
    assertEquals(decision.route.configVersion, 3);
    assertEquals(decision.route.cacheTtl, '5m');
    assertEquals(decision.route.maxInputTokens, 4000);
  },
);

Deno.test(
  'changing the config row changes the route without code changes (profile and role selection)',
  async () => {
    const rows = [
      configRow({ id: 'a', profile: 'lean', model: 'lean-model', fallback_targets: [] }),
      configRow({ id: 'b', role: 'classifier', provider: 'openai', model: 'classifier-model' }),
      configRow(),
    ];
    assertEquals(
      chainOf(
        await resolveRoute(deps(rows), {
          feature: 'thread_summary',
          profile: 'lean',
          flags: allFlags(),
        }),
      ),
      ['anthropic|lean-model'],
    );
    assertEquals(
      chainOf(
        await resolveRoute(deps(rows), {
          feature: 'thread_summary',
          profile: 'balanced',
          role: 'classifier',
          flags: allFlags(),
        }),
      )[0],
      'openai|classifier-model',
    );
  },
);

Deno.test('kill switches force T0: global, per feature, missing or disabled config', async () => {
  const d = deps([configRow(), configRow({ feature: 'weekly_review', enabled: false })]);
  assertEquals(
    chainOf(
      await resolveRoute(d, {
        feature: 'thread_summary',
        profile: 'balanced',
        flags: allFlags('thread_summary', { 'ai.global.enabled': false }),
      }),
    ),
    ['t0:kill_switch'],
  );
  assertEquals(
    chainOf(
      await resolveRoute(d, {
        feature: 'thread_summary',
        profile: 'balanced',
        flags: allFlags('thread_summary', { 'ai.feature.thread_summary': false }),
      }),
    ),
    ['t0:feature_disabled'],
  );
  assertEquals(
    chainOf(
      await resolveRoute(d, {
        feature: 'meeting_prep',
        profile: 'balanced',
        flags: allFlags('meeting_prep'),
      }),
    ),
    ['t0:not_configured'],
  );
  assertEquals(
    chainOf(
      await resolveRoute(d, {
        feature: 'weekly_review',
        profile: 'balanced',
        flags: allFlags('weekly_review'),
      }),
    ),
    ['t0:feature_disabled'],
  );
});

Deno.test(
  'a disabled provider switch falls back to the next provider; nothing usable is T0 no_target',
  async () => {
    const d = deps([configRow()]);
    const decision = await resolveRoute(d, {
      feature: 'thread_summary',
      profile: 'balanced',
      flags: allFlags('thread_summary', { 'ai.provider.anthropic.enabled': false }),
    });
    assertEquals(chainOf(decision), ['openai|fallback-model']);
    assert(decision.kind === 'route');
    assertEquals(decision.route.skipped, [
      { provider: 'anthropic', model: 'primary-model', reason: 'provider_disabled' },
    ]);
    assertEquals(
      chainOf(
        await resolveRoute(d, {
          feature: 'thread_summary',
          profile: 'balanced',
          flags: allFlags('thread_summary', {
            'ai.provider.anthropic.enabled': false,
            'ai.provider.openai.enabled': false,
          }),
        }),
      ),
      ['t0:no_target'],
    );
  },
);

Deno.test('missing credentials and open breakers drop targets', async () => {
  const noAnthropic = await resolveRoute(deps([configRow()], { available: ['openai'] }), {
    feature: 'thread_summary',
    profile: 'balanced',
    flags: allFlags(),
  });
  assertEquals(chainOf(noAnthropic), ['openai|fallback-model']);
  const breaker = await resolveRoute(deps([configRow()], { open: ['openai|fallback-model'] }), {
    feature: 'thread_summary',
    profile: 'balanced',
    flags: allFlags(),
  });
  assertEquals(chainOf(breaker), ['anthropic|primary-model']);
});

Deno.test(
  'large-model switch rewrites a T2 primary; escalation needs both large and escalation flags',
  async () => {
    const row = configRow({
      tier: 't2',
      escalation_target: { provider: 'anthropic', model: 'escalation-model' },
    });
    const off = await resolveRoute(deps([row]), {
      feature: 'thread_summary',
      profile: 'balanced',
      flags: allFlags('thread_summary', {
        'ai.model.large.enabled': false,
        'ai.model.opus_escalation': true,
      }),
    });
    assertEquals(chainOf(off), ['openai|fallback-model']);
    assert(off.kind === 'route');
    assertEquals(off.route.escalation, null);
    const on = await resolveRoute(deps([row]), {
      feature: 'thread_summary',
      profile: 'balanced',
      flags: allFlags('thread_summary', { 'ai.model.opus_escalation': true }),
    });
    assert(on.kind === 'route');
    assertEquals(on.route.escalation?.model, 'escalation-model');
  },
);

Deno.test(
  'supabase sources: config rows cached for 60 s, breaker via private.ai_breaker_state, profile from plan_limits',
  async () => {
    let t = 0;
    const stub = stubFetch((call) => {
      if (call.url.includes('/ai_model_config')) return jsonResponse([configRow()]);
      if (call.url.includes('/rpc/ai_breaker_state')) return jsonResponse({ open: true });
      return jsonResponse([
        { plan: 'free', value: 'lean' },
        { plan: 'pro', value: 'balanced' },
      ]);
    });
    const client = testDb(stub.fetch);
    const configs = supabaseModelConfigSource(client, { now: () => t });
    assertEquals((await configs.get('balanced', 'thread_summary'))?.model, 'primary-model');
    await configs.get('balanced', 'thread_summary');
    assertEquals(stub.calls.filter((c) => c.url.includes('/ai_model_config')).length, 1);
    t = 60_000;
    await configs.get('balanced', 'thread_summary');
    assertEquals(stub.calls.filter((c) => c.url.includes('/ai_model_config')).length, 2);

    const breakers = supabaseBreakerSource(client);
    assert(await breakers.isOpen('anthropic', 'primary-model'));
    const breakerCall = stub.calls.find((c) => c.url.includes('/rpc/ai_breaker_state'));
    assertEquals(breakerCall?.headers.get('Content-Profile'), 'private');

    const profiles = supabaseProfileSource(client, (id) => Promise.resolve(id === 'pro-user'));
    assertEquals(await profiles.profile('pro-user'), 'balanced');
    assertEquals(await profiles.profile('free-user'), 'lean');
    assertEquals(await profiles.profile(null), 'balanced');
  },
);
