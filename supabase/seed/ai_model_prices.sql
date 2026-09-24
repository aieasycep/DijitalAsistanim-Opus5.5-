-- AI price book (USD per million tokens / per audio minute / per million characters), feeding
-- ai_requests.cost_usd_micros and budget estimates (AI_PIPELINE_PLAN §0.3, §3.3, §8.13;
-- DATABASE_AND_RLS_PLAN §4.4). Anthropic and Voyage figures were verified on 2026-09-23. OpenAI and
-- Deepgram figures come from secondary summaries (AI_PIPELINE_PLAN §0.3; plan-audits/ai-research):
-- Manual external step — re-verify them on the vendor pages before production seeding and record a
-- new effective_from row through the backoffice (ai.models.write) when a price changes.
-- Migration 0005 embeds this file verbatim (scripts/db/sync-seed-blocks.sh).
insert into public.ai_model_prices
  (provider, model, input_per_mtok_usd, output_per_mtok_usd, cache_write_5m_per_mtok_usd,
   cache_write_1h_per_mtok_usd, cache_read_per_mtok_usd, audio_per_min_usd, chars_per_million_usd, effective_from)
values
  ('anthropic', 'claude-haiku-4-5-20251001', 1.00, 5.00, 1.25, 2.00, 0.10, null, null, '2026-09-23T00:00:00Z'),
  ('anthropic', 'claude-sonnet-5', 2.00, 10.00, 2.50, 4.00, 0.20, null, null, '2026-09-23T00:00:00Z'),
  ('anthropic', 'claude-opus-5-5', 4.00, 20.00, 5.00, 8.00, 0.20, null, null, '2026-09-23T00:00:00Z'),
  ('voyage', 'voyage-4', 0.06, 0.00, null, null, null, null, null, '2026-09-23T00:00:00Z'),
  ('voyage', 'voyage-4-lite', 0.02, 0.00, null, null, null, null, null, '2026-09-23T00:00:00Z'),
  ('openai', 'gpt-5.6-luna', 0.20, 1.20, null, null, null, null, null, '2026-09-23T00:00:00Z'),
  ('openai', 'gpt-5.6-terra', 2.00, 12.00, null, null, null, null, null, '2026-09-23T00:00:00Z'),
  ('openai', 'gpt-transcribe', 0.00, 0.00, null, null, null, 0.0045, null, '2026-09-23T00:00:00Z'),
  ('openai', 'gpt-4o-mini-tts', 0.00, 0.00, null, null, null, 0.015, null, '2026-09-23T00:00:00Z'),
  ('deepgram', 'nova-3', 0.00, 0.00, null, null, null, 0.0043, null, '2026-09-23T00:00:00Z')
on conflict (provider, model, effective_from) do nothing;
