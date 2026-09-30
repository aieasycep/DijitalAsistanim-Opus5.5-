-- Validates the CHECK constraints that 0022xx added as NOT VALID. Kept in its own migration (and so
-- its own transaction) so the validation scan takes only a SHARE UPDATE EXCLUSIVE lock and never
-- blocks reads or writes (squawk constraint-missing-not-valid).

set local lock_timeout = '10s';
set local statement_timeout = '10min';

alter table public.billing_events validate constraint billing_events_event_type_check;
alter table public.support_notes validate constraint support_notes_kind_values_check;
alter table public.support_notes validate constraint support_notes_author_kind_check;
alter table public.webhook_events validate constraint webhook_events_source_check;
