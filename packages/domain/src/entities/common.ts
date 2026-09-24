/** Shared scalar aliases for entity interfaces (rows as returned by PostgREST / Edge Functions). */

/** RFC 4122 UUID string. */
export type Uuid = string;
/** ISO 8601 instant with offset (`timestamptz`). */
export type IsoDateTime = string;
/** `yyyy-MM-dd` (`date`). */
export type IsoDate = string;
/** `HH:mm` or `HH:mm:ss` (`time`, interpreted in `user_preferences.timezone`). */
export type LocalTime = string;

/** Timestamps every user table carries (⟨TS⟩). */
export interface Timestamps {
  readonly created_at: IsoDateTime;
  readonly updated_at: IsoDateTime;
}

/** Owner columns (⟨OWN⟩). */
export interface Owned {
  readonly id: Uuid;
  readonly user_id: Uuid;
}
