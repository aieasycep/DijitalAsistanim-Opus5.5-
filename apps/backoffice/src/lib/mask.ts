/**
 * Email masking identical to `private.mask_email` (BACKOFFICE_PLAN §5.5): the first two characters
 * of the local part (one when it has two or fewer), `***@`, then the domain; Apple private relay
 * addresses keep only `***@privaterelay.appleid.com`.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (domain === 'privaterelay.appleid.com') return `***@${domain}`;
  const keep = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, keep)}***@${domain}`;
}
