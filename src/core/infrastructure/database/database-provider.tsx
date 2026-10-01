import { SQLiteProvider, useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import type { PropsWithChildren } from 'react';

import { initializeDatabase } from './initialize-database';

const DATABASE_NAME = 'answer-checker.db';

/**
 * Opens the local database in the app's private storage and prepares it (WAL,
 * foreign keys, migrations) before rendering children. If preparation fails,
 * the error is thrown to the nearest error boundary and no screen renders
 * against a half-initialized database.
 */
export function DatabaseProvider({ children }: PropsWithChildren) {
  return (
    <SQLiteProvider
      databaseName={DATABASE_NAME}
      onInit={async (db) => {
        await initializeDatabase(db);
      }}>
      {children}
    </SQLiteProvider>
  );
}

/**
 * The initialized connection, for wiring repositories in the composition root.
 * Only valid under DatabaseProvider. Presentation code must not call this or
 * issue SQL; it receives use cases instead.
 */
export function useDatabase(): SQLiteDatabase {
  return useSQLiteContext();
}
