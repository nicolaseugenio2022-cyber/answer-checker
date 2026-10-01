import { DatabaseError, MigrationFailedError, UnsupportedSchemaVersionError } from './database-error';

export type Migration = {
  /** Schema version this migration produces. */
  version: number;
  /** SQL executed inside one transaction together with the version bump. */
  sql: string;
};

type SqlExecutor = {
  execAsync(source: string): Promise<void>;
};

/** The subset of expo-sqlite's SQLiteDatabase that the runner needs. */
export type MigrationDatabase = SqlExecutor & {
  getFirstAsync<T>(source: string): Promise<T | null>;
  withExclusiveTransactionAsync(task: (txn: SqlExecutor) => Promise<void>): Promise<void>;
};

/**
 * Brings the database up to the latest schema version, tracked in
 * `PRAGMA user_version`. Each migration commits atomically with its version
 * bump, so the version advances only when the migration succeeded, and an
 * interrupted run resumes from the last completed migration. Running it at the
 * current version does nothing.
 *
 * Migrations run in expo-sqlite's exclusive transaction, which uses its own
 * connection. Foreign-key enforcement is a per-connection setting and is not
 * turned on there, which is what SQLite recommends while tables are being
 * created or rebuilt.
 *
 * @returns the schema version after migrating.
 * @throws DatabaseError if the migration list is not numbered 1, 2, 3…
 * @throws UnsupportedSchemaVersionError if the database is newer than the list.
 * @throws MigrationFailedError if a migration's SQL fails; it is rolled back.
 */
export async function runMigrations(
  db: MigrationDatabase,
  migrations: readonly Migration[]
): Promise<number> {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new DatabaseError(
        `Migration at position ${index} must have version ${index + 1}, got ${migration.version}.`
      );
    }
  });

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;

  if (currentVersion > migrations.length) {
    throw new UnsupportedSchemaVersionError(currentVersion, migrations.length);
  }

  for (const migration of migrations.slice(currentVersion)) {
    try {
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.execAsync(migration.sql);
        await txn.execAsync(`PRAGMA user_version = ${migration.version}`);
      });
    } catch (error) {
      throw new MigrationFailedError(migration.version, error);
    }
  }

  return migrations.length;
}
