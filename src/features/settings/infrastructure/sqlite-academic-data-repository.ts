import { runInTransaction } from '../../../core/infrastructure/database/run-in-transaction';
import {
  withTypedErrors,
  type SqlConnection,
} from '../../../core/infrastructure/database/sql-connection';
import type { AcademicDataRepository } from '../application/settings-use-cases';

/**
 * Every table that holds academic data, children before parents, so each
 * DELETE meets no row that still depends on it. app_settings is not here: the
 * app's own preferences are not academic data.
 */
const ACADEMIC_TABLES = [
  'student_answers',
  'scan_records',
  'results',
  'answer_key_items',
  'answer_keys',
  'students',
  'class_subjects',
  'classes',
  'subjects',
] as const;

export function createSqliteAcademicDataRepository(db: SqlConnection): AcademicDataRepository {
  return {
    counts() {
      return withTypedErrors('count the stored records', async () => {
        const row = await db.getFirstAsync<{
          students: number;
          classes: number;
          subjects: number;
          answer_keys: number;
          results: number;
        }>(
          `SELECT (SELECT COUNT(*) FROM students) AS students,
                  (SELECT COUNT(*) FROM classes) AS classes,
                  (SELECT COUNT(*) FROM subjects) AS subjects,
                  (SELECT COUNT(*) FROM answer_keys) AS answer_keys,
                  (SELECT COUNT(*) FROM results) AS results`,
          []
        );
        return {
          students: row?.students ?? 0,
          classes: row?.classes ?? 0,
          subjects: row?.subjects ?? 0,
          answerKeys: row?.answer_keys ?? 0,
          results: row?.results ?? 0,
        };
      });
    },

    listImagePaths() {
      return withTypedErrors('read the scan image paths', async () => {
        const rows = await db.getAllAsync<{ image_path: string }>(
          'SELECT image_path FROM scan_records WHERE image_path IS NOT NULL',
          []
        );
        return rows.map((row) => row.image_path);
      });
    },

    deleteAll() {
      return withTypedErrors('delete all academic data', () =>
        runInTransaction(db, async () => {
          // Table names come from the fixed list above, never from input.
          for (const table of ACADEMIC_TABLES) await db.runAsync(`DELETE FROM ${table}`, []);
        })
      );
    },
  };
}
