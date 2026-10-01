import { DatabaseError } from './database-error';

/** The one method a connection needs for transaction control. */
export type TransactionConnection = {
  execAsync(source: string): Promise<void>;
};

// One queue per connection, so two transactions on it can never interleave.
// Keyed weakly: nothing here keeps a closed connection alive.
const queues = new WeakMap<TransactionConnection, Promise<unknown>>();

/**
 * Runs `task` in one SQLite transaction on the given connection: everything it
 * writes is committed together, or nothing is. Calls on the same connection run
 * one after another. If the task throws, the transaction is rolled back and the
 * task's own error is rethrown; a failure to begin, commit, or roll back is
 * raised as DatabaseError.
 *
 * Use this instead of expo-sqlite's `withExclusiveTransactionAsync` for data
 * writes. That method opens a separate connection on which foreign-key
 * enforcement is off, so ON DELETE RESTRICT and CASCADE would not apply there.
 * This one stays on the initialized connection, where they do.
 *
 * Inside the task, use the same connection for every statement.
 */
export function runInTransaction<T>(db: TransactionConnection, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(db) ?? Promise.resolve();
  const result = previous.then(
    () => execute(db, task),
    () => execute(db, task)
  );
  queues.set(db, result);
  return result;
}

async function execute<T>(db: TransactionConnection, task: () => Promise<T>): Promise<T> {
  try {
    // IMMEDIATE takes the write lock up front instead of failing halfway through.
    await db.execAsync('BEGIN IMMEDIATE');
  } catch (error) {
    throw new DatabaseError('Could not begin a transaction.', { cause: error });
  }

  let value: T;
  try {
    value = await task();
  } catch (taskError) {
    try {
      await db.execAsync('ROLLBACK');
    } catch (rollbackError) {
      throw new DatabaseError('The transaction failed and could not be rolled back.', {
        cause: rollbackError,
      });
    }
    throw taskError;
  }

  try {
    await db.execAsync('COMMIT');
  } catch (error) {
    await db.execAsync('ROLLBACK').catch(() => undefined);
    throw new DatabaseError('The transaction could not be committed.', { cause: error });
  }

  return value;
}
