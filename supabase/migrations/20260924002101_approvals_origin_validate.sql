-- Migration 20260924002101 · validates the widened approval_actions.origin check added NOT VALID in
-- 20260924002100 (its own transaction: SHARE UPDATE EXCLUSIVE only, reads and writes continue).
-- Every existing row satisfies the wider list, so validation cannot fail.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

alter table public.approval_actions validate constraint approval_actions_origin_check;
