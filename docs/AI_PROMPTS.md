# Dijital Asistan: AI prompts

Documented at `ec14e92`.

This page lists every prompt the AI pipeline can send, as built. The catalogue below is
**generated**; do not edit it by hand. Routing, grounding, budgets and the model tables are in
[AI_PIPELINE.md](AI_PIPELINE.md); the design intent is in
[AI_PIPELINE_PLAN.md §5](AI_PIPELINE_PLAN.md#5-prompt-catalogue-m58).

## Where prompts live

| Layer | Path | Role |
|---|---|---|
| Source of truth | [`supabase/prompts/<prompt_key>.md`](../supabase/prompts) | Front matter (`prompt_key`, `version`, `output_schema_ref`, `model_role`, `changelog`), a `# System` block and a `# User template` block with `{{vars}}` |
| Seed migrations | [`20260924002410_prompt_versions_seed.sql`](../supabase/migrations/20260924002410_prompt_versions_seed.sql), [`20260924002610_prompt_versions_seed_part2.sql`](../supabase/migrations/20260924002610_prompt_versions_seed_part2.sql) | Rendered by [`scripts/gen-prompt-migration.ts`](../scripts/gen-prompt-migration.ts) (`pnpm ai:prompts`). Each key is inserted as `active` only when it has no row yet, so backoffice edits are never overwritten |
| Runtime registry | [`_shared/ai/prompts/registry.ts`](../supabase/functions/_shared/ai/prompts/registry.ts) | Reads the `active` `prompt_versions` row per key, cached per isolate for 60 s; maps each AI feature to its key (`FEATURE_PROMPT_KEY`) |
| Assembly | [`_shared/ai/prompts/assemble.ts`](../supabase/functions/_shared/ai/prompts/assemble.ts) | Builds the request (below) |
| Backoffice | `admin_api.prompt_*` functions, `/ai/prompts` screens | New versions are drafts; activation requires `eval_passed` and a matching `schema_hash`; rollback reactivates an earlier version. See [BACKOFFICE.md](BACKOFFICE.md) |

## How a request is assembled

1. **System block (cached prefix):** the stored `system_prompt` (role, output rules, rubric,
   Turkish rules, examples), then the fixed untrusted-data rule (`UNTRUSTED_RULE` in
   [`_shared/ai/untrusted.ts`](../supabase/functions/_shared/ai/untrusted.ts)), then the per-deploy
   canary `DA-CANARY-{8 hex of DEPLOY_ID}` with the instruction never to output it. The rule and the
   canary are appended at assembly and are never stored in `prompt_versions`.
2. **User turn:** trusted context lines built from our own data, the untrusted documents wrapped
   in `<untrusted_content id kind nonce>` blocks with `<` and `>` escaped (the nonce is per request
   and never part of the cached prefix), and the stored `user_template` with `{{vars}}` filled in.
3. **Output:** structured JSON validated with the `@da/validation` schema named by
   `output_schema_ref`, then the output validators and the grounding checks
   ([AI_PIPELINE.md](AI_PIPELINE.md#grounding-and-output-safety)).

The prompt sources are validated when the seed is generated: the key must be a known
`PromptKey`, the file name must be `<prompt_key>.md`, the schema must exist in `AI_SCHEMAS`, the
role must be `classifier`, `reasoning` or `assistant`, and a model identifier must never appear
in a prompt.

## Regenerating

| Command | Effect |
|---|---|
| `node scripts/docs/gen-ai-prompts.ts` | Rewrites the catalogue below |
| `node scripts/docs/gen-ai-prompts.ts --check` | Fails when this page is out of date (runs in `pnpm test:scripts`) |
| `pnpm docs:generate` / `pnpm docs:check` | All doc generators at once |
| `pnpm ai:prompts` | Re-renders the seed migrations from `supabase/prompts/*.md` |

The **Role** column is the prompt's own `model_role` (shown in the backoffice). Routing picks the
`ai_model_config` row by feature and, where a feature has several rows (`capture_extract`), by
the role the caller asks for. **Purpose** is the first sentence of the system prompt.

## Catalogue

<!-- generated:prompts:start -->

18 prompt keys. Tier columns come from the `ai_model_config` seed ([routing seed](../supabase/seed/ai_model_config.sql)); `→ T3` marks an escalation target, `(disabled)` a seeded row with `enabled = false`.

| Key | Version | Feature | Output schema | Role | Tier · balanced (Pro) | Tier · lean (Free) | Purpose |
|---|---|---|---|---|---|---|---|
| [`assistant`](#assistant) | 1 | `assistant_qa` | `AssistantGroundedJsonV1` | assistant | T2 → T3 | T2 | You are the assistant of Dijital Asistan. You answer the user's question only from the search results you are given (`r1`…`r6`): summaries of the user's own mails, calendar events, notes, commitments, life events and captures. |
| [`assistant_intent`](#assistant_intent) | 1 | `assistant_intent` | `AssistantIntentV1` | classifier | T1 | T1 | You label the intent of a user's message to Dijital Asistan, when the deterministic grammar did not match. The message is the user's own words (`q1`), possibly a voice transcript with recognition noise. |
| [`briefing_evening`](#briefing_evening) | 1 | `briefing_evening` | `BriefingPolishV1` | classifier | T1 | T1 (disabled) | You polish the "Yarına Kalanlar" rows of the evening close of Dijital Asistan. Code has built every row deterministically (`i1`…`iN`, JSON with `title` and `sub`). |
| [`briefing_midday`](#briefing_midday) | 1 | `briefing_midday` | `BriefingPolishV1` | classifier | T1 | T1 (disabled) | You polish the item copy of the midday pulse of Dijital Asistan. Code has built every item deterministically (`i1`…`iN`, JSON with `title` and `sub`). |
| [`briefing_morning`](#briefing_morning) | 1 | `briefing_morning` | `BriefingMorningV1` | reasoning | T2 | T1 | You are the morning briefing writer of Dijital Asistan. Code has already chosen and ranked the day's items; you receive them as JSON documents (`i1`…`iN`, each with its section, title, meta and badge) and a few statistics (`s1`…`s3`). |
| [`capture`](#capture) | 1 | `capture_extract` | `CaptureExtractV1` | classifier | T1 | T1 | You are the Universal Capture extractor of Dijital Asistan. The user shared a text (`n1`) or a web page (`w1`, readable text of a page fetched once without cookies). |
| [`capture_pdf`](#capture_pdf) | 1 | `capture_extract` | `CaptureExtractV1` | reasoning | T2 → T3 | T2 | You read PDF documents for Dijital Asistan's Universal Capture. The user shared a PDF whose pages arrive as text blocks `p1`…`pN` (the page number is the ref), or as a scanned document you must transcribe. |
| [`capture_vision`](#capture_vision) | 1 | `capture_extract` | `CaptureExtractV1` | reasoning | T2 → T3 | T2 | You read photos and screenshots for Dijital Asistan's Universal Capture. The user shared an image (`img1`): a poster, ticket, receipt, invitation, chat screenshot or document photo. |
| [`commitment`](#commitment) | 1 | `commitment_extract` | `CommitmentExtractV1` | classifier | T1 | T1 | You are the commitment detector of Dijital Asistan. You read short texts (`m1`…`m5`): the user's own sent emails and incoming emails. |
| [`email_classification`](#email_classification) | 1 | `email_triage` | `EmailTriageV1` | classifier | T1 | T1 | You are the mail triage engine of Dijital Asistan. You read up to five inbound emails of one user and label each one. |
| [`email_deep_extract`](#email_deep_extract) | 1 | `email_deep_extract` | `EmailDeepExtractV1` | reasoning | T2 | T1 | You are the deep extraction engine of Dijital Asistan. You read one important or complex email (`m1`) and, when present, a previous summary of its thread (`t1`, context only). |
| [`follow_up`](#follow_up) | 1 | `follow_up_draft` | `FollowUpDraftV1` | reasoning | T2 | T1 | You write follow-up messages for Dijital Asistan. The user sent an email (`m1`) and the other side has not replied. |
| [`life_intel`](#life_intel) | 1 | `life_intel_extract` | `LifeIntelV1` | classifier | T1 | T1 | You are the life-intelligence extractor of Dijital Asistan. You read notification emails that no deterministic parser recognised (`m1`…) and locate shipments, flights, reservations, payments and subscriptions. |
| [`meeting_prep`](#meeting_prep) | 1 | `meeting_prep` | `MeetingPrepV1` | reasoning | T2 | T2 | You prepare meeting briefs for Dijital Asistan. You read the event description (`e1`), summaries of recent mails with the attendees (`m1`…), the user's meeting notes (`n1`…) and open commitments (`c1`…). |
| [`post_meeting`](#post_meeting) | 1 | `post_meeting_parse` | `PostMeetingCommitmentV1` | classifier | T1 | T1 | You are the post-meeting note reader of Dijital Asistan. After a meeting the user dictates or types a short note (`n1`). |
| [`reply_draft`](#reply_draft) | 1 | `reply_draft` | `ReplyDraftsV1` | reasoning | T2 | T2 | You write reply drafts for Dijital Asistan. You read the last messages of an email thread (`t1`, `t2`, …; the newest is last) and draft the user's reply in the requested tones. |
| [`thread_summary`](#thread_summary) | 1 | `thread_summary` | `ThreadSummaryV1` | reasoning | T2 | T1 | You are the thread summariser of Dijital Asistan. You read the new messages of one email thread (`m1`…`mN`, oldest first) and, when present, the previous summary of the same thread (`t1`, kind `summary`). |
| [`weekly_review`](#weekly_review) | 1 | `weekly_review` | `WeeklyReviewV1` | reasoning | T2 | T1 | You write the weekly review of Dijital Asistan. Code has computed the week's statistics (`s1`…), the first events of next week (`e1`…) and free blocks of next week (`f1`…). |

### assistant

| Field | Value |
|---|---|
| Source | [supabase/prompts/assistant.md](../supabase/prompts/assistant.md) |
| Version | 1 (İlk sürüm (T-5.11).) |
| Feature | `assistant_qa` |
| Output schema | `AssistantGroundedJsonV1` · `schema_hash` `a3a41b9e7a67`… |
| Model role | assistant |
| Tier (balanced · lean) | T2 → T3 · T2 |
| Fallback chain (balanced) | primary + 2 fallback targets, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 2,187 characters |
| Template variables | none |

> You are the assistant of Dijital Asistan. You answer the user's question only from the search results you are given (`r1`…`r6`): summaries of the user's own mails, calendar events, notes, commitments, life events and captures.

### assistant_intent

| Field | Value |
|---|---|
| Source | [supabase/prompts/assistant_intent.md](../supabase/prompts/assistant_intent.md) |
| Version | 1 (İlk sürüm (T-5.11).) |
| Feature | `assistant_intent` |
| Output schema | `AssistantIntentV1` · `schema_hash` `17288487a20c`… |
| Model role | classifier |
| Tier (balanced · lean) | T1 · T1 |
| Fallback chain (balanced) | primary + 1 fallback target, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 2,488 characters |
| Template variables | none |

> You label the intent of a user's message to Dijital Asistan, when the deterministic grammar did not match. The message is the user's own words (`q1`), possibly a voice transcript with recognition noise.

### briefing_evening

| Field | Value |
|---|---|
| Source | [supabase/prompts/briefing_evening.md](../supabase/prompts/briefing_evening.md) |
| Version | 1 (İlk sürüm (T-5.16).) |
| Feature | `briefing_evening` |
| Output schema | `BriefingPolishV1` · `schema_hash` `f3630d6d93a1`… |
| Model role | classifier |
| Tier (balanced · lean) | T1 · T1 (disabled) |
| Fallback chain (balanced) | primary only, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 1,034 characters |
| Template variables | `{{count}}` |

> You polish the "Yarına Kalanlar" rows of the evening close of Dijital Asistan. Code has built every row deterministically (`i1`…`iN`, JSON with `title` and `sub`).

### briefing_midday

| Field | Value |
|---|---|
| Source | [supabase/prompts/briefing_midday.md](../supabase/prompts/briefing_midday.md) |
| Version | 1 (İlk sürüm (T-5.16).) |
| Feature | `briefing_midday` |
| Output schema | `BriefingPolishV1` · `schema_hash` `f3630d6d93a1`… |
| Model role | classifier |
| Tier (balanced · lean) | T1 · T1 (disabled) |
| Fallback chain (balanced) | primary only, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 1,206 characters |
| Template variables | `{{count}}` |

> You polish the item copy of the midday pulse of Dijital Asistan. Code has built every item deterministically (`i1`…`iN`, JSON with `title` and `sub`).

### briefing_morning

| Field | Value |
|---|---|
| Source | [supabase/prompts/briefing_morning.md](../supabase/prompts/briefing_morning.md) |
| Version | 1 (İlk sürüm (T-5.16).) |
| Feature | `briefing_morning` |
| Output schema | `BriefingMorningV1` · `schema_hash` `78aaea0dd8c2`… |
| Model role | reasoning |
| Tier (balanced · lean) | T2 · T1 |
| Fallback chain (balanced) | primary + 2 fallback targets, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 2,985 characters |
| Template variables | `{{count}}` |

> You are the morning briefing writer of Dijital Asistan. Code has already chosen and ranked the day's items; you receive them as JSON documents (`i1`…`iN`, each with its section, title, meta and badge) and a few statistics (`s1`…`s3`).

### capture

| Field | Value |
|---|---|
| Source | [supabase/prompts/capture.md](../supabase/prompts/capture.md) |
| Version | 1 (İlk sürüm (T-5.13).) |
| Feature | `capture_extract` |
| Output schema | `CaptureExtractV1` · `schema_hash` `2cf4d5d09408`… |
| Model role | classifier |
| Tier (balanced · lean) | T1 · T1 |
| Fallback chain (balanced) | primary + 2 fallback targets, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 2,836 characters |
| Template variables | `{{count}}` |

> You are the Universal Capture extractor of Dijital Asistan. The user shared a text (`n1`) or a web page (`w1`, readable text of a page fetched once without cookies).

### capture_pdf

| Field | Value |
|---|---|
| Source | [supabase/prompts/capture_pdf.md](../supabase/prompts/capture_pdf.md) |
| Version | 1 (İlk sürüm (T-5.13).) |
| Feature | `capture_extract` |
| Output schema | `CaptureExtractV1` · `schema_hash` `2cf4d5d09408`… |
| Model role | reasoning |
| Tier (balanced · lean) | T2 → T3 · T2 |
| Fallback chain (balanced) | primary + 1 fallback target, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 2,217 characters |
| Template variables | `{{count}}` |

> You read PDF documents for Dijital Asistan's Universal Capture. The user shared a PDF whose pages arrive as text blocks `p1`…`pN` (the page number is the ref), or as a scanned document you must transcribe.

### capture_vision

| Field | Value |
|---|---|
| Source | [supabase/prompts/capture_vision.md](../supabase/prompts/capture_vision.md) |
| Version | 1 (İlk sürüm (T-5.13).) |
| Feature | `capture_extract` |
| Output schema | `CaptureExtractV1` · `schema_hash` `2cf4d5d09408`… |
| Model role | reasoning |
| Tier (balanced · lean) | T2 → T3 · T2 |
| Fallback chain (balanced) | primary + 1 fallback target, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 2,322 characters |
| Template variables | none |

> You read photos and screenshots for Dijital Asistan's Universal Capture. The user shared an image (`img1`): a poster, ticket, receipt, invitation, chat screenshot or document photo.

### commitment

| Field | Value |
|---|---|
| Source | [supabase/prompts/commitment.md](../supabase/prompts/commitment.md) |
| Version | 1 (İlk sürüm (T-5.16).) |
| Feature | `commitment_extract` |
| Output schema | `CommitmentExtractV1` · `schema_hash` `2a4a53456e1a`… |
| Model role | classifier |
| Tier (balanced · lean) | T1 · T1 |
| Fallback chain (balanced) | primary + 2 fallback targets, then the T0 path |
| Batch policy · cache TTL (balanced) | `non_urgent` · `5m` |
| System prompt | 3,746 characters |
| Template variables | `{{count}}` |

> You are the commitment detector of Dijital Asistan. You read short texts (`m1`…`m5`): the user's own sent emails and incoming emails.

### email_classification

| Field | Value |
|---|---|
| Source | [supabase/prompts/email_classification.md](../supabase/prompts/email_classification.md) |
| Version | 1 (İlk sürüm (T-5.16).) |
| Feature | `email_triage` |
| Output schema | `EmailTriageV1` · `schema_hash` `accb6302be12`… |
| Model role | classifier |
| Tier (balanced · lean) | T1 · T1 |
| Fallback chain (balanced) | primary + 2 fallback targets, then the T0 path |
| Batch policy · cache TTL (balanced) | `non_urgent` · `5m` |
| System prompt | 8,301 characters |
| Template variables | `{{count}}` |

> You are the mail triage engine of Dijital Asistan. You read up to five inbound emails of one user and label each one.

### email_deep_extract

| Field | Value |
|---|---|
| Source | [supabase/prompts/email_deep_extract.md](../supabase/prompts/email_deep_extract.md) |
| Version | 1 (İlk sürüm (T-5.16).) |
| Feature | `email_deep_extract` |
| Output schema | `EmailDeepExtractV1` · `schema_hash` `b68c84c89f07`… |
| Model role | reasoning |
| Tier (balanced · lean) | T2 · T1 |
| Fallback chain (balanced) | primary + 2 fallback targets, then the T0 path |
| Batch policy · cache TTL (balanced) | `non_urgent` · `5m` |
| System prompt | 3,759 characters |
| Template variables | none |

> You are the deep extraction engine of Dijital Asistan. You read one important or complex email (`m1`) and, when present, a previous summary of its thread (`t1`, context only).

### follow_up

| Field | Value |
|---|---|
| Source | [supabase/prompts/follow_up.md](../supabase/prompts/follow_up.md) |
| Version | 1 (İlk sürüm (T-5.12).) |
| Feature | `follow_up_draft` |
| Output schema | `FollowUpDraftV1` · `schema_hash` `be67ff23b011`… |
| Model role | reasoning |
| Tier (balanced · lean) | T2 · T1 |
| Fallback chain (balanced) | primary + 2 fallback targets, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 2,344 characters |
| Template variables | `{{tone}}` |

> You write follow-up messages for Dijital Asistan. The user sent an email (`m1`) and the other side has not replied.

### life_intel

| Field | Value |
|---|---|
| Source | [supabase/prompts/life_intel.md](../supabase/prompts/life_intel.md) |
| Version | 1 (İlk sürüm (T-5.16).) |
| Feature | `life_intel_extract` |
| Output schema | `LifeIntelV1` · `schema_hash` `2e403fc37de5`… |
| Model role | classifier |
| Tier (balanced · lean) | T1 · T1 |
| Fallback chain (balanced) | primary + 2 fallback targets, then the T0 path |
| Batch policy · cache TTL (balanced) | `non_urgent` · `5m` |
| System prompt | 2,791 characters |
| Template variables | none |

> You are the life-intelligence extractor of Dijital Asistan. You read notification emails that no deterministic parser recognised (`m1`…) and locate shipments, flights, reservations, payments and subscriptions.

### meeting_prep

| Field | Value |
|---|---|
| Source | [supabase/prompts/meeting_prep.md](../supabase/prompts/meeting_prep.md) |
| Version | 1 (İlk sürüm (T-5.10).) |
| Feature | `meeting_prep` |
| Output schema | `MeetingPrepV1` · `schema_hash` `83a853753a67`… |
| Model role | reasoning |
| Tier (balanced · lean) | T2 · T2 |
| Fallback chain (balanced) | primary + 2 fallback targets, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 2,990 characters |
| Template variables | `{{count}}` |

> You prepare meeting briefs for Dijital Asistan. You read the event description (`e1`), summaries of recent mails with the attendees (`m1`…), the user's meeting notes (`n1`…) and open commitments (`c1`…).

### post_meeting

| Field | Value |
|---|---|
| Source | [supabase/prompts/post_meeting.md](../supabase/prompts/post_meeting.md) |
| Version | 1 (İlk sürüm (T-5.10).) |
| Feature | `post_meeting_parse` |
| Output schema | `PostMeetingCommitmentV1` · `schema_hash` `5f23761e1063`… |
| Model role | classifier |
| Tier (balanced · lean) | T1 · T1 |
| Fallback chain (balanced) | primary + 1 fallback target, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 3,509 characters |
| Template variables | none |

> You are the post-meeting note reader of Dijital Asistan. After a meeting the user dictates or types a short note (`n1`).

### reply_draft

| Field | Value |
|---|---|
| Source | [supabase/prompts/reply_draft.md](../supabase/prompts/reply_draft.md) |
| Version | 1 (İlk sürüm (T-5.12).) |
| Feature | `reply_draft` |
| Output schema | `ReplyDraftsV1` · `schema_hash` `fc5c9dfdedbd`… |
| Model role | reasoning |
| Tier (balanced · lean) | T2 · T2 |
| Fallback chain (balanced) | primary + 2 fallback targets, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 2,938 characters |
| Template variables | `{{tones}}` |

> You write reply drafts for Dijital Asistan. You read the last messages of an email thread (`t1`, `t2`, …; the newest is last) and draft the user's reply in the requested tones.

### thread_summary

| Field | Value |
|---|---|
| Source | [supabase/prompts/thread_summary.md](../supabase/prompts/thread_summary.md) |
| Version | 1 (İlk sürüm (T-5.16).) |
| Feature | `thread_summary` |
| Output schema | `ThreadSummaryV1` · `schema_hash` `1998b12d01ae`… |
| Model role | reasoning |
| Tier (balanced · lean) | T2 · T1 |
| Fallback chain (balanced) | primary + 2 fallback targets, then the T0 path |
| Batch policy · cache TTL (balanced) | `never` · `5m` |
| System prompt | 3,743 characters |
| Template variables | none |

> You are the thread summariser of Dijital Asistan. You read the new messages of one email thread (`m1`…`mN`, oldest first) and, when present, the previous summary of the same thread (`t1`, kind `summary`).

### weekly_review

| Field | Value |
|---|---|
| Source | [supabase/prompts/weekly_review.md](../supabase/prompts/weekly_review.md) |
| Version | 1 (İlk sürüm (T-5.16).) |
| Feature | `weekly_review` |
| Output schema | `WeeklyReviewV1` · `schema_hash` `e7af11d64d7c`… |
| Model role | reasoning |
| Tier (balanced · lean) | T2 · T1 |
| Fallback chain (balanced) | primary + 1 fallback target, then the T0 path |
| Batch policy · cache TTL (balanced) | `always` · `1h` |
| System prompt | 1,514 characters |
| Template variables | none |

> You write the weekly review of Dijital Asistan. Code has computed the week's statistics (`s1`…), the first events of next week (`e1`…) and free blocks of next week (`f1`…).

<!-- generated:prompts:end -->
