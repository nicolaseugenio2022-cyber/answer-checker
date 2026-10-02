import { SQLiteProvider, useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useRef, type PropsWithChildren } from 'react';

import { initializeDatabase } from './initialize-database';

const DATABASE_NAME = 'answer-checker.db';

/** A step of preparing the database, reported as it is reached. */
export type DatabaseStage =
  /** The file is open; pragmas and migrations are about to run. */
  | 'opened'
  /** WAL and foreign keys are set and every migration has run. `ms` is how long that took. */
  | 'migrated'
  /** Preparing failed. The error also reaches the nearest error boundary. */
  | 'failed';

type DatabaseProviderProps = PropsWithChildren<{
  /** Told each step of preparing the database, for start-up diagnostics. Must not throw. */
  onStage?: (stage: DatabaseStage, ms?: number) => void;
}>;

/**
 * Opens the local database in the app's private storage and prepares it (WAL,
 * foreign keys, migrations) before rendering children. If preparation fails,
 * the error is thrown to the nearest error boundary and no screen renders
 * against a half-initialized database.
 *
 * The function handed to SQLiteProvider is created once. SQLiteProvider opens
 * the database again whenever that function changes, so a new one on every
 * render would close and reopen the database, and run the initialization
 * again, each time anything above this provider re-rendered; a re-render
 * caused by the initialization itself would then never let it finish.
 */
export function DatabaseProvider({ children, onStage }: DatabaseProviderProps) {
  // The newest onStage, without making it a reason to open the database again.
  const stage = useRef(onStage);
  useEffect(() => {
    stage.current = onStage;
  }, [onStage]);

  const initialize = useCallback(async (db: SQLiteDatabase) => {
    const report = (name: DatabaseStage, ms?: number) => {
      try {
        stage.current?.(name, ms);
      } catch {
        // Diagnostics must never break the start.
      }
    };
    report('opened');
    const started = Date.now();
    try {
      await initializeDatabase(db);
    } catch (error) {
      report('failed', Date.now() - started);
      throw error;
    }
    report('migrated', Date.now() - started);
  }, []);

  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={initialize}>
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

/**
 * The same connection, or null on a platform that has no database (the web
 * preview). The composition root uses this to decide whether to build the
 * use cases at all.
 */
export function useDatabaseIfAvailable(): SQLiteDatabase | null {
  return useSQLiteContext();
}
