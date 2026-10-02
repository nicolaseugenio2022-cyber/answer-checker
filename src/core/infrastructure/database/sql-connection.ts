import { ApplicationError } from '../../application/errors';
import { DatabaseError } from './database-error';
import type { TransactionConnection } from './run-in-transaction';

export type SqlValue = string | number | null;

/**
 * The part of an expo-sqlite connection that repositories use. Values always
 * travel in `params`, never inside the SQL text. Declared here so repositories
 * can also run against Node's SQLite in the tests.
 */
export type SqlConnection = TransactionConnection & {
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  runAsync(source: string, params: SqlValue[]): Promise<{ changes: number }>;
};

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

/**
 * Runs a repository operation and makes sure only typed errors leave it:
 * application errors and DatabaseError pass through, anything else (a raw
 * SQLite failure) is wrapped in a DatabaseError that keeps it as `cause`.
 */
export async function withTypedErrors<T>(action: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof ApplicationError || error instanceof DatabaseError) throw error;
    throw new DatabaseError(`Could not ${action}.`, { cause: error });
  }
}
