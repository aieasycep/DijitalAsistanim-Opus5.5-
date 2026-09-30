/** Recording `fetch` stubs: tests never reach the network (the test task has no net permission). */

export interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | null;
  readonly rawBody: BodyInit | null | undefined;
}

export type StubHandler = (call: RecordedCall) => Response | Promise<Response>;

export function stubFetch(handler: StubHandler): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? (input instanceof URL ? input.href : String(input));
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    let body: string | null = null;
    const raw = init?.body ?? null;
    if (typeof raw === 'string') body = raw;
    else if (raw instanceof URLSearchParams) body = raw.toString();
    else if (raw instanceof Uint8Array) body = new TextDecoder().decode(raw);
    else if (raw instanceof ArrayBuffer) body = new TextDecoder().decode(new Uint8Array(raw));
    else if (request !== null && raw === null && method !== 'GET' && method !== 'HEAD')
      body = await request.clone().text();
    else if (raw instanceof FormData) body = '[form-data]';
    const call: RecordedCall = { url, method, headers, body, rawBody: raw };
    calls.push(call);
    if (init?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError');
    return await handler(call);
  };
  return { fetch: fn as typeof fetch, calls };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** A fetch that fails the test if it is ever called. */
export function forbiddenFetch(): typeof fetch {
  return (() => {
    throw new Error('unexpected network call in test');
  }) as unknown as typeof fetch;
}
