/** `GET /users` allow-lists (`@da/validation` `UsersListQuery`). */
export const USER_FILTERS = ['plan', 'state'] as const;
export const USER_SORTS = ['created_at', 'last_active_at', 'last_sync_at'] as const;
/** A user id or an id prefix of at least 8 hex characters (§6.2 `q`); emails use the lookup. */
export const USER_ID_SEARCH = '^[0-9a-fA-F]{8}(-?[0-9a-fA-F-]{0,28})$';
