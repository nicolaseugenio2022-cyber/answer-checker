import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import type { PropsWithChildren } from 'react';

import { MIGRATIONS } from './migrations';
import { runMigrations } from './run-migrations';

const DATABASE_NAME = 'answer-checker.db';

async function initializeDatabase(db: SQLiteDatabase) {
  // Both pragmas must run outside a transaction. foreign_keys is per connection.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await runMigrations(db, MIGRATIONS);
}

/** Opens the on-device database and migrates it before rendering children. */
export function DatabaseProvider({ children }: PropsWithChildren) {
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={initializeDatabase}>
      {children}
    </SQLiteProvider>
  );
}
