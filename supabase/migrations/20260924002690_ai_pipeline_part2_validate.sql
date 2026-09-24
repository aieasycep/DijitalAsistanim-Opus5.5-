-- Migration 20260924002690 · validates the checks added NOT VALID in 20260924002600 (a separate
-- transaction: SHARE UPDATE EXCLUSIVE only, reads and writes continue). The widened body and
-- subject caps and the new nullable columns cannot fail on existing rows.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

alter table public.reply_drafts validate constraint reply_drafts_language_check;
alter table public.reply_drafts validate constraint reply_drafts_facts_used_check;
alter table public.reply_drafts validate constraint reply_drafts_body_check;
alter table public.reply_drafts validate constraint reply_drafts_subject_check;
alter table public.captures validate constraint captures_link_preview_check;
alter table public.insights validate constraint insights_payload_check;
