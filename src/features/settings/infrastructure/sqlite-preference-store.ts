import {
  withTypedErrors,
  type SqlConnection,
} from '../../../core/infrastructure/database/sql-connection';
import type { PreferenceStore } from '../application/settings-use-cases';

export function createSqlitePreferenceStore(db: SqlConnection): PreferenceStore {
  return {
    readAll() {
      return withTypedErrors('read the settings', async () => {
        const rows = await db.getAllAsync<{ key: string; value: string }>(
          'SELECT key, value FROM app_settings',
          []
        );
        return Object.fromEntries(rows.map((row) => [row.key, row.value]));
      });
    },

    write(key, value) {
      return withTypedErrors('store the setting', async () => {
        await db.runAsync(
          `INSERT INTO app_settings (key, value) VALUES (?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
          [key, value]
        );
      });
    },
  };
}

