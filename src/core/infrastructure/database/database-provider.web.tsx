import type { SQLiteDatabase } from 'expo-sqlite';
import type { PropsWithChildren } from 'react';

import { DatabaseError } from './database-error';

/**
 * Web is only a preview of the phone UI, not a product platform. No database
 * is opened there and nothing is persisted. The native provider lives in
 * database-provider.tsx; this file keeps expo-sqlite's native code out of the
 * web bundle (the import above is type-only).
 */
export function DatabaseProvider({ children }: PropsWithChildren) {
  return children;
}

/** There is no database on web. Fails loudly instead of pretending to store data. */
export function useDatabase(): SQLiteDatabase {
  throw new DatabaseError('The local database is not available in the web preview.');
}
