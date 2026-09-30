/**
 * The golden sets of `_shared/ai/evals/*.jsonl` (synthetic Turkish cases; AI_PIPELINE_PLAN §16.2)
 * for the `ai_eval` job and the `ai-eval` workflow. They are read from the files next to this module
 * (the `worker` function ships them as static files, `supabase/config.toml`), parsed line by line,
 * and versioned by the SHA-256 of their bytes: `eval_dataset_version` changes whenever a set does.
 */
import { sha256Hex } from '../../crypto/hmac.ts';

export interface DatasetReader {
  read(name: string): Promise<string>;
}

/** The eval sets that can be read (file names under `_shared/ai/evals/`). */
export const EVAL_DATASETS = [
  'triage-tr.jsonl',
  'injection.jsonl',
  'post-meeting-tr.jsonl',
  'meeting-prep-tr.jsonl',
  'assistant-intent-tr.jsonl',
  'reply-draft-tr.jsonl',
  'capture-tr.jsonl',
] as const;
export type EvalDataset = (typeof EVAL_DATASETS)[number];

/** Reads the sets shipped next to this module. */
export function fileDatasets(base: URL = new URL('.', import.meta.url)): DatasetReader {
  return {
    read(name) {
      if (!(EVAL_DATASETS as readonly string[]).includes(name)) {
        return Promise.reject(new Error(`unknown eval dataset ${name}`));
      }
      return Deno.readTextFile(new URL(name, base));
    },
  };
}

/** One JSON object per non-empty line. */
export function parseJsonl<T>(text: string): T[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

/** Loads the sets once per run (a reader with a small cache). */
export function cachedReader(reader: DatasetReader): DatasetReader {
  const cache = new Map<string, Promise<string>>();
  return {
    read(name) {
      let hit = cache.get(name);
      if (hit === undefined) {
        hit = reader.read(name);
        cache.set(name, hit);
      }
      return hit;
    },
  };
}

/** `sha256:<first 16 hex>` over the named sets in order (`prompt_versions.eval_dataset_version`). */
export async function datasetVersion(
  reader: DatasetReader,
  names: readonly string[],
): Promise<string> {
  const texts = await Promise.all(names.map((name) => reader.read(name)));
  const digest = await sha256Hex(names.map((n, i) => `${n}\n${texts[i]}`).join('\n\u0000\n'));
  return `sha256:${digest.slice(0, 16)}`;
}
