-- Validates the CHECK constraints that 20260924002500 added as NOT VALID. Kept in its own migration
-- (and so its own transaction) so the validation scan takes only a SHARE UPDATE EXCLUSIVE lock and
-- never blocks reads or writes (squawk constraint-missing-not-valid).

set local lock_timeout = '10s';
set local statement_timeout = '10min';

alter table public.data_export_requests validate constraint data_export_requests_include_check;
alter table public.data_deletion_requests validate constraint data_deletion_requests_notify_email_ciphertext_check;
alter table public.data_deletion_requests validate constraint data_deletion_requests_notify_locale_check;
