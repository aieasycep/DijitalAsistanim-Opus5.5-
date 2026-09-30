import { JOB_STATUS_VALUES, JOB_TYPE_VALUES } from '@da/domain/enums';

/** `GET /jobs` filter allow-list (`@da/validation` `JobsListQuery`). */
export const JOB_FILTERS = ['type', 'status', 'user_id', 'account_id', 'from', 'to'] as const;

/** The M§53 job types are listed first in the type filter, then the rest of `job_type`. */
export const M53_JOB_TYPES = [
  'initial_sync',
  'gmail_sync',
  'outlook_sync',
  'calendar_sync',
  'briefing',
  'meeting_prep',
  'retention',
  'export',
  'notification',
  'embedding',
  'provider_webhook',
] as const;

export const JOB_TYPES_ORDERED: readonly string[] = [
  ...M53_JOB_TYPES,
  ...JOB_TYPE_VALUES.filter((type) => !(M53_JOB_TYPES as readonly string[]).includes(type)),
];

export const JOB_STATUSES = JOB_STATUS_VALUES;
