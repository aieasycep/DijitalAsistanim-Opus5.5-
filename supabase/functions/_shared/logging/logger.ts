/**
 * Structured JSON logger for every Edge Function (API_CONTRACTS §2.12, SECURITY_AND_PRIVACY_PLAN
 * CTL-3.14, IMPLEMENTATION_PLAN T-3.02).
 *
 * One line per event: `{ts, level, fn, msg, correlation_id, request_id, job_id, user_hash, ...}`.
 * Every string that reaches the output passes the scrubber: e-mail addresses are masked
 * (`yu***@gmail.com`), bearer tokens, JWTs, `sb_` / `sk-` keys, PEM blocks and long base64 runs are
 * redacted. Request and response bodies are never logged: callers pass ids, counts and codes only,
 * and fields whose names suggest content (`body`, `message_text`, `subject`, `prompt`, …) are
 * replaced wholesale.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogValue = string | number | boolean | null | undefined | LogValue[] | LogFields;
export interface LogFields {
  [key: string]: LogValue;
}

/** Field names whose values are content by definition and are never written. */
const CONTENT_FIELDS = new Set([
  'body',
  'raw_body',
  'request_body',
  'response_body',
  'payload',
  'text',
  'content',
  'subject',
  'snippet',
  'prompt',
  'completion',
  'answer',
  'message_text',
  'html',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'authorization',
  'cookie',
  'secret',
  'api_key',
  'apikey',
  'private_key',
]);

const REDACTED = '[redacted]';
const MAX_STRING = 500;

const PATTERNS: readonly [RegExp, (match: string) => string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, () => REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, () => `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, () => REDACTED],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, () => REDACTED],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{8,}/g, () => REDACTED],
  [/\bsk_[A-Za-z0-9]{8,}/g, () => REDACTED],
  [/\bExpo(?:nent)?PushToken\[[A-Za-z0-9_-]+\]/g, () => `ExponentPushToken[${REDACTED}]`],
  [/[A-Za-z0-9+/_-]{48,}={0,2}/g, () => REDACTED],
  [
    /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    (match) => {
      const at = match.indexOf('@');
      return `${match.slice(0, Math.min(2, at))}***${match.slice(at)}`;
    },
  ],
];

/** Masks e-mail addresses and redacts credentials inside one string. */
export function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replace] of PATTERNS) out = out.replace(pattern, replace);
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…` : out;
}

/** Recursively scrubs a log value; content-named fields are dropped to `[redacted]`. */
export function scrubValue(value: unknown, depth = 0): LogValue {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 4) return REDACTED;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  if (value instanceof Error) return scrubString(`${value.name}: ${value.message}`);
  if (typeof value === 'object') {
    const out: LogFields = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = CONTENT_FIELDS.has(key.toLowerCase()) ? REDACTED : scrubValue(v, depth + 1);
    }
    return out;
  }
  return REDACTED;
}

export type LogSink = (line: string) => void;

// deno-lint-ignore no-console
const consoleSink: LogSink = (line) => console.log(line);

export interface LoggerOptions {
  fn: string;
  level?: LogLevel;
  sink?: LogSink;
  now?: () => Date;
  base?: LogFields;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger that adds `fields` (e.g. `correlation_id`, `job_id`, `user_hash`) to every line. */
  child(fields: LogFields): Logger;
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LEVEL_ORDER[options.level ?? 'info'];
  const sink = options.sink ?? consoleSink;
  const now = options.now ?? (() => new Date());
  const base: LogFields = { ...(options.base ?? {}) };

  const write = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (LEVEL_ORDER[level] < threshold) return;
    const record: Record<string, unknown> = {
      ts: now().toISOString(),
      level,
      fn: options.fn,
      msg: scrubString(msg),
    };
    const merged = { ...base, ...(fields ?? {}) };
    for (const [key, value] of Object.entries(merged)) {
      if (value === undefined || key in record) continue;
      record[key] = CONTENT_FIELDS.has(key.toLowerCase()) ? REDACTED : scrubValue(value);
    }
    try {
      sink(JSON.stringify(record));
    } catch {
      sink(
        JSON.stringify({ ts: record.ts, level, fn: options.fn, msg: 'log_serialization_failed' }),
      );
    }
  };

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}

/** Collects log lines in memory (tests). */
export function memorySink(): {
  sink: LogSink;
  lines: string[];
  records: () => Record<string, unknown>[];
} {
  const lines: string[] = [];
  return {
    sink: (line) => lines.push(line),
    lines,
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
