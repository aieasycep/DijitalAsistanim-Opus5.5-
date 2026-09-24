/**
 * Notification permission for onboarding (M-ON-14, R-12/R-14). The general notification layer
 * (T-8.24, `src/lib/notifications`) owns the channels, the OS prompt and the token registration;
 * this module keeps the names the onboarding, briefing and settings screens import.
 */
export { ensureAndroidChannels } from '../../lib/notifications/channels';
export {
  currentNotificationPermission,
  registerPushToken,
  requestNotificationPermission,
  type OsPermission,
} from '../../lib/notifications/register';
