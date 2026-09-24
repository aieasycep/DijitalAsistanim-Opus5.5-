'use client';

import { useId, type ReactNode } from 'react';

import { FieldMessage, Input, Label, Textarea, fieldClassName } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/*
 * Labelled native form controls for the action dialogs and editors (BACKOFFICE_PLAN §5.9): radio
 * and checkbox groups in a fieldset with a legend, selects, text and number inputs and textareas,
 * each with an optional help line linked through `aria-describedby`.
 */

export interface Choice<V extends string = string> {
  readonly value: V;
  readonly label: string;
  readonly disabled?: boolean;
  readonly hint?: string;
}

export function RadioField<V extends string>({
  legend,
  options,
  value,
  onChange,
  inline = true,
  help,
}: {
  legend: string;
  options: readonly Choice<V>[];
  value: V | null;
  onChange: (value: V) => void;
  inline?: boolean;
  help?: string;
}) {
  const name = useId();
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-bo-body font-semibold text-ink">{legend}</legend>
      <div className={cn('flex gap-x-4 gap-y-2', inline ? 'flex-wrap' : 'flex-col')}>
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex min-h-8 items-center gap-2 text-bo-body text-ink',
              option.disabled === true && 'opacity-40',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => {
                onChange(option.value);
              }}
              className="size-4 accent-[var(--da-brand-primary)]"
            />
            <span>{option.label}</span>
            {option.hint === undefined ? null : (
              <span className="text-bo-meta text-ink-3">{option.hint}</span>
            )}
          </label>
        ))}
      </div>
      {help === undefined ? null : <FieldMessage>{help}</FieldMessage>}
    </fieldset>
  );
}

export function CheckboxField<V extends string>({
  legend,
  options,
  values,
  onChange,
  help,
}: {
  legend: string;
  options: readonly Choice<V>[];
  values: readonly V[];
  onChange: (values: V[]) => void;
  help?: string;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-bo-body font-semibold text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-8 items-center gap-2 text-bo-body text-ink"
          >
            <input
              type="checkbox"
              value={option.value}
              checked={values.includes(option.value)}
              disabled={option.disabled}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...values.filter((v) => v !== option.value), option.value]
                    : values.filter((v) => v !== option.value),
                );
              }}
              className="size-4 accent-[var(--da-brand-primary)]"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {help === undefined ? null : <FieldMessage>{help}</FieldMessage>}
    </fieldset>
  );
}

export function SelectField<V extends string>({
  label,
  options,
  value,
  onChange,
  help,
  className,
}: {
  label: string;
  options: readonly Choice<V>[];
  value: V;
  onChange: (value: V) => void;
  help?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        aria-describedby={help === undefined ? undefined : `${id}-help`}
        onChange={(event) => {
          onChange(event.target.value as V);
        }}
        className={cn(fieldClassName, 'h-10')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {help === undefined ? null : <FieldMessage id={`${id}-help`}>{help}</FieldMessage>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  help,
  error,
  type = 'text',
  mono = false,
  maxLength,
  required,
  min,
  max,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: ReactNode;
  error?: string | null;
  type?: 'text' | 'number' | 'email' | 'datetime-local' | 'date';
  mono?: boolean;
  maxLength?: number;
  required?: boolean;
  min?: number;
  max?: number;
  className?: string;
}) {
  const id = useId();
  const described = [help === undefined ? null : `${id}-help`, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        maxLength={maxLength}
        required={required}
        min={min}
        max={max}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error !== undefined && error !== null}
        aria-describedby={described === '' ? undefined : described}
        className={cn(mono && 'font-mono')}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {help === undefined ? null : <FieldMessage id={`${id}-help`}>{help}</FieldMessage>}
      {error ? (
        <FieldMessage id={`${id}-error`} tone="error">
          {error}
        </FieldMessage>
      ) : null}
    </div>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  help,
  maxLength,
  rows = 4,
  mono = false,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: ReactNode;
  maxLength?: number;
  rows?: number;
  mono?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        spellCheck={!mono}
        aria-describedby={help === undefined ? undefined : `${id}-help`}
        className={cn(mono && 'font-mono text-bo-mono')}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {help === undefined ? null : <FieldMessage id={`${id}-help`}>{help}</FieldMessage>}
    </div>
  );
}
