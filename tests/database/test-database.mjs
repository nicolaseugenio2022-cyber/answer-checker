// Disposable SQLite databases for the tests, with an adapter that gives Node's
// built-in SQLite the same shape as the expo-sqlite connection the app uses.
// Every database lives in a fresh temporary directory. Nothing here can reach
// the application's real database, which exists only on a device.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Opens a new file-backed database (a file is needed for WAL).
 *
 * Connections are opened with foreign-key enforcement OFF, which is SQLite's
 * own default and the worst case on a device, so the tests prove that the
 * app's initialization turns it on rather than relying on Node's default.
 *
 * `withExclusiveTransactionAsync` mirrors expo-sqlite: it runs the task on a
 * second, separate connection.
 */
export function openTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'answer-checker-db-test-'));
  const path = join(directory, 'test.db');
  const open = () => new DatabaseSync(path, { enableForeignKeyConstraints: false });
  const raw = open();

  const db = {
    execAsync: async (sql) => {
      raw.exec(sql);
    },
    getFirstAsync: async (sql) => raw.prepare(sql).get() ?? null,
    withExclusiveTransactionAsync: async (task) => {
      const connection = open();
      try {
        connection.exec('BEGIN');
        await task({
          execAsync: async (sql) => {
            connection.exec(sql);
          },
        });
        connection.exec('COMMIT');
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      } finally {
        connection.close();
      }
    },
  };

  return {
    db,
    raw,
    run: (sql, ...params) => raw.prepare(sql).run(...params),
    all: (sql, ...params) => raw.prepare(sql).all(...params),
    get: (sql, ...params) => raw.prepare(sql).get(...params),
    close: () => {
      raw.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
