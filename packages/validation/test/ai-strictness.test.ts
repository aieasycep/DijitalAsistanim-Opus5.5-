import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AI_SCHEMAS,
  AI_SCHEMA_NAMES,
  toWireJsonSchema,
  wireRuleViolations,
} from '../src/ai/index.ts';

/**
 * Cross-provider wire rules (AI_PIPELINE_PLAN §4.1): every object closed, every property required,
 * nesting depth ≤ 4, no length/range/pattern/format bounds, no minItems > 1, unions discriminated.
 */
type Node = Record<string, unknown>;

function walk(node: Node, visit: (node: Node, depth: number) => void, depth = 0): void {
  const isObject = node.type === 'object';
  const next = isObject ? depth + 1 : depth;
  visit(node, next);
  for (const child of Object.values((node.properties as Record<string, Node> | undefined) ?? {}))
    walk(child, visit, next);
  if (typeof node.items === 'object' && node.items !== null) walk(node.items as Node, visit, next);
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = node[key];
    if (Array.isArray(branches))
      (branches as Node[]).forEach((b) => {
        walk(b, visit, depth);
      });
  }
}

describe.each(AI_SCHEMA_NAMES)('%s wire strictness', (name) => {
  const json = z.toJSONSchema(AI_SCHEMAS[name].schema) as Node;

  it('closes every object and requires every property', () => {
    walk(json, (node) => {
      if (node.type !== 'object') return;
      expect(node.additionalProperties).toBe(false);
      const properties = Object.keys((node.properties as Node | undefined) ?? {});
      expect(new Set(node.required as string[])).toEqual(new Set(properties));
    });
  });

  it('nests objects at most 4 levels deep', () => {
    let max = 0;
    walk(json, (_node, depth) => {
      max = Math.max(max, depth);
    });
    expect(max).toBeLessThanOrEqual(4);
  });

  it('carries no length, range, pattern or format bounds and no minItems > 1', () => {
    walk(json, (node) => {
      for (const keyword of [
        'minLength',
        'maxLength',
        'minimum',
        'maximum',
        'exclusiveMinimum',
        'exclusiveMaximum',
        'maxItems',
        'pattern',
        'format',
      ]) {
        expect(node[keyword], keyword).toBeUndefined();
      }
      if (typeof node.minItems === 'number') expect(node.minItems).toBeLessThanOrEqual(1);
    });
  });

  it('passes the shared wire-rule checker', () => {
    expect(wireRuleViolations(json)).toEqual([]);
  });

  it('emits discriminated unions as anyOf and drops $schema on the wire', () => {
    const wire = toWireJsonSchema(AI_SCHEMAS[name].schema);
    expect(JSON.stringify(wire)).not.toContain('"oneOf"');
    expect(wire.$schema).toBeUndefined();
    expect(wireRuleViolations(wire)).toEqual([]);
  });
});

describe('wireRuleViolations', () => {
  it('flags open objects, optional properties, bounds, deep nesting and undiscriminated unions', () => {
    const bad = z.object({
      a: z.string().min(2).optional(),
      b: z.object({ c: z.object({ d: z.object({ e: z.object({ f: z.string() }) }) }) }),
      u: z.union([z.object({ x: z.string() }), z.object({ y: z.string() })]),
      n: z.int(),
    });
    const rules = new Set(
      wireRuleViolations(z.toJSONSchema(bad, { io: 'input' }) as Node).map((v) => v.rule),
    );
    for (const rule of [
      'object_not_closed',
      'property_not_required',
      'bound_present',
      'depth_exceeded',
      'union_not_discriminated',
    ]) {
      expect(rules.has(rule as never), rule).toBe(true);
    }
  });
});
