/**
 * M-CAP-01 Ekle (capture composer; `/capture`, modal) with M-CAP-02 photo source, M-CAP-03 file
 * picker and M-CAP-04 share intake (`?entry=share`): text, link, photo, screenshot, PDF/file.
 * Analysis starts only on "Analiz Et" (M§27): text → `POST /captures` → analyze; link → the preview
 * capture → analyze; files → signed upload (real byte progress) → analyze; then `capture/{id}`.
 * The system photo picker needs no media permission (no `READ_MEDIA_IMAGES`); the camera asks
 * only on "Kamera". Free users see the contextual Pro gate in place of the sources and the CTA
 * (a shared payload waits); offline, composing works and analysis is disabled.
 */
import { toUpper } from '@da/i18n';
import {
  BottomSheet,
  Button,
  CaptureSourceTiles,
  CaptureTextField,
  ChipWrap,
  ConfirmDialog,
  DetailHeader,
  EmptyState,
  FileRow,
  LinkPreviewCard,
  MediaPreview,
  PrivacyNote,
  HintRow,
  StickyCTABar,
  Text,
  TokenChip,
  UrlField,
  AssistChip,
  useTheme,
} from '@da/ui';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { clearStagedShare } from '../../../modules/da-share/src/stage';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { ContextualGate, isPro } from '../pro-gate/ProGate';
import { useLang } from '../common/DateTimeFields';
import { useDictation } from '../meeting/dictation';
import {
  clearDraft,
  isDraftEmpty,
  isSharedDraft,
  MAX_FILES,
  MAX_TEXT,
  setDraft,
  useCaptureDraft,
  type DraftFile,
  type DraftFileKind,
} from './draft';
import {
  analyzeCapture,
  checkFile,
  checkUrl,
  createLinkCapture,
  createShareCapture,
  createTextCapture,
  discardCapture,
  linkProblemOf,
  uploadFile,
  type LinkProblem,
} from './flows';

const LINK_DEBOUNCE_MS = 600;
type Mode = 'text' | 'link' | 'media';
type Entry = 'in_app' | 'share' | 'assistant' | 'today';

function entryOf(value: string | undefined): Entry {
  return value === 'share' || value === 'assistant' || value === 'today' ? value : 'in_app';
}

/** Appends dictated or pasted text on a new word boundary. */
export function joinText(current: string, addition: string): string {
  const next = addition.trim();
  if (next === '') return current;
  if (current.trim() === '') return next;
  return /\s$/.test(current) ? `${current}${next}` : `${current} ${next}`;
}

function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

