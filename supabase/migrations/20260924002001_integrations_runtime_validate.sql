-- Migration 0020 · part 2 · validate the oauth_states checks added NOT VALID by 20260924002000
-- (IMPLEMENTATION_PLAN T-4.01; the squawk constraint-missing-not-valid rule: a separate migration
-- scans the table with only a SHARE UPDATE EXCLUSIVE lock).

set local lock_timeout = '10s';
set local statement_timeout = '10min';

alter table public.oauth_states validate constraint oauth_states_provider_check;
alter table public.oauth_states validate constraint oauth_states_return_to_check;
