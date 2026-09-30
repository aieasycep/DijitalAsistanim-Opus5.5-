import { TICKET_CATEGORY_VALUES, type TicketCategory } from '@da/domain/enums';

/** `ticket_category` guard for the `?category=` preselect on `/support` (e.g. from `/data-deletion`). */
export function isTicketCategory(value: string): value is TicketCategory {
  return (TICKET_CATEGORY_VALUES as readonly string[]).includes(value);
}
