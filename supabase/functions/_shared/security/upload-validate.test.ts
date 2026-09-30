import { assertEquals } from '@std/assert';
import { inspectPdf, sniffMime, validateUpload } from './upload-validate.ts';

const enc = new TextEncoder();
const PDF = enc.encode('%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF\n');
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1,
]);
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);
const WEBP = new Uint8Array([...enc.encode('RIFF'), 0x24, 0, 0, 0, ...enc.encode('WEBPVP8 ')]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...enc.encode('ftypheic'), 0, 0, 0, 0]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]);
const ELF = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const SVG = enc.encode(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>',
);

Deno.test('magic numbers identify every accepted type and the refused families', () => {
  assertEquals(sniffMime(PDF), 'application/pdf');
  assertEquals(sniffMime(JPEG), 'image/jpeg');
  assertEquals(sniffMime(PNG), 'image/png');
  assertEquals(sniffMime(WEBP), 'image/webp');
  assertEquals(sniffMime(HEIC), 'image/heic');
  assertEquals(sniffMime(ZIP), 'application/zip');
  assertEquals(sniffMime(EXE), 'application/x-executable');
  assertEquals(sniffMime(ELF), 'application/x-executable');
  assertEquals(sniffMime(SVG), 'image/svg+xml');
  assertEquals(sniffMime(enc.encode('Merhaba dünya, toplantı notları')), 'text/plain');
  assertEquals(sniffMime(new Uint8Array([0xc3, 0x28, 0x00])), 'unknown');
});

Deno.test('HEIC, WebP, PNG, JPEG and PDF uploads pass when MIME, extension and bytes agree', () => {
  assertEquals(
    validateUpload({
      declaredMime: 'image/heic',
      fileName: 'IMG_0001.HEIC',
      sizeBytes: 2_000_000,
      head: HEIC,
    }),
    {
      ok: true,
      mime: 'image/heic',
      extension: 'heic',
    },
  );
  assertEquals(
    validateUpload({ declaredMime: 'image/webp', fileName: 'a.webp', sizeBytes: 10, head: WEBP })
      .ok,
    true,
  );
  assertEquals(
    validateUpload({ declaredMime: 'image/png', fileName: 'a.png', sizeBytes: 10, head: PNG }).ok,
    true,
  );
  assertEquals(
    validateUpload({ declaredMime: 'image/jpeg', fileName: 'a.jpeg', sizeBytes: 10, head: JPEG })
      .ok,
    true,
  );
  assertEquals(
    validateUpload({
      declaredMime: 'application/pdf; charset=binary',
      fileName: 'fatura.pdf',
      sizeBytes: 10,
      head: PDF,
    }).ok,
    true,
  );
  assertEquals(
    validateUpload({ declaredMime: 'image/heif', fileName: 'x.heif', sizeBytes: 10, head: HEIC })
      .ok,
    true,
  );
});

Deno.test('bad magic, archives, executables and SVG are rejected', () => {
  assertEquals(
    validateUpload({
      declaredMime: 'application/pdf',
      fileName: 'x.pdf',
      sizeBytes: 10,
      head: JPEG,
    }),
    {
      ok: false,
      reason: 'magic_mismatch',
    },
  );
  assertEquals(
    validateUpload({ declaredMime: 'application/pdf', fileName: 'x.pdf', sizeBytes: 10, head: ZIP })
      .ok,
    false,
  );
  assertEquals(
    validateUpload({
      declaredMime: 'application/pdf',
      fileName: 'x.pdf',
      sizeBytes: 10,
      head: ZIP,
    }),
    { ok: false, reason: 'archive' },
  );
  assertEquals(
    validateUpload({ declaredMime: 'image/png', fileName: 'x.png', sizeBytes: 10, head: EXE }),
    { ok: false, reason: 'executable' },
  );
  assertEquals(
    validateUpload({ declaredMime: 'text/plain', fileName: 'x.txt', sizeBytes: 10, head: SVG }),
    { ok: false, reason: 'svg' },
  );
  assertEquals(
    validateUpload({ declaredMime: 'image/svg+xml', fileName: 'x.svg', sizeBytes: 10 }),
    { ok: false, reason: 'mime_not_allowed' },
  );
  assertEquals(
    validateUpload({ declaredMime: 'application/zip', fileName: 'x.zip', sizeBytes: 10 }),
    { ok: false, reason: 'mime_not_allowed' },
  );
});

Deno.test('extension, size, empty files and per-call allow-lists are enforced', () => {
  assertEquals(validateUpload({ declaredMime: 'image/png', fileName: 'x.jpg', sizeBytes: 10 }), {
    ok: false,
    reason: 'extension_mismatch',
  });
  assertEquals(validateUpload({ declaredMime: 'image/png', fileName: 'noext', sizeBytes: 10 }), {
    ok: false,
    reason: 'extension_mismatch',
  });
  assertEquals(validateUpload({ declaredMime: 'image/png', fileName: 'x.png', sizeBytes: 0 }), {
    ok: false,
    reason: 'empty',
  });
  assertEquals(
    validateUpload({ declaredMime: 'image/png', fileName: 'x.png', sizeBytes: 16 * 1024 * 1024 }),
    {
      ok: false,
      reason: 'too_large',
      limitBytes: 15 * 1024 * 1024,
    },
  );
  assertEquals(
    validateUpload({ declaredMime: 'application/pdf', fileName: 'x.pdf', sizeBytes: 10 }, [
      'image/png',
    ]),
    {
      ok: false,
      reason: 'mime_not_allowed',
    },
  );
});

Deno.test('PDF inspection refuses encrypted and truncated files and counts pages', () => {
  assertEquals(inspectPdf(PDF), { ok: true, pages: 1 });
  assertEquals(inspectPdf(enc.encode('%PDF-1.7\n<< /Encrypt 5 0 R >>\n%%EOF')), {
    ok: false,
    reason: 'encrypted',
  });
  assertEquals(inspectPdf(enc.encode('%PDF-1.7\n<< /Type /Page >>')), {
    ok: false,
    reason: 'truncated',
  });
  const many = enc.encode(`%PDF-1.7\n${'<< /Type /Page >>\n'.repeat(3)}%%EOF`);
  assertEquals(inspectPdf(many, 2), { ok: false, reason: 'too_many_pages' });
});
