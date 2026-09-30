-- Migration 20260924003440 · validates the constraints added NOT VALID in 20260924003410 (a
-- separate transaction: SHARE UPDATE EXCLUSIVE only, reads and writes continue). Every existing row
-- has merged_into_id null or pointing at another event of the table and merge_sources '[]' or a
-- group of at most 20 sources, so the validation cannot fail.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

alter table public.calendar_events validate constraint calendar_events_merged_into_id_fkey;
alter table public.calendar_events validate constraint calendar_events_merged_into_id_check;
alter table public.calendar_events validate constraint calendar_events_merge_sources_check;
