/**
 * EF-NTF-01 (= TST-EF-12, UT-NTF-13): the §2.12 renderer applied server-side over every push
 * template and variant — `title_only` and `generic` never carry a sensitive parameter (names,
 * subjects, amounts), the data payload is exactly `{type, entity_id, deeplink}` and stays < 1 KB;
 * channel and interruption level per R-12.
 */
import { assert, assertEquals } from '@std/assert';
import { NOTIFICATION_CATEGORY_VALUES } from '@da/domain';
import trPush from '@da/i18n/messages/tr/push.json' with { type: 'json' };
import { baseSpec, parseTemplateKey } from './create.ts';
import { deliveryOf, renderNotification } from './render.ts';

const TEMPLATES = new Set<string>([...NOTIFICATION_CATEGORY_VALUES, 'weekly', 'reminder']);
const ENTITY = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function argNames(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] ?? '');
}

type Tree = Record<string, Record<string, Record<string, { title: string; body: string }>>>;

Deno.test(
  'EF-NTF-01 every template: no sensitive text below full, payload keys exact and < 1 KB',
  () => {
    const tree = trPush as unknown as Tree;
    let checked = 0;
    for (const [template, variants] of Object.entries(tree)) {
      if (!TEMPLATES.has(template)) continue;
      for (const [variant, modes] of Object.entries(variants)) {
        const full = modes.full;
        if (full === undefined) continue;
        parseTemplateKey(`${template}.${variant}`);
        const sensitive = Object.fromEntries(
          [...argNames(full.title), ...argNames(full.body)].map((name) => [name, `GIZLI_${name}`]),
        );
        const publicNames = [
          ...argNames(modes.title_only?.title ?? ''),
          ...argNames(modes.title_only?.body ?? ''),
        ].filter((name) => !(name in sensitive));
        const spec = baseSpec({
          category:
            template === 'weekly'
              ? 'evening'
              : template === 'reminder'
                ? 'deadline'
                : (template as 'meeting'),
          dedupeKey: `k:${template}:${variant}`,
          template: template as 'meeting',
          variant,
          urgency: 'today',
          entityType: 'calendar_event',
          entityId: ENTITY,
          deeplink: 'dijitalasistan://today',
          paramsPublic: Object.fromEntries(publicNames.map((n) => [n, 2])),
          paramsSensitive: sensitive,
        });
        for (const mode of ['title_only', 'generic'] as const) {
          const out = renderNotification(spec, mode, 'tr');
          const text = `${out.title} ${out.body}`;
          assert(!text.includes('GIZLI_'), `${template}.${variant}.${mode}: ${text}`);
          assertEquals(Object.keys(out.data).sort(), ['deeplink', 'entity_id', 'type']);
          assert(new TextEncoder().encode(JSON.stringify(out)).length < 1024);
          assert(out.title.length > 0 && out.title.length <= 120);
          assert(out.body.length <= 240);
        }
        const generic = renderNotification(spec, 'generic', 'tr');
        assertEquals(generic.title, 'Dijital Asistan');
        checked++;
      }
    }
    assert(checked >= 20, `checked ${checked}`);
  },
);

Deno.test(
  'UT-NTF-14 channels and interruption: reminders time-sensitive, post-meeting passive',
  () => {
    const reminder = baseSpec({
      category: 'deadline',
      dedupeKey: 'r',
      template: 'reminder',
      variant: 'local',
      urgency: 'today',
      kind: 'user_reminder',
    });
    assertEquals(deliveryOf(reminder).channelId, 'reminders');
    assertEquals(deliveryOf(reminder).interruption, 'time_sensitive');
    const critical = baseSpec({
      category: 'critical_email',
      dedupeKey: 'c',
      template: 'critical_email',
      variant: 'reply_needed',
      urgency: 'urgent',
    });
    assertEquals(deliveryOf(critical).channelId, 'critical_email');
    assertEquals(deliveryOf(critical).priority, 'high');
    const morning = baseSpec({
      category: 'morning',
      dedupeKey: 'm',
      template: 'morning',
      variant: 'ready',
      urgency: 'today',
    });
    assertEquals(deliveryOf(morning).channelId, 'briefings');
    const weekly = baseSpec({
      category: 'evening',
      dedupeKey: 'w',
      template: 'weekly',
      variant: 'ready',
      urgency: 'today',
    });
    assertEquals(deliveryOf(weekly).channelId, 'briefings');
    const post = baseSpec({
      category: 'meeting',
      dedupeKey: 'p',
      template: 'meeting',
      variant: 'post',
      urgency: 'today',
      interruption: 'passive',
    });
    assertEquals(deliveryOf(post).interruption, 'passive');
    assertEquals(deliveryOf(post).channelId, 'meetings');
  },
);

Deno.test('user test pushes prefix the title except in generic', () => {
  const spec = baseSpec({
    category: 'critical_email',
    dedupeKey: 't',
    template: 'critical_email',
    variant: 'reply_needed',
    urgency: 'urgent',
    userTest: true,
    isTest: true,
  });
  const titled = renderNotification(spec, 'title_only', 'tr').title;
  assert(titled !== 'Önemli e-posta' && titled.includes('Önemli e-posta'));
  assertEquals(renderNotification(spec, 'generic', 'tr').title, 'Dijital Asistan');
});
