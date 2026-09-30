import { maskEmail } from './mask';

/*
 * Auto-masking of free text (BACKOFFICE_PLAN §5.5 "Feedback message"): email addresses become
 * `yu***@gmail.com` and phone numbers (Turkish `+90 5xx …`, `05xx …` and other international
 * numbers of 10+ digits) keep only their last two digits. The raw text needs an audited reveal.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** A phone-like run: optional +, then 10–15 digits separated by spaces, dots, dashes or brackets. */
const PHONE = /(?<![\w@])\+?\(?\d(?:[\s().-]*\d){9,14}(?!\w)/g;

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${phone.trim().startsWith('+') ? '+' : ''}${'•'.repeat(Math.max(0, digits.length - 2))}${digits.slice(-2)}`;
}

export function autoMask(text: string): string {
  return text
    .replace(EMAIL, (email) => maskEmail(email))
    .replace(PHONE, (phone) => maskPhone(phone));
}
