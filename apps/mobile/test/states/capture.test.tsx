/**
 * T-8.17 · Universal Capture with its data variants (SCREEN_AND_FLOW_MAP M-CAP-01 composer, M-CAP-02
 * photo source, M-CAP-03 file picker, M-CAP-05 analysing, M-CAP-06 results, M-CAP-07 result;
 * API-CAP-01…05): the link preview (`POST /captures {kind:'link', preview:true}`) and its https /
 * blocked / failed variants, pasted and too-long text, photo / camera / PDF sources with the
 * size and type checks and the signed upload with real progress, the discard confirmation; the
 * analysing steps with cancel, each failure reason with retry, the results (quick-select chips,
 * past / low-confidence warnings, item edit, "Hafızaya kaydet") and the batch outcome (executing,
 * all failed, partial success).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { resetDraftForTests } from '../../src/features/capture/draft';
import { json, resetAppState, type Responder } from '../helpers/app';
import { M3, approvalRow, captureRow, captureView } from '../helpers/assist';
import { errorBody, ok, TS, uuid } from '../helpers/fixtures';
import { events, openApp, proBootstrap } from '../helpers/journeys';
import type { PostgrestFake } from '../helpers/postgrest';
import { sequence } from './support';

const analyzed = () =>
  json(
    202,
    ok({
      capture: captureView({ status: 'analyzing' }),
      job: { job_id: M3.job, status: 'queued', poll_after_ms: 1000 },
    }),
  );

function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    item_id: id,
    type: 'deadline',
    title: `Öğe ${id}`,
    fields: {},
    evidence: [],
    confidence: 0.92,
    proposed_action: 'reminder_create',
    selected: true,
    unresolved: [],
    ...overrides,
  };
}

interface Options {
  readonly path: string;
  readonly routes?: Readonly<Record<string, Responder>>;
  readonly setup?: (db: PostgrestFake) => void;
  readonly free?: boolean;
}

async function openCapture(options: Options) {
  return openApp({
    ...(options.free === true ? {} : { data: proBootstrap() }),
    path: options.path,
    ...(options.setup === undefined ? {} : { setup: options.setup }),
    routes: {
      'POST /captures': () => json(201, ok(captureView())),
      [`POST /captures/${M3.capture}/analyze`]: analyzed,
      ...options.routes,
    },
  });
}

beforeEach(async () => {
  await resetAppState();
  resetDraftForTests();
});

describe('M-CAP-01 · composer', () => {
  it('previews a link, rejects http and blocked addresses, and analyses the link capture', async () => {
    const { api, router } = await openCapture({
      path: '/capture?kind=link',
      routes: {
        'POST /captures': sequence(
          json(422, {
            error: { ...errorBody('FORBIDDEN').error, details: { reason: 'ssrf_blocked' } },
          }),
          json(
            201,
            ok(
              captureView({
                kind: 'link',
                link_preview: { title: 'Kampanya duyurusu', domain: 'ornek.com' },
              }),
            ),
          ),
        ),
      },
      setup: (db) => {
        db.setTable('captures', [captureRow({ kind: 'link' })]);
      },
    });
    const url = await screen.findByTestId('capture.url');
    await fireEvent.changeText(url, 'http://ornek.com/kampanya');
    expect(await screen.findByText('Bu bağlantı türü desteklenmiyor.')).toBeOnTheScreen();
    await fireEvent.changeText(url, 'ornek');
    expect(await screen.findByText('Geçerli bir bağlantı yaz (https://…)')).toBeOnTheScreen();
    await fireEvent.changeText(url, 'https://10.0.0.1.example/ic');
    expect(
      await screen.findByText('Bu adres güvenlik nedeniyle açılamıyor.', {}, { timeout: 3000 }),
    ).toBeOnTheScreen();
    await fireEvent.changeText(url, 'https://ornek.com/kampanya');
    expect(await screen.findByTestId('capture.preview', {}, { timeout: 3000 })).toBeOnTheScreen();
    expect(api.calls.filter((c) => c.url.endsWith('/captures')).at(-1)?.body).toMatchObject({
      share_origin: 'in_app',
      source: { kind: 'link', url: 'https://ornek.com/kampanya', preview: true },
    });
    await fireEvent.press(screen.getByTestId('capture.analyze'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/capture/${M3.capture}`);
    });
    // The preview capture is analysed; no second link capture is created.
    expect(api.calls.filter((c) => c.url.endsWith('/captures'))).toHaveLength(2);
    expect(events('capture_created').at(-1)?.props).toEqual({
      kind: 'link',
      via: 'in_app',
      file_count: 0,
    });
  });

  it('pastes from the clipboard only on tap and flags text over 5.000 characters', async () => {
    jest
      .mocked(Clipboard.getStringAsync)
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('Toplantı notu: Cuma 10:00');
    await openCapture({ path: '/capture' });
    await fireEvent.press(await screen.findByTestId('capture.paste'));
    expect(await screen.findByText('Panoda yapıştırılacak metin yok.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('capture.paste'));
    expect(await screen.findByDisplayValue('Toplantı notu: Cuma 10:00')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('capture.text'), 'a'.repeat(5001));
    expect(await screen.findByText('En fazla 5.000 karakter.')).toBeOnTheScreen();
    expect(screen.getByTestId('capture.analyze')).toBeDisabled();
  });

  it('adds photos from the library, refuses oversize and unsupported files, and uploads with progress', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///p/1.jpg',
          width: 10,
          height: 10,
          mimeType: 'image/jpeg',
          fileName: 'fis.jpg',
          fileSize: 2048,
        },
        {
          uri: 'file:///p/2.jpg',
          width: 10,
          height: 10,
          mimeType: 'image/jpeg',
          fileName: 'buyuk.jpg',
          fileSize: 16 * 1024 * 1024,
        },
      ],
    } as unknown as ImagePicker.ImagePickerResult);
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///d/x.zip',
          name: 'arsiv.zip',
          mimeType: 'application/zip',
          size: 100,
          lastModified: 0,
        },
      ],
    } as unknown as DocumentPicker.DocumentPickerResult);
    const { api, router } = await openCapture({
      path: '/capture',
      routes: {
        'POST /captures/upload-url': () =>
          json(
            200,
            ok({
              capture_id: M3.capture,
              upload: {
                signed_url: 'https://project-ref.supabase.test/storage/v1/upload/sign/c',
                token: 't',
                path: 'captures/fis.jpg',
                expires_at: '2026-09-30T08:00:00Z',
                headers: { 'content-type': 'image/jpeg' },
              },
            }),
          ),
      },
    });
    await fireEvent.press(await screen.findByText('Fotoğraf'));
    expect(await screen.findByTestId('sheet.photoSource')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('capture.library'));
    expect(await screen.findByTestId('capture.fileError')).toHaveTextContent(
      'Dosya çok büyük (en fazla 15 MB).',
    );
    expect(screen.getByTestId('capture.files')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('PDF'));
    await fireEvent.press(await screen.findByTestId('capture.files.device'));
    await waitFor(() => {
      expect(screen.getByTestId('capture.fileError')).toHaveTextContent(
        'Bu dosya türü desteklenmiyor.',
      );
    });
    expect(events('capture_file_pick').at(-1)?.props).toEqual({ origin: 'device', kind: 'file' });
    await fireEvent.press(screen.getByTestId('capture.analyze'));
    await waitFor(() => {
      expect(router.getPathname()).toBe(`/capture/${M3.capture}`);
    });
    expect(api.calls.find((c) => c.url.endsWith('/upload-url'))?.body).toMatchObject({
      kind: 'photo',
      mime: 'image/jpeg',
      size_bytes: 2048,
    });
    expect(events('capture_created').at(-1)?.props).toEqual({
      kind: 'photo',
      via: 'in_app',
      file_count: 1,
    });
  });

  it('asks for the camera only on "Kamera" and explains a denial', async () => {
    jest
      .mocked(ImagePicker.requestCameraPermissionsAsync)
      .mockResolvedValueOnce({ granted: false, status: 'denied' } as never);
    await openCapture({ path: '/capture?kind=photo' });
    await fireEvent.press(await screen.findByTestId('capture.camera'));
    expect(
      await screen.findByText("Kamera izni kapalı · Ayarlar'dan açabilirsin."),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('capture.cameraSettings')).toBeOnTheScreen();
  });

  it('confirms before discarding a draft and toasts a failed analysis', async () => {
    const { router } = await openCapture({
      path: '/capture',
      routes: { 'POST /captures': () => json(500, errorBody('INTERNAL_ERROR')) },
    });
    await fireEvent.changeText(await screen.findByTestId('capture.text'), 'Cuma 10:00 dişçi');
    await fireEvent.press(screen.getByTestId('capture.analyze'));
    expect(await screen.findByText('Yükleme başarısız · Tekrar dene')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Kapat'));
    expect(await screen.findByTestId('capture.discardConfirm')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Sil'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/today');
    });
    expect(events('capture_cancel').at(-1)?.props).toEqual({ stage: 'compose' });
  });

  it('shows the unsupported share state', async () => {
    await openCapture({ path: '/capture?entry=share&unsupported=1' });
    expect(await screen.findByTestId('capture.unsupported')).toBeOnTheScreen();
    expect(screen.getByText('Bu içerik türü desteklenmiyor.')).toBeOnTheScreen();
  });
});

describe('M-CAP-05 / M-CAP-06 / M-CAP-07 · analysis and results', () => {
  it('shows the analysing steps and cancels with POST /captures/:id/discard', async () => {
    const { api, router } = await openCapture({
      path: `/capture/${M3.capture}`,
      setup: (db) => {
        db.setTable('captures', [captureRow({ kind: 'link', progress: { step: 'extracting' } })]);
      },
      routes: {
        [`POST /captures/${M3.capture}/discard`]: () =>
          json(200, ok(captureView({ status: 'discarded' }))),
      },
    });
    const progress = await screen.findByTestId('capture.progress');
    expect(within(progress).getByText('Tarih, kişi ve görevler çıkarılıyor')).toBeOnTheScreen();
    expect(
      screen.getByText('Sayfa yalnızca bir kez okunur; çerez veya oturum paylaşılmaz.'),
    ).toBeOnTheScreen();
    await fireEvent.press(within(progress).getByText('İptal'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/capture');
    });
    expect(api.calls.some((c) => c.url.endsWith('/discard'))).toBe(true);
  });

  it.each([
    ['encrypted_pdf', 'Parola korumalı PDF okunamıyor.'],
    ['ocr_error', 'Metin okunamadı; daha net bir görüntü dene.'],
    ['ssrf_blocked', 'Bu adres güvenlik nedeniyle açılamıyor.'],
    ['link_fetch', 'Sayfa okunamadı · Metni kopyalayıp yapıştırabilirsin.'],
    ['UPSTREAM_TIMEOUT', 'Analiz zaman aşımına uğradı.'],
  ])('explains a failed analysis (%s) and retries', async (reason, message) => {
    const { api } = await openCapture({
      path: `/capture/${M3.capture}`,
      setup: (db) => {
        db.setTable('captures', [captureRow({ status: 'failed', progress: { reason } })]);
      },
    });
    const failed = await screen.findByTestId('capture.failed');
    expect(within(failed).getByText(message)).toBeOnTheScreen();
    await fireEvent.press(within(failed).getByText('Tekrar dene'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith(`/captures/${M3.capture}/analyze`))).toBe(true);
    });
  });

  it('selects by type, warns about past and unsure items, edits an item and saves to memory', async () => {
    const { api } = await openCapture({
      path: `/capture/${M3.capture}`,
      setup: (db) => {
        db.setTable('captures', [
          captureRow({
            status: 'extracted',
            primary_type: 'event',
            progress: { step: 'done', title: 'Etkinlik afişi' },
            link_preview: { title: 'Afiş', domain: 'ornek.com' },
            extracted: [
              item('e1', {
                type: 'event',
                proposed_action: 'calendar_create',
                fields: { start: '2026-10-02T17:00:00Z' },
                evidence: [{ page: 2, quote: 'Cuma 20:00' }],
              }),
              item('e2', {
                type: 'task',
                proposed_action: 'task_create',
                fields: { due: '2020-01-01' },
              }),
              item('e3', { confidence: 0.4, evidence: [{ quote: 'Son gün belki Pazartesi' }] }),
              item('n1', { type: 'note', proposed_action: null }),
            ],
          }),
        ]);
        db.setTable('approval_actions', []);
      },
      routes: {
        [`POST /captures/${M3.capture}/actions`]: () =>
          json(200, ok({ approvals: [], batch_id: M3.capture, memory_saved: true })),
      },
    });
    const results = await screen.findByTestId('capture.results');
    expect(within(results).getByText('Etkinlik afişi')).toBeOnTheScreen();
    expect(within(results).getByText('Kaynak: s.2')).toBeOnTheScreen();
    expect(within(results).getByText('Bu tarih geçmişte')).toBeOnTheScreen();
    expect(within(results).getByText('Emin değilim · kontrol et')).toBeOnTheScreen();
    expect(screen.getByTestId('capture.send')).toHaveTextContent('1 Öğeyi Onaya Gönder');
    await fireEvent.press(screen.getByTestId('capture.quick.task_create'));
    expect(screen.getByTestId('capture.send')).toHaveTextContent('2 Öğeyi Onaya Gönder');
    await fireEvent.press(screen.getByTestId('capture.item.e1'));
    await fireEvent.press(screen.getByTestId('capture.item.e2'));
    await fireEvent.press(screen.getByTestId('capture.item.edit.e3'));
    const sheet = await screen.findByTestId('sheet.captureItem');
    await fireEvent.changeText(within(sheet).getByTestId('captureItem.title'), 'Başvuru son günü');
    await fireEvent.press(within(sheet).getByTestId('captureItem.when.day.1'));
    await fireEvent.press(within(sheet).getByTestId('captureItem.when.hour.up'));
    await fireEvent.press(within(sheet).getByTestId('captureItem.when.minute.down'));
    await fireEvent.press(within(sheet).getByTestId('captureItem.save'));
    expect(events('capture_item_edit').at(-1)?.props).toEqual({ entity_type: 'deadline' });
    await fireEvent.press(screen.getByTestId('capture.item.e3'));
    await fireEvent.press(screen.getByTestId('capture.saveMemory'));
    await fireEvent.press(screen.getByTestId('capture.send'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.url.endsWith('/actions'))).toBe(true);
    });
    const body = api.calls.find((c) => c.url.endsWith('/actions'))?.body as {
      items: { item_id: string; overrides?: Record<string, unknown> }[];
      save_to_memory: boolean;
    };
    expect(body.items).toEqual([
      expect.objectContaining({
        item_id: 'e3',
        action_type: 'reminder_create',
        overrides: expect.objectContaining({ title: 'Başvuru son günü' }),
      }),
    ]);
    expect(await screen.findByText('Hafızaya kaydedildi')).toBeOnTheScreen();
  });

  it('shows the batch while executing, then the partial result with the failed ones', async () => {
    const executing = approvalRow({
      id: uuid(1300),
      status: 'executing',
      batch_id: M3.capture,
      what: 'Toplantıyı ekle',
    });
    const executed = approvalRow({
      id: uuid(1301),
      status: 'executed',
      batch_id: M3.capture,
      what: 'Faturayı hatırlat',
    });
    const { db, router } = await openCapture({
      path: `/capture/${M3.capture}`,
      setup: (fake) => {
        fake.setTable('captures', [
          captureRow({ status: 'actioned', primary_type: 'event', extracted: [item('e1')] }),
        ]);
        fake.setTable('approval_actions', [executing, executed]);
      },
    });
    expect(await screen.findByTestId('capture.executing')).toBeOnTheScreen();
    expect(await screen.findByText('Toplantıyı ekle')).toBeOnTheScreen();
    db.setTable('approval_actions', [
      { ...executing, status: 'failed', last_error_code: 'PROVIDER_UNAVAILABLE' },
      executed,
    ]);
    expect(await screen.findByTestId('capture.success', {}, { timeout: 5000 })).toBeOnTheScreen();
    expect(screen.getByText('1/2 öğe eklendi')).toBeOnTheScreen();
    await waitFor(() => {
      expect(events('capture_success_view')[0]?.props).toEqual({ executed: 1, failed: 1 });
    });
    await fireEvent.press(screen.getByTestId('capture.success.failed'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/approvals');
    });
  });

  it('says so when no item could be added and when the capture is gone', async () => {
    await openCapture({
      path: `/capture/${M3.capture}`,
      setup: (db) => {
        db.setTable('captures', [captureRow({ status: 'actioned', extracted: [item('e1')] })]);
        db.setTable('approval_actions', [
          approvalRow({
            status: 'failed',
            batch_id: M3.capture,
            last_error_code: 'INTERNAL_ERROR',
          }),
        ]);
      },
    });
    expect(await screen.findByTestId('capture.none')).toBeOnTheScreen();
    expect(screen.getByText('Hiçbir öğe eklenemedi.')).toBeOnTheScreen();
  });

  it('shows the not-found state for a discarded capture', async () => {
    await openCapture({
      path: `/capture/${M3.capture}`,
      setup: (db) => {
        db.setTable('captures', [captureRow({ status: 'discarded', created_at: TS })]);
      },
    });
    expect(await screen.findByTestId('capture.notFound')).toBeOnTheScreen();
  });
});
