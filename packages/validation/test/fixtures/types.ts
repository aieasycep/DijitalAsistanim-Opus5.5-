export type Part = 'params' | 'query' | 'body' | 'headers' | 'response';

export interface InvalidCase {
  readonly part: Part;
  readonly value: unknown;
  readonly why: string;
}

/** One valid example per request part and response, plus the invalid cases that must be rejected. */
export interface RouteFixture {
  readonly valid: Partial<Record<Part, unknown>>;
  readonly invalid: readonly InvalidCase[];
}
