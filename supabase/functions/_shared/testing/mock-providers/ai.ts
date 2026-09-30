/**
 * LLM provider emulators for the AI failure suites (TEST_PLAN §6.4 IT-AI-02 / IT-AI-03), reached
 * through the test-only `ANTHROPIC_API_BASE_URL` (`<mock>/anthropic`) and `OPENAI_API_BASE_URL`
 * (`<mock>/openai/v1`) overrides:
 * - `POST /anthropic/v1/messages` (Messages API; `x-api-key` and `anthropic-version` required);
 * - `POST /openai/v1/responses` (Responses API; bearer key required).
 * The model output of a call is scripted with `POST /__script`:
 *   `{route: 'POST /anthropic/v1/messages', responses: [{passthrough: true, body, match?, times?}]}`
 * where `body` is the structured output: an object is serialised as JSON, a string is sent as the
 * raw text (so malformed JSON is expressible), and `match` selects calls by a request-body substring
 * (for example a property name of the requested JSON schema). The emulator wraps the output in the
 * provider envelope (stop reason, usage, request id). A call without scripted output answers the
 * provider's 400 `invalid_request_error`, so nothing succeeds by accident.
 */
import type { Context, Hono } from 'hono';
import { bearerOf, jsonOf, type MockEnv, type MockState, randomId } from './core.ts';

type Ctx = Context<MockEnv>;

function scriptedOutput(c: Ctx): string | null {
  const scripted = c.get('mockScripted');
  if (scripted?.body === undefined) return null;
  return typeof scripted.body === 'string' ? scripted.body : JSON.stringify(scripted.body);
}

function tokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function mountAi(app: Hono<MockEnv>, state: MockState): void {
  let served = 0;
  state.onReset(() => {
    served = 0;
  });

  app.post('/anthropic/v1/messages', (c) => {
    if ((c.req.header('x-api-key') ?? '') === '')
      return c.json(
        {
          type: 'error',
          error: { type: 'authentication_error', message: 'x-api-key header is required' },
        },
        401,
      );
    if ((c.req.header('anthropic-version') ?? '') === '')
      return c.json(
        {
          type: 'error',
          error: { type: 'invalid_request_error', message: 'anthropic-version is required' },
        },
        400,
      );
    const request = jsonOf<{ model?: string }>(c);
    const text = scriptedOutput(c);
    if (text === null)
      return c.json(
        {
          type: 'error',
          error: { type: 'invalid_request_error', message: 'mock: no scripted output' },
        },
        400,
      );
    served += 1;
    c.header('request-id', `req_mock_${String(served)}`);
    return c.json({
      id: `msg_mock_${randomId()}`,
      type: 'message',
      role: 'assistant',
      model: request.model ?? '',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: tokens(c.get('mockBody')),
        output_tokens: tokens(text),
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
  });

  app.post('/openai/v1/responses', (c) => {
    if ((bearerOf(c) ?? '') === '')
      return c.json(
        {
          error: {
            type: 'invalid_request_error',
            code: 'invalid_api_key',
            message: 'Missing bearer authentication',
          },
        },
        401,
      );
    const request = jsonOf<{ model?: string }>(c);
    const text = scriptedOutput(c);
    if (text === null)
      return c.json(
        {
          error: {
            type: 'invalid_request_error',
            code: null,
            message: 'mock: no scripted output',
          },
        },
        400,
      );
    served += 1;
    const input = tokens(c.get('mockBody'));
    const output = tokens(text);
    c.header('x-request-id', `req_mock_${String(served)}`);
    return c.json({
      id: `resp_mock_${randomId()}`,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      status: 'completed',
      model: request.model ?? '',
      output: [
        {
          type: 'message',
          id: `msg_mock_${randomId()}`,
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text, annotations: [] }],
        },
      ],
      usage: {
        input_tokens: input,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: output,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: input + output,
      },
    });
  });
}
