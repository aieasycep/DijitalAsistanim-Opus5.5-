/**
 * Text inputs (DESIGN_AUDIT §3.8). Rule (verbatim P:01): "Odak: 2px indigo halka, gölge yok. Hata:
 * coral halka + altta ikonlu mesaj. Sohbet girişi yazı başladığında mikrofon → gönder (ink) olur."
 * Placeholders use `text.tertiaryStrong`; the caret is primary. Labels come from the caller.
 */
import { useState, type JSX, type ReactNode } from 'react';
import {
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Icon } from '../../icons/Icon.tsx';
import type { IconName } from '../../icons/generated/index.ts';
import { PressableScale } from '../../primitives/PressableScale.tsx';
import { Text } from '../../primitives/Text.tsx';
import { textStyle } from '../../theme/fonts.ts';
import { useUiStrings } from '../../theme/preferences.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import type { Theme } from '../../theme/theme.ts';
import { IconButton } from '../buttons/IconButton.tsx';

type NativeInputProps = Pick<
  TextInputProps,
  | 'autoCapitalize'
  | 'autoComplete'
  | 'autoCorrect'
  | 'autoFocus'
  | 'keyboardType'
  | 'maxLength'
  | 'onBlur'
  | 'onFocus'
  | 'onSubmitEditing'
  | 'returnKeyType'
  | 'secureTextEntry'
  | 'textContentType'
  | 'inputMode'
>;

