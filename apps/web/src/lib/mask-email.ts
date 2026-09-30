/**
 * Masks an email for display in confirmations (`yunus@gmail.com` → `yu***@gmail.com`), the same
 * shape the backoffice uses (BACKOFFICE_PLAN PII masking). Computed in the browser from what the
 * person typed; nothing about an account is ever fetched.
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***@${domain}`;
}
