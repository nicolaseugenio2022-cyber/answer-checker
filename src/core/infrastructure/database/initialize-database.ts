import { DatabaseError } from './database-error';
import { MIGRATIONS } from './migrations';
import { runMigrations, type Migration, type MigrationDatabase } from './run-migrations';

/**
 * Prepares a freshly opened connection: write-ahead logging, foreign-key
 * enforcement, then migrations. Must run on every connection the app opens,
 * because SQLite's foreign-key enforcement is off by default and is a
 * per-connection setting.
 *
 * @returns the schema version after migrating.
 */
export async function initializeDatabase(
  db: MigrationDatabase,
  migrations: readonly Migration[] = MIGRATIONS
): Promise<number> {
  // Both pragmas must run outside a transaction; inside one they are ignored.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
  if (row?.foreign_keys !== 1) {
    throw new DatabaseError('Foreign-key enforcement could not be enabled for this connection.');
  }

  return runMigrations(db, migrations);
}
