-- Migration 20260924003400 · the `calendar_freebusy` capability (KNOWN_PLATFORM_LIMITATIONS KPL-46;
-- API_CONTRACTS §7, API-PLAN-03).
--
-- Attendee availability for conflict options comes from Google `freeBusy.query` and Graph
-- `calendar/getSchedule`. Google needs `calendar.events.freebusy` for other people's calendars
-- (`calendar.events.readonly` does not grant it), so it is a separate capability that is only ever
-- requested through the progressive upgrade (`POST /integrations/:accountId/upgrade`), never at
-- connect. Graph `getSchedule` is covered by `Calendars.Read`; the Microsoft accounts that already
-- hold `calendar_read` receive the capability in 20260924003410 (a new enum value can only be used
-- after the transaction that adds it commits).
--
-- Added after the last value, so the declaration order stays the parity order of @da/domain DB_ENUMS.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

alter type public.capability add value if not exists 'calendar_freebusy' after 'tasks_write';