export interface TextFieldProps extends NativeInputProps {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  /** Visible label above the field (optional; `accessibilityLabel` is used otherwise). */
  readonly label?: string;
  readonly accessibilityLabel?: string;
  readonly placeholder?: string;
  /** Error helper ("Geçerli bir e-posta adresi gir."): coral ring + icon message, announced. */
  readonly error?: string;
  /** Neutral helper under the field. */
  readonly helper?: string;
  /** Leading text ("@") in tertiary-strong. */
  readonly prefix?: string;
  readonly leadingIcon?: IconName;
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

function fieldColors(theme: Theme, focused: boolean, error: boolean, disabled: boolean) {
  const c = theme.color;
  return {
    bg: disabled ? c.surfaceSunken : c.surface,
    text: disabled ? c.text.disabled : c.text.primary,
    ring: error
      ? theme.elevation('errorRing')
      : focused
        ? theme.elevation('focusRing')
        : disabled
          ? null
          : theme.elevation('s1'),
  };
}

/** 52 min-height field, radius 16, 15 px; focus/error rings replace the shadow. */
export function TextField({
  value,
  onChangeText,
  label,
  accessibilityLabel,
  placeholder: placeholderText,
  error,
  helper,
  prefix,
  leadingIcon,
  disabled = false,
  style,
  testID,
  onFocus,
  onBlur,
  ...native
}: TextFieldProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const [focused, setFocused] = useState(false);
  const colors = fieldColors(theme, focused, error !== undefined, disabled);
  return (
    <View style={style}>
      {label === undefined ? null : (
        <Text variant="labelSm" tone="secondary" style={{ marginBottom: 6, marginLeft: 4 }}>
          {label}
        </Text>
      )}
      <View
        style={[
          {
            minHeight: theme.size.input,
            borderRadius: theme.radius.input,
            paddingHorizontal: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[2],
            backgroundColor: colors.bg,
          },
          colors.ring,
        ]}
      >
        {leadingIcon === undefined ? null : (
          <Icon name={leadingIcon} size={18} color={c.text.tertiaryStrong} />
        )}
        {prefix === undefined ? null : (
          <Text variant="body" tone="tertiaryStrong">
            {prefix}
          </Text>
        )}
        <TextInput
          testID={testID ?? 'ui.textField'}
          {...native}
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          placeholder={placeholderText}
          placeholderTextColor={c.text.tertiaryStrong}
          selectionColor={c.brand.primary}
          cursorColor={c.brand.primary}
          accessibilityLabel={accessibilityLabel ?? label ?? placeholderText}
          accessibilityHint={error}
          accessibilityState={{ disabled }}
          allowFontScaling
          maxFontSizeMultiplier={2}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[textStyle('body'), { flex: 1, color: colors.text, paddingVertical: 14 }]}
        />
      </View>
      {error === undefined ? null : (
        <View
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            marginTop: 6,
            paddingHorizontal: 4,
          }}
        >
          <Icon name="error" size={14} color={theme.tone.critical.text} />
          <Text variant="meta" tone="critical">
            {error}
          </Text>
        </View>
      )}
      {error === undefined && helper !== undefined ? (
        <Text variant="meta" tone="tertiaryStrong" style={{ marginTop: 6, paddingHorizontal: 4 }}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

export interface UrlFieldProps extends Omit<
  TextFieldProps,
  'keyboardType' | 'leadingIcon' | 'prefix'
> {
  readonly keyboardType?: KeyboardTypeOptions;
}

/** 52/16 link field (`link` 18, single line, `url` keyboard). */
export function UrlField({ keyboardType = 'url', ...props }: UrlFieldProps): JSX.Element {
  return (
    <TextField
      {...props}
      leadingIcon="link"
      keyboardType={keyboardType}
      autoCapitalize="none"
      autoCorrect={false}
      testID={props.testID ?? 'ui.urlField'}
    />
  );
}

export interface SearchFieldProps {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly placeholder?: string;
  readonly accessibilityLabel: string;
  /** Clear button label (defaults to "Kapat"). */
  readonly clearLabel?: string;
  readonly onSubmit?: () => void;
  readonly autoFocus?: boolean;
  readonly testID?: string;
}

/** 44 h pill search with `search` 18 and a clear button (`role=search`). */
export function SearchField({
  value,
  onChangeText,
  placeholder: placeholderText,
  accessibilityLabel,
  clearLabel,
  onSubmit,
  autoFocus,
  testID,
}: SearchFieldProps): JSX.Element {
  const theme = useTheme();
  const strings = useUiStrings();
  const c = theme.color;
  const [focused, setFocused] = useState(false);
  return (
    <View
      accessibilityRole="search"
      style={[
        {
          minHeight: theme.size.search,
          borderRadius: theme.radius.pill,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
          backgroundColor: c.surface,
        },
        focused ? theme.elevation('focusRing') : theme.elevation('s1'),
      ]}
    >
      <Icon name="search" size={18} color={c.text.tertiaryStrong} />
      <TextInput
        testID={testID ?? 'ui.searchField'}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholderText}
        placeholderTextColor={c.text.tertiaryStrong}
        selectionColor={c.brand.primary}
        cursorColor={c.brand.primary}
        accessibilityLabel={accessibilityLabel}
        returnKeyType="search"
        autoFocus={autoFocus}
        onSubmitEditing={onSubmit}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        allowFontScaling
        maxFontSizeMultiplier={2}
        style={[textStyle('body'), { flex: 1, color: c.text.primary, paddingVertical: 10 }]}
      />
      {value === '' ? null : (
        <PressableScale
          testID="ui.searchField.clear"
          accessibilityLabel={clearLabel ?? strings.actions.close}
          onPress={() => {
            onChangeText('');
          }}
          visualSize={{ width: 18, height: 18 }}
        >
          <Icon name="close" size={18} color={c.text.tertiaryStrong} />
        </PressableScale>
      )}
    </View>
  );
}

export interface CaptureTextFieldProps {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly accessibilityLabel: string;
  /** "Bir not yaz veya yapıştır…" */
  readonly placeholder?: string;
  /** Default 4,000; the counter turns warning at 90%. */
  readonly maxLength?: number;
  /** Counter text ("3.600 / 4.000"), formatted by the caller. */
  readonly counterText?: string;
  /** Chips below ("Sesle yaz", "Yapıştır"). */
  readonly chips?: ReactNode;
  readonly testID?: string;
}

/** Capture note: idle min 52 r16 15 px; focused min 140 r20 17/25 with the focus ring. */
export function CaptureTextField({
  value,
  onChangeText,
  accessibilityLabel,
  placeholder: placeholderText,
  maxLength = 4000,
  counterText,
  chips,
  testID,
}: CaptureTextFieldProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color;
  const [focused, setFocused] = useState(false);
  const nearLimit = value.length >= maxLength * 0.9;
  return (
    <View style={{ gap: 10 }}>
      <View
        style={[
          {
            minHeight: focused ? 140 : 52,
            borderRadius: focused ? theme.radius.card : theme.radius.input,
            paddingVertical: 14,
            paddingHorizontal: 16,
            backgroundColor: c.surface,
          },
          focused ? theme.elevation('focusRing') : theme.elevation('s1'),
        ]}
      >
        <TextInput
          testID={testID ?? 'ui.captureTextField'}
          multiline
          value={value}
          onChangeText={onChangeText}
          maxLength={maxLength}
          placeholder={placeholderText}
          placeholderTextColor={c.text.tertiaryStrong}
          selectionColor={c.brand.primary}
          cursorColor={c.brand.primary}
          accessibilityLabel={accessibilityLabel}
          allowFontScaling
          maxFontSizeMultiplier={2}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          style={[
            textStyle(focused ? 'emph' : 'body', focused ? 400 : undefined),
            { color: c.text.primary, padding: 0, lineHeight: focused ? 25 : 22 },
          ]}
        />
      </View>
      {chips === undefined && counterText === undefined ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {chips}
          <View style={{ flex: 1 }} />
          {counterText === undefined ? null : (
            <Text variant="meta" tone={nearLimit ? 'warning' : 'tertiaryStrong'} numeric>
              {counterText}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

export interface ChatComposerProps {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly onSend: () => void;
  /** Voice question (mic, shown while empty). */
  readonly onMic?: () => void;
  /** Leading "+" (capture). */
  readonly onAttach?: () => void;
  /** "Dijital hayatına sor…" / "{Ad} hakkında sor…" / "Günlük AI sınırına ulaştın" */
  readonly placeholder?: string;
  readonly accessibilityLabel: string;
  /** "Gönder" */
  readonly sendLabel: string;
  /** "Sesli sor" */
  readonly micLabel?: string;
  readonly attachLabel?: string;
  /** Offline / rate-limited: input disabled, reason announced. */
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly sending?: boolean;
  readonly testID?: string;
}

/** Chat composer (alias `ChatInput`): 52 pill, `shadow.composer`, mic → send morph. */
export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onMic,
  onAttach,
  placeholder: placeholderText,
  accessibilityLabel,
  sendLabel,
  micLabel,
  attachLabel,
  disabled = false,
  disabledReason,
  sending = false,
  testID,
}: ChatComposerProps): JSX.Element {
  const theme = useTheme();
  const strings = useUiStrings();
  const c = theme.color;
  const [focused, setFocused] = useState(false);
  const hasText = value.trim() !== '';
  return (
    <View
      testID={testID ?? 'ui.chatComposer'}
      style={[
        {
          minHeight: theme.size.composer,
          borderRadius: theme.radius.pill,
          paddingLeft: onAttach === undefined ? 16 : 6,
          paddingRight: 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: c.surface,
          opacity: disabled ? theme.opacity.disabled : 1,
        },
        focused ? theme.elevation('focusRing') : theme.elevation('composer'),
      ]}
    >
      {onAttach === undefined || attachLabel === undefined ? null : (
        <IconButton
          icon="add"
          accessibilityLabel={attachLabel}
          onPress={onAttach}
          variant="plain"
          disabled={disabled}
        />
      )}
      <TextInput
        testID="ui.chatComposer.input"
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        multiline
        placeholder={disabled && disabledReason !== undefined ? disabledReason : placeholderText}
        placeholderTextColor={c.text.tertiaryStrong}
        selectionColor={c.brand.primary}
        cursorColor={c.brand.primary}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={disabled ? disabledReason : undefined}
        accessibilityState={{ disabled }}
        allowFontScaling
        maxFontSizeMultiplier={1.6}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        style={[
          textStyle('body'),
          { flex: 1, color: c.text.primary, paddingVertical: 12, maxHeight: 120 },
        ]}
      />
      {hasText || onMic === undefined ? (
        <IconButton
          icon="arrow_upward"
          accessibilityLabel={sendLabel}
          onPress={onSend}
          variant="send"
          disabled={disabled || !hasText}
          loading={sending}
          testID="ui.chatComposer.send"
        />
      ) : (
        <IconButton
          icon="mic"
          accessibilityLabel={micLabel ?? strings.a11y.microphone}
          onPress={onMic}
          variant="mic"
          disabled={disabled}
          testID="ui.chatComposer.mic"
        />
      )}
    </View>
  );
}

export const ChatInput = ChatComposer;
