/**
 * Migration 8: a place for the app's own preferences.
 *
 * app_settings holds a few named values that belong to the app on this
 * device, not to the Teacher's academic records: the appearance preference
 * (system, light, or dark) and the optional display name used in the Home
 * greeting. One row per setting; a setting that was never changed has no row
 * and the app uses its default.
 *
 * It is not an account, a profile, or a teacher table: there is still one
 * role and no sign-in. It holds nothing about students, and "Delete all
 * academic data" leaves it alone.
 *
 * Nothing existing is touched: the table is new.
 */
export const APP_SETTINGS_SQL = `
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY NOT NULL CHECK (length(key) > 0),
  value TEXT NOT NULL
) STRICT;
`;
