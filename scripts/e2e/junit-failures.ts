/**
 * Prints the failed test cases of Maestro JUnit reports (`<testcase name=…><failure message=…>`)
 * as one line each, for the job log of `run-maestro-android.sh`: artifacts cannot always be
 * downloaded, the reasons stay readable in the log.
 *
 *   node scripts/e2e/junit-failures.ts build/maestro/junit.xml [more.xml …]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface JunitFailure {
  readonly name: string;
  readonly message: string;
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&quot;': '"',
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
};

function decode(value: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const amp = value.indexOf('&', at);
    if (amp === -1) return out + value.slice(at);
    const semi = value.indexOf(';', amp);
    const entity = semi === -1 ? '' : value.slice(amp, semi + 1);
    const replacement = ENTITIES[entity];
    if (replacement === undefined) {
      out += value.slice(at, amp + 1);
      at = amp + 1;
    } else {
      out += value.slice(at, amp) + replacement;
      at = semi + 1;
    }
  }
}

/** The value of `attr="…"` inside one start tag, or ''. */
function attribute(tag: string, attr: string): string {
  const key = ` ${attr}="`;
  const start = tag.indexOf(key);
  if (start === -1) return '';
  const end = tag.indexOf('"', start + key.length);
  return end === -1 ? '' : decode(tag.slice(start + key.length, end));
}

/** Failed and errored test cases, in report order. */
export function junitFailures(xml: string): JunitFailure[] {
  const out: JunitFailure[] = [];
  let at = 0;
  for (;;) {
    const open = xml.indexOf('<testcase', at);
    if (open === -1) return out;
    const tagEnd = xml.indexOf('>', open);
    if (tagEnd === -1) return out;
    const selfClosing = xml[tagEnd - 1] === '/';
    const close = selfClosing ? tagEnd : xml.indexOf('</testcase>', tagEnd);
    const body = close === -1 ? xml.slice(tagEnd) : xml.slice(tagEnd, close);
    for (const kind of ['<failure', '<error']) {
      const failure = body.indexOf(kind);
      if (failure === -1) continue;
      const failureEnd = body.indexOf('>', failure);
      const tag = body.slice(failure, failureEnd === -1 ? body.length : failureEnd + 1);
      let message = attribute(tag, 'message');
      if (message === '' && failureEnd !== -1 && !tag.endsWith('/>')) {
        const textEnd = body.indexOf('</', failureEnd);
        message = decode(body.slice(failureEnd + 1, textEnd === -1 ? body.length : textEnd)).trim();
      }
      out.push({ name: attribute(xml.slice(open, tagEnd + 1), 'name'), message });
      break;
    }
    at = close === -1 ? xml.length : close + 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let total = 0;
  for (const file of process.argv.slice(2)) {
    let xml: string;
    try {
      xml = readFileSync(file, 'utf8');
    } catch {
      console.info(`${file}: not written`);
      continue;
    }
    for (const failure of junitFailures(xml)) {
      total += 1;
      console.info(`✗ ${failure.name}: ${failure.message.split('\n')[0] ?? ''}`);
    }
  }
  console.info(`${String(total)} failed flow(s)`);
}