export function ComposerScreen() {
  const params = useLocalSearchParams<{ kind?: string; entry?: string; unsupported?: string }>();
  const t = useTranslations('capture');
  const common = useTranslations('common');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const lang = useLang();
  const draft = useCaptureDraft();
  const pro = isPro();
  const entry = entryOf(params.entry);
  // "Sesle yaz": on-device dictation into the field (not Voice mode, M§25).
  const dictation = useDictation((text) => {
    setDraft((d) => ({ ...d, text: joinText(d.text, text) }));
  });
  // "Yapıştır": the clipboard is read only after the tap (iOS shows its paste prompt).
  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '');
    if (text.trim() === '') {
      showToast({ message: t('text.pasteEmpty'), kind: 'neutral' });
      return;
    }
    setDraft((d) => ({ ...d, text: joinText(d.text, text) }));
  };
  const [mode, setMode] = useState<Mode>(() =>
    params.kind === 'link'
      ? 'link'
      : draft.files.length > 0
        ? 'media'
        : draft.url !== ''
          ? 'link'
          : 'text',
  );
  const [serverLinkProblem, setLinkProblem] = useState<LinkProblem | null>(null);
  const [preview, setPreview] = useState<{ title: string | null; domain: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [photoSheet, setPhotoSheet] = useState(params.kind === 'photo');
  const [fileSheet, setFileSheet] = useState(params.kind === 'pdf' || params.kind === 'file');
  const [confirmClose, setConfirmClose] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [cameraDenied, setCameraDenied] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const kind = (['photo', 'screenshot', 'pdf', 'file', 'link', 'text'] as const).find(
      (k) => k === params.kind,
    );
    track('capture_start', { kind: kind ?? (entry === 'share' ? 'share' : 'text'), entry });
    if (!pro)
      track('pro_gate_viewed', {
        feature: 'capture',
        surface: 'inline',
        gate: 'capture',
        context: 'inline',
      });
  }, [entry, params.kind, pro]);

  // Link preview: debounced `POST /captures {kind:'link'}` (the SSRF-safe fetcher runs server-side).
  useEffect(() => {
    if (mode !== 'link') return;
    const url = draft.url.trim();
    if (url === '' || checkUrl(url) !== null || !online || !pro) return;
    const timer = setTimeout(() => {
      setPreviewing(true);
      void createLinkCapture(url, draft.shareOrigin)
        .then((capture) => {
          setDraft((d) => ({ ...d, linkCaptureId: capture.id }));
          setPreview(capture.link_preview);
          if (capture.link_preview === null) setLinkProblem('preview_failed');
        })
        .catch((error: unknown) => {
          setLinkProblem(linkProblemOf(error));
        })
        .finally(() => {
          setPreviewing(false);
        });
    }, LINK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [mode, draft.url, draft.shareOrigin, online, pro]);

  const linkProblem = checkUrl(draft.url) ?? serverLinkProblem;

  const addFiles = (files: readonly DraftFile[]) => {
    const accepted: DraftFile[] = [];
    let problem: string | null = null;
    for (const file of files) {
      const issue = checkFile(file);
      if (issue === 'too_large')
        problem = t('errors.tooLarge', {
          limit: file.mime === 'application/pdf' ? '20 MB' : '15 MB',
        });
      else if (issue === 'unsupported') problem = t('errors.unsupported');
      else accepted.push(file);
    }
    setFileError(problem);
    setDraft((d) => ({ ...d, files: [...d.files, ...accepted].slice(0, MAX_FILES) }));
    if (accepted.length > 0) setMode('media');
  };

  const fromAssets = (assets: readonly ImagePicker.ImagePickerAsset[], kind: DraftFileKind) =>
    assets.map((asset, index) => ({
      uri: asset.uri,
      mime: asset.mimeType ?? 'image/jpeg',
      name: asset.fileName ?? `${kind}-${String(index + 1)}.jpg`,
      size: asset.fileSize ?? 0,
      kind,
    }));

  const pickLibrary = async (kind: 'photo' | 'screenshot') => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_FILES - draft.files.length,
      quality: 0.8,
    });
    if (result.canceled) return;
    if (kind === 'photo') track('capture_photo_source', { source: 'library' });
    addFiles(fromAssets(result.assets, kind));
  };

  const pickCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setCameraDenied(true);
      return;
    }
    try {
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (result.canceled) return;
      track('capture_photo_source', { source: 'camera' });
      addFiles(fromAssets(result.assets, 'photo'));
    } catch {
      showToast({ message: t('errors.cameraUnavailable'), kind: 'error' });
    }
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset === undefined) return;
    const mime = asset.mimeType ?? 'application/octet-stream';
    track('capture_file_pick', {
      origin: 'device',
      kind: mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? 'image' : 'file',
    });
    addFiles([
      {
        uri: asset.uri,
        mime,
        name: asset.name,
        size: asset.size ?? 0,
        kind: mime === 'application/pdf' ? 'pdf' : 'file',
      },
    ]);
  };

  const hasContent = !isDraftEmpty(draft);
  const textTooLong = draft.text.length > MAX_TEXT && !isSharedDraft(draft);
  const canAnalyze =
    pro &&
    online &&
    !analyzing &&
    hasContent &&
    !textTooLong &&
    (mode !== 'link' || linkProblem === null || linkProblem === 'preview_failed');

  const analyze = async () => {
    if (!canAnalyze) return;
    setAnalyzing(true);
    const origin = draft.shareOrigin;
    try {
      let firstId: string | null = null;
      if (draft.files.length > 0) {
        const ids: string[] = [];
        for (const [index, file] of draft.files.entries()) {
          const id = await uploadFile(file, origin, (fraction) => {
            setProgress(Math.round(((index + fraction) / draft.files.length) * 100));
          });
          await analyzeCapture(id);
          ids.push(id);
        }
        firstId = ids[0] ?? null;
        track('capture_created', {
          kind: draft.files.length > 1 ? 'share' : (draft.files[0]?.kind ?? 'photo'),
          via: isSharedDraft(draft) ? 'share' : 'in_app',
          file_count: draft.files.length,
        });
        if (ids.length > 1)
          showToast({ message: t('multiQueued', { count: ids.length }), kind: 'neutral' });
      } else if (isSharedDraft(draft)) {
        const capture = await createShareCapture(draft.text, draft.url, origin);
        await analyzeCapture(capture.id);
        firstId = capture.id;
        track('capture_created', { kind: 'share', via: 'share', file_count: 0 });
      } else if (mode === 'link' && draft.url.trim() !== '') {
        const id = draft.linkCaptureId ?? (await createLinkCapture(draft.url, origin)).id;
        await analyzeCapture(id);
        firstId = id;
        track('capture_created', { kind: 'link', via: 'in_app', file_count: 0 });
      } else {
        const capture = await createTextCapture(draft.text, origin);
        await analyzeCapture(capture.id);
        firstId = capture.id;
        track('capture_created', { kind: 'text', via: 'in_app', file_count: 0 });
      }
      clearDraft();
      void clearStagedShare().catch(() => undefined);
      if (firstId !== null) router.replace(`/capture/${firstId}`);
    } catch {
      showToast({ message: t('errors.uploadFailed'), kind: 'error' });
    } finally {
      setAnalyzing(false);
      setProgress(null);
    }
  };

  const close = () => {
    if (hasContent) {
      setConfirmClose(true);
      return;
    }
    track('capture_cancel', { stage: 'compose' });
    router.back();
  };
  const discardDraft = () => {
    const linkId = draft.linkCaptureId;
    setConfirmClose(false);
    clearDraft();
    void clearStagedShare().catch(() => undefined);
    if (linkId !== null && online) void discardCapture(linkId).catch(() => undefined);
    track('capture_cancel', { stage: 'compose' });
    if (router.canGoBack()) router.back();
    else router.replace('/today');
  };

  const linkError =
    linkProblem === 'invalid'
      ? t('errors.invalidUrl')
      : linkProblem === 'scheme'
        ? t('errors.scheme')
        : linkProblem === 'blocked'
          ? t('errors.blocked')
          : null;
  const kicker = isSharedDraft(draft)
    ? t('kickers.shared')
    : mode === 'link'
      ? t('kickers.link')
      : mode === 'text'
        ? t('kickers.text')
        : t('kickers.base');

  if (params.unsupported === '1' && isDraftEmpty(draft)) {
    return (
      <View
        style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
        testID="screen.capture"
      >
        <DetailHeader
          leading="close"
          onLeadingPress={close}
          leadingAccessibilityLabel={common('actions.close')}
        />
        <View style={[styles.content, { paddingHorizontal: theme.layout.screenX }]}>
          <EmptyState
            icon="block"
            tone="neutral"
            title={t('share.unsupportedTitle')}
            body={t('share.unsupportedBody')}
            action={{ label: common('actions.close'), onPress: close }}
            testID="capture.unsupported"
          />
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.capture"
    >
      <DetailHeader
        leading="close"
        onLeadingPress={close}
        leadingAccessibilityLabel={common('actions.close')}
        kicker={toUpper(kicker, lang)}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="h1" heading>
          {t('title')}
        </Text>
        {isSharedDraft(draft) && draft.shareNotice !== null ? (
          <Text variant="bodyXs" tone="warning" testID="capture.shareNotice">
            {draft.shareNotice === 'truncated'
              ? t('share.truncated')
              : draft.shareNotice === 'too_large'
                ? t('errors.tooLarge', { limit: '20 MB' })
                : t('share.unsupported')}
          </Text>
        ) : null}
        {mode === 'link' ? (
          <View style={styles.section}>
            <UrlField
              label={t('link.hint')}
              value={draft.url}
              onChangeText={(url) => {
                setPreview(null);
                setLinkProblem(null);
                setDraft((d) => ({ ...d, url, linkCaptureId: null }));
              }}
              {...(linkError === null ? {} : { error: linkError })}
              autoFocus
              testID="capture.url"
            />
            {draft.url !== '' ? (
              <ChipWrap>
                <TokenChip
                  label={common('actions.remove')}
                  onRemove={() => {
                    setPreview(null);
                    setDraft((d) => ({ ...d, url: '', linkCaptureId: null }));
                  }}
                  removeLabel={common('actions.remove')}
                  testID="capture.url.clear"
                />
              </ChipWrap>
            ) : null}
            {previewing ? <Text variant="meta">{common('a11y.loading')}</Text> : null}
            {preview !== null ? (
              <LinkPreviewCard
                domain={preview.domain}
                title={preview.title ?? preview.domain}
                testID="capture.preview"
              />
            ) : null}
            {linkProblem === 'preview_failed' ? (
              <Text variant="bodyXs" tone="tertiaryStrong">
                {t('errors.previewFailed')}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.section}>
            <CaptureTextField
              value={
                dictation.partial === '' ? draft.text : joinText(draft.text, dictation.partial)
              }
              onChangeText={(text) => {
                setDraft((d) => ({ ...d, text }));
              }}
              accessibilityLabel={t('text.label')}
              placeholder={t('text.hint')}
              maxLength={isSharedDraft(draft) ? 20_000 : MAX_TEXT + 1}
              counterText={t('text.counter', { count: draft.text.length })}
              testID="capture.text"
            />
            <ChipWrap>
              {dictation.available ? (
                <AssistChip
                  label={
                    dictation.state === 'listening' ? t('text.stopDictation') : t('text.dictate')
                  }
                  icon="mic"
                  onPress={dictation.toggle}
                  testID="capture.dictate"
                />
              ) : null}
              <AssistChip
                label={t('text.paste')}
                icon="content_paste"
                onPress={() => {
                  void paste();
                }}
                testID="capture.paste"
              />
            </ChipWrap>
            {dictation.state === 'denied' ? (
              <Text variant="bodyXs" tone="tertiaryStrong" accessibilityRole="alert">
                {t('text.micDenied')}
              </Text>
            ) : null}
          </View>
        )}
        {textTooLong ? (
          <Text variant="bodyXs" tone="warning" accessibilityRole="alert">
            {t('errors.textTooLong')}
          </Text>
        ) : null}
        {draft.files.length > 0 ? (
          <View style={styles.section} testID="capture.files">
            {draft.files.map((file, index) =>
              file.mime.startsWith('image/') ? (
                <View key={file.uri} style={styles.media}>
                  <MediaPreview
                    source={{ uri: file.uri }}
                    height={140}
                    accessibilityLabel={t('fileA11y', {
                      kind: t(`kinds.${file.kind}`),
                      name: file.name,
                      size: fileSizeLabel(file.size),
                    })}
                  />
                  <TokenChip
                    label={file.name}
                    onRemove={() => {
                      setDraft((d) => ({ ...d, files: d.files.filter((_, i) => i !== index) }));
                    }}
                    removeLabel={common('actions.remove')}
                    testID={`capture.file.remove.${String(index)}`}
                  />
                </View>
              ) : (
                <FileRow
                  key={file.uri}
                  name={file.name}
                  meta={`${t(`kinds.${file.kind}`)} · ${fileSizeLabel(file.size)}`}
                  icon="picture_as_pdf"
                  selected
                  onPress={() => {
                    setDraft((d) => ({ ...d, files: d.files.filter((_, i) => i !== index) }));
                  }}
                  testID={`capture.file.${String(index)}`}
                />
              ),
            )}
          </View>
        ) : null}
        {fileError !== null ? (
          <Text
            variant="bodyXs"
            tone="critical"
            accessibilityRole="alert"
            testID="capture.fileError"
          >
            {fileError}
          </Text>
        ) : null}
        {pro ? (
          <CaptureSourceTiles
            sources={[
              { key: 'photo', label: t('kinds.photo'), icon: 'photo_camera' },
              { key: 'screenshot', label: t('kinds.screenshot'), icon: 'screenshot' },
              { key: 'pdf', label: t('kinds.pdf'), icon: 'picture_as_pdf' },
              { key: 'link', label: t('kinds.link'), icon: 'link' },
            ]}
            {...(mode === 'link' ? { selectedKey: 'link' } : {})}
            onSelect={(key) => {
              if (key === 'photo') setPhotoSheet(true);
              else if (key === 'screenshot') void pickLibrary('screenshot');
              else if (key === 'pdf') setFileSheet(true);
              else setMode(mode === 'link' ? 'text' : 'link');
            }}
            accessibilityLabel={t('sourcesA11y')}
            testID="capture.tiles"
          />
        ) : (
          <ContextualGate
            feature="capture"
            title={t('gate.title')}
            body={t('gate.body')}
            testID="capture.gate"
          />
        )}
        {!pro && isSharedDraft(draft) ? (
          <Text variant="meta" tone="tertiaryStrong">
            {t('share.waitsForPro')}
          </Text>
        ) : null}
        {mode !== 'text' && !isSharedDraft(draft) ? (
          <AssistChip
            label={t('kinds.text')}
            icon="short_text"
            onPress={() => {
              setMode('text');
            }}
            testID="capture.toText"
          />
        ) : null}
        <HintRow text={t('hint')} />
        <PrivacyNote text={t('privacyNote')} />
      </ScrollView>
      {pro ? (
        <StickyCTABar>
          {!online ? (
            <Text variant="meta" tone="warning" testID="capture.offline">
              {t('offline')}
            </Text>
          ) : null}
          <Button
            label={progress === null ? t('analyze') : t('uploading', { percent: progress })}
            onPress={() => {
              void analyze();
            }}
            disabled={!canAnalyze}
            loading={analyzing && progress === null}
            fullWidth
            {...(progress === null
              ? {}
              : { accessibilityValue: { min: 0, max: 100, now: progress } })}
            testID="capture.analyze"
          />
        </StickyCTABar>
      ) : null}
      <BottomSheet
        visible={photoSheet}
        onDismiss={() => {
          setPhotoSheet(false);
          setCameraDenied(false);
        }}
        title={t('sources.title')}
        testID="sheet.photoSource"
      >
        <View style={styles.section}>
          <Button
            label={t('sources.camera')}
            icon="photo_camera"
            onPress={() => {
              void pickCamera().then(() => {
                setPhotoSheet(false);
              });
            }}
            fullWidth
            testID="capture.camera"
          />
          <Button
            label={t('sources.library')}
            variant="tonal"
            onPress={() => {
              setPhotoSheet(false);
              void pickLibrary('photo');
            }}
            fullWidth
            testID="capture.library"
          />
          {cameraDenied ? (
            <View style={styles.section}>
              <Text variant="bodyXs" tone="warning" accessibilityRole="alert">
                {t('errors.cameraDenied')}
              </Text>
              <Button
                label={common('actions.openSettings')}
                variant="neutralTonal"
                onPress={() => {
                  void Linking.openSettings();
                }}
                testID="capture.cameraSettings"
              />
            </View>
          ) : null}
          <Button
            label={common('actions.nevermind')}
            variant="ghost"
            onPress={() => {
              setPhotoSheet(false);
            }}
            fullWidth
          />
        </View>
      </BottomSheet>
      <BottomSheet
        visible={fileSheet}
        onDismiss={() => {
          setFileSheet(false);
        }}
        title={t('files.title')}
        subtitle={t('files.subtitle')}
        testID="sheet.filePicker"
      >
        <View style={styles.section}>
          <FileRow
            name={t('files.fromDevice')}
            icon="folder_open"
            selected={false}
            onPress={() => {
              setFileSheet(false);
              void pickDocument();
            }}
            testID="capture.files.device"
          />
          <Button
            label={common('actions.nevermind')}
            variant="ghost"
            onPress={() => {
              setFileSheet(false);
            }}
            fullWidth
          />
        </View>
      </BottomSheet>
      <ConfirmDialog
        visible={confirmClose}
        title={t('discard.title')}
        icon="delete"
        confirm={{ label: common('actions.delete'), onPress: discardDraft }}
        cancel={{
          label: t('discard.keep'),
          onPress: () => {
            setConfirmClose(false);
            if (router.canGoBack()) router.back();
            else router.replace('/today');
          },
        }}
        testID="capture.discardConfirm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 14, paddingBottom: 140 },
  section: { gap: 8 },
  media: { gap: 6 },
});
