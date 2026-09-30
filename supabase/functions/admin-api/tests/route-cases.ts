/**
 * Per-route cases for the table-driven route test: SQL-shaped `admin_api` outputs (the column names
 * and vocabularies the SQL functions return — renamed columns, bigint audit ids, `{rows,total}`
 * envelopes, lower-case environments, SQL enums), extra service-side stubs and assertions on the
 * arguments sent and the mapped response. Routes without a case run against the fixture-derived
 * output (their SQL function returns the contract shape).
 */
import type { Cases } from './case-helpers.ts';
import { AI_CASES } from './cases-ai.ts';
import { OPS_CASES } from './cases-ops.ts';
import { PRODUCT_CASES } from './cases-product.ts';
import { SESSION_CASES } from './cases-session.ts';
import { SUPPORT_CASES } from './cases-support.ts';
import { SYSTEM_CASES } from './cases-system.ts';
import { USER_CASES } from './cases-users.ts';

export type { RouteCase } from './case-helpers.ts';

export const ROUTE_CASES: Cases = {
  ...SESSION_CASES,
  ...USER_CASES,
  ...SUPPORT_CASES,
  ...OPS_CASES,
  ...AI_CASES,
  ...PRODUCT_CASES,
  ...SYSTEM_CASES,
};
