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
 * bump, so an interrupted run resumes from the last completed migration.
 *
 * @returns the schema version after migrating.
 */
export async function runMigrations(
  db: MigrationDatabase,
  migrations: readonly Migration[]
): Promise<number> {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migration at position ${index} must have version ${index + 1}, got ${migration.version}.`
      );
    }
  });

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;

  if (currentVersion > migrations.length) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than this app supports (${migrations.length}).`
    );
  }

  for (const migration of migrations.slice(currentVersion)) {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(migration.sql);
      await txn.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }

  return migrations.length;
}
