import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

/**
 * JSON Schema sent to a provider's structured-output API (AI_PIPELINE_PLAN §4.1): draft 2020-12 from
 * `z.toJSONSchema`, with discriminated unions emitted as `anyOf` (OpenAI strict mode accepts `anyOf`
 * but not `oneOf`) and without the top-level `$schema` marker.
 */
export function toWireJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    override: (ctx) => {
      const node = ctx.jsonSchema as JsonSchema;
      if (Array.isArray(node.oneOf)) {
        node.anyOf = node.oneOf;
        delete node.oneOf;
      }
    },
  }) as JsonSchema;
  delete json.$schema;
  return json;
}

const BOUND_KEYWORDS = [
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'maxItems',
  'pattern',
  'format',
  'multipleOf',
] as const;

export interface WireViolation {
  readonly path: string;
  readonly rule:
    | 'object_not_closed'
    | 'property_not_required'
    | 'depth_exceeded'
    | 'bound_present'
    | 'min_items_gt_1'
    | 'union_not_discriminated'
    | 'recursion';
  readonly detail?: string;
}

function isObjectNode(node: JsonSchema): boolean {
  return node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'));
}

function unionDiscriminated(branches: JsonSchema[]): boolean {
  const objects = branches.filter((b) => !(b.type === 'null'));
  if (objects.length <= 1) return true;
  if (!objects.every(isObjectNode)) return false;
  const candidates = Object.keys((objects[0]?.properties as JsonSchema | undefined) ?? {});
  return candidates.some((key) => {
    const values = objects.map(
      (b) => ((b.properties as JsonSchema)[key] as JsonSchema | undefined)?.const,
    );
    return values.every((v) => typeof v === 'string') && new Set(values).size === values.length;
  });
}

/**
 * Checks a JSON Schema against the cross-provider wire rules: every object closed
 * (`additionalProperties:false`), every property required, object nesting depth ≤ `maxDepth`, no
 * length/range/pattern/format bounds, no `minItems` > 1, unions discriminated by a string `const`,
 * no `$ref` recursion.
 */
export function wireRuleViolations(schema: JsonSchema, maxDepth = 4): WireViolation[] {
  const violations: WireViolation[] = [];
  const visit = (node: JsonSchema, path: string, depth: number): void => {
    if ('$ref' in node || '$defs' in node) violations.push({ path, rule: 'recursion' });
    for (const keyword of BOUND_KEYWORDS) {
      if (keyword in node) violations.push({ path, rule: 'bound_present', detail: keyword });
    }
    if (typeof node.minItems === 'number' && node.minItems > 1) {
      violations.push({ path, rule: 'min_items_gt_1' });
    }
    let nextDepth = depth;
    if (isObjectNode(node)) {
      nextDepth = depth + 1;
      if (nextDepth > maxDepth)
        violations.push({ path, rule: 'depth_exceeded', detail: String(nextDepth) });
      if (node.additionalProperties !== false) violations.push({ path, rule: 'object_not_closed' });
      const properties = (node.properties as Record<string, JsonSchema> | undefined) ?? {};
      const required = new Set((node.required as string[] | undefined) ?? []);
      for (const [key, child] of Object.entries(properties)) {
        if (!required.has(key))
          violations.push({ path: `${path}.${key}`, rule: 'property_not_required' });
        visit(child, `${path}.${key}`, nextDepth);
      }
    }
    if (node.items !== undefined && typeof node.items === 'object') {
      visit(node.items as JsonSchema, `${path}[]`, nextDepth);
    }
    for (const unionKey of ['anyOf', 'oneOf'] as const) {
      const branches = node[unionKey];
      if (Array.isArray(branches)) {
        if (!unionDiscriminated(branches as JsonSchema[])) {
          violations.push({ path, rule: 'union_not_discriminated' });
        }
        (branches as JsonSchema[]).forEach((branch, i) => {
          visit(branch, `${path}|${i}`, depth);
        });
      }
    }
  };
  visit(schema, '$', 0);
  return violations;
}
