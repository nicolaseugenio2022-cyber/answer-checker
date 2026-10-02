import {
  withTypedErrors,
  type SqlConnection,
} from '../../../core/infrastructure/database/sql-connection';
import type { DashboardRepository } from '../application/dashboard-use-cases';

/**
 * Reads Home's numbers and recent activity. Counts are aggregates computed by
 * SQLite, and the recent lists are limited in SQL: no list of records is
 * loaded to be counted or sliced, and no answers or images are touched.
 */
export function createSqliteDashboardRepository(db: SqlConnection): DashboardRepository {
  return {
    counts(today) {
      return withTypedErrors('read the dashboard counts', async () => {
        const row = await db.getFirstAsync<{
          students: number;
          classes: number;
          answer_keys: number;
          results: number;
          scanned_today: number;
        }>(
          `SELECT (SELECT COUNT(*) FROM students) AS students,
                  (SELECT COUNT(*) FROM classes) AS classes,
                  (SELECT COUNT(*) FROM answer_keys) AS answer_keys,
                  (SELECT COUNT(*) FROM results) AS results,
                  (SELECT COUNT(*) FROM results WHERE captured_at >= ? AND captured_at < ?) AS scanned_today`,
          [today.start, today.end]
        );
        return {
          students: row?.students ?? 0,
          classes: row?.classes ?? 0,
          answerKeys: row?.answer_keys ?? 0,
          results: row?.results ?? 0,
          scannedToday: row?.scanned_today ?? 0,
        };
      });
    },

    recentResults(limit) {
      return withTypedErrors('read the recent results', async () => {
        // The attempt lookups run only for the rows returned, through the
        // index on (answer_key_id, student_id).
        const rows = await db.getAllAsync<{
          id: string;
          student_name: string;
          student_number: string;
          answer_key_name: string;
          score: number;
          total: number;
          captured_at: string;
          attempt_number: number;
          attempt_count: number;
        }>(
          `SELECT r.id, r.student_name, r.student_number, r.answer_key_name, r.score, r.total, r.captured_at,
                  (SELECT COUNT(*)
                     FROM results a
                    WHERE a.answer_key_id = r.answer_key_id AND a.student_id = r.student_id
                      AND (a.captured_at, a.created_at, a.id) <= (r.captured_at, r.created_at, r.id)
                  ) AS attempt_number,
                  (SELECT COUNT(*)
                     FROM results a
                    WHERE a.answer_key_id = r.answer_key_id AND a.student_id = r.student_id
                  ) AS attempt_count
             FROM results r
            ORDER BY r.captured_at DESC, r.created_at DESC, r.id DESC
            LIMIT ?`,
          [limit]
        );
        return rows.map((row) => ({
          id: row.id,
          studentName: row.student_name,
          studentNumber: row.student_number,
          answerKeyName: row.answer_key_name,
          score: row.score,
          total: row.total,
          capturedAt: row.captured_at,
          attempt: { number: row.attempt_number, count: row.attempt_count },
        }));
      });
    },

    recentAnswerKeys(limit) {
      return withTypedErrors('read the recent answer keys', async () => {
        const rows = await db.getAllAsync<{
          id: string;
          name: string;
          subject_name: string;
          question_count: number;
          updated_at: string;
        }>(
          `SELECT k.id, k.name, s.name AS subject_name, k.question_count, k.updated_at
             FROM answer_keys k
             JOIN subjects s ON s.id = k.subject_id
            ORDER BY k.updated_at DESC, k.created_at DESC, k.id DESC
            LIMIT ?`,
          [limit]
        );
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          subjectName: row.subject_name,
          questionCount: row.question_count,
          updatedAt: row.updated_at,
        }));
      });
    },

    lastScan() {
      return withTypedErrors('read the last scan', async () => {
        const row = await db.getFirstAsync<{
          subject_id: string;
          subject_name: string;
          answer_key_id: string;
          answer_key_name: string;
          class_id: string;
          class_name: string;
        }>(
          `SELECT k.subject_id, s.name AS subject_name,
                  r.answer_key_id, k.name AS answer_key_name,
                  r.class_id, c.name AS class_name
             FROM results r
             JOIN answer_keys k ON k.id = r.answer_key_id
             JOIN subjects s ON s.id = k.subject_id
             JOIN classes c ON c.id = r.class_id
            ORDER BY r.captured_at DESC, r.created_at DESC, r.id DESC
            LIMIT 1`,
          []
        );
        if (!row) return null;
        return {
          subjectId: row.subject_id,
          subjectName: row.subject_name,
          answerKeyId: row.answer_key_id,
          answerKeyName: row.answer_key_name,
          classId: row.class_id,
          className: row.class_name,
        };
      });
    },
  };
}
