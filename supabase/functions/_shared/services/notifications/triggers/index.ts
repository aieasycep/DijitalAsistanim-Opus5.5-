/** Trigger dispatch of the `notification` job (T-6.08). */
import type { NotificationTrigger } from '../create.ts';
import { approvalExpiringTrigger, approvalFailedTrigger } from './approval-expiry.ts';
import { briefingTrigger } from './briefing.ts';
import { deadlineTrigger } from './deadline.ts';
import { followUpTrigger } from './follow-up.ts';
import { meetingPrepTrigger } from './meeting.ts';
import { postMeetingTrigger } from './post-meeting.ts';
import { reminderTrigger } from './reminder.ts';
import { userTestTrigger } from './test-push.ts';
import { trialEndingTrigger } from './trial-ending.ts';
import { skip, type TriggerContext, type TriggerOutcome } from './types.ts';

export function runTrigger(
  trigger: NotificationTrigger,
  ctx: TriggerContext,
): Promise<TriggerOutcome> {
  switch (trigger) {
    case 'meeting_prep':
      return meetingPrepTrigger(ctx);
    case 'post_meeting':
      return postMeetingTrigger(ctx);
    case 'reminder':
      return reminderTrigger(ctx);
    case 'nudge':
      if (ctx.payload.category === 'deadline') return deadlineTrigger(ctx);
      if (ctx.payload.category === 'follow_up') return followUpTrigger(ctx);
      return Promise.resolve(skip('unknown_nudge'));
    case 'approval_expiring':
      return approvalExpiringTrigger(ctx);
    case 'approval_result':
      return approvalFailedTrigger(ctx);
    case 'trial_ending':
      return trialEndingTrigger(ctx);
    case 'briefing':
      return briefingTrigger(ctx);
    case 'user_test':
      return userTestTrigger(ctx);
  }
}

export { approvalExpiringJob, approvalFailedJob } from './approval-expiry.ts';
export { briefingJob } from './briefing.ts';
export { trialEndingJob } from './trial-ending.ts';
export type { TriggerRepo } from './types.ts';
