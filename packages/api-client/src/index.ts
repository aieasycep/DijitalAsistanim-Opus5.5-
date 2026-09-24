/**
 * @da/api-client — platform-neutral data access for the mobile and web apps (T-1.17):
 * - `createApiClient`: the typed Edge `api` client derived from the `@da/validation` registry;
 * - `createSupabaseClient`: Supabase (Auth, Functions, PostgREST) with injected session storage;
 * - `readSseFrames` / `readAssistantEvents`: `text/event-stream` parsing;
 * - `ApiError`: the typed error envelope;
 * - `qk` / `mk`: TanStack Query key factories.
 * React hooks live in `@da/api-client/react`.
 */
export * from './api.ts';
export * from './errors.ts';
export * from './query-keys.ts';
export * from './sse.ts';
export * from './supabase.ts';
