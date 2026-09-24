/**
 * AI Memory chunks (IMPLEMENTATION_PLAN T-5.07; AI_PIPELINE_PLAN §10.1; JOB-16).
 *
 * Chunks hold derived facts only — summaries, key points, events, commitments, life events,
 * capture extractions, meeting-note summaries and person facts — never a raw mail body. Each
 * chunk carries the provenance of its source row, the contact ids it concerns (person-scoped
 * search) and the source's `expires_at`, so retention removes memory together with its source.
 */
import { sha256Hex, type StoredEvidence } from '@da/domain';
import { clip } from '../copy.ts';
import type { MemorySource } from '../intel/store.ts';
import type { MemoryChunkInsert } from '../intel/types.ts';

export const CHUNK_MAX_CHARS = 2000;

/** Whitespace-normalised content (the hash input). */
export function normalizeChunk(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkHash(content: string): string {
  return sha256Hex(normalizeChunk(content));
}

/** A source → `memory_chunks` insert; null when nothing derived is left to store. */
export function chunkRow(source: MemorySource): MemoryChunkInsert | null {
  const content = clip(normalizeChunk(source.content), CHUNK_MAX_CHARS);
  if (content.length === 0) return null;
  return {
    user_id: source.userId,
    chunk_kind: source.chunkKind,
    content,
    content_hash: chunkHash(content),
    contact_ids: [...new Set(source.contactIds)],
    occurred_at: source.occurredAt,
    page_no: null,
    source_type: source.sourceType,
    source_id: source.sourceId,
    source_provider: source.sourceProvider,
    source_timestamp: source.sourceTimestamp,
    confidence: Math.round(Math.min(1, Math.max(0, source.confidence)) * 1000) / 1000,
    evidence: source.evidence.slice(0, 5),
    expires_at: source.expiresAt,
  };
}

const line = (label: string, value: string | null | undefined): string[] =>
  value === null || value === undefined || value.trim() === '' ? [] : [`${label}: ${value.trim()}`];

/** Thread summary chunk text (subject, people, date, summary, key points). */
export function threadChunkText(input: {
  readonly subject: string | null;
  readonly people: readonly string[];
  readonly date: string;
  readonly summary: string | null;
  readonly keyPoints: readonly string[];
  readonly topic: string | null;
}): string {
  return [
    ...line('Konu', input.subject),
    ...line('Kişiler', input.people.join(', ')),
    ...line('Tarih', input.date),
    ...line('Başlık', input.topic),
    ...line('Özet', input.summary),
    ...input.keyPoints.map((k) => `- ${k}`),
  ].join('\n');
}

export function lifeChunkText(input: {
  readonly title: string;
  readonly type: string;
  readonly when: string | null;
  readonly amount: string | null;
  readonly fields: Readonly<Record<string, unknown>>;
}): string {
  const fields = Object.entries(input.fields)
    .filter(
      ([k, v]) =>
        typeof v === 'string' && v !== '' && !['origin', 'cta_url', 'tracking_url'].includes(k),
    )
    .map(([k, v]) => `${k}: ${String(v)}`)
    .slice(0, 8);
  return [
    input.title,
    ...line('Tür', input.type),
    ...line('Zaman', input.when),
    ...line('Tutar', input.amount),
    ...fields,
  ].join('\n');
}

export function commitmentChunkText(input: {
  readonly direction: 'user_owes' | 'they_owe';
  readonly text: string;
  readonly counterparty: string | null;
  readonly due: string | null;
}): string {
  return [
    input.direction === 'user_owes' ? 'Verdiğin söz' : 'Sana verilen söz',
    input.text,
    ...line('Kişi', input.counterparty),
    ...line('Son tarih', input.due),
  ].join('\n');
}

/** Verified evidence travels with the chunk (quote ≤300). */
export function chunkEvidence(
  list: readonly StoredEvidence[] | null | undefined,
): StoredEvidence[] {
  return [...(list ?? [])].slice(0, 5);
}
