import { runInTransaction } from '../../../core/infrastructure/database/run-in-transaction';
import {
  withTypedErrors,
  type SqlConnection,
  type SqlValue,
} from '../../../core/infrastructure/database/sql-connection';
import type { ResultRepository } from '../application/scan-ports';
import type { ScoredAnswer } from '../domain/scoring';

/** Rows per INSERT statement: 10 values each, well under SQLite's parameter limit. */
const BATCH_SIZE = 50;

/** How the reader's conclusion about a question is stored: MARKED, BLANK, MULTIPLE, or UNCLEAR. */
function detectedState(answer: ScoredAnswer): string {
  return answer.detectedState.toUpperCase();
}

export function createSqliteResultRepository(db: SqlConnection): ResultRepository {
  return {
    save(result) {
      return withTypedErrors('save the result', () =>
        runInTransaction(db, async () => {
          await db.runAsync(
            `INSERT INTO results
               (id, answer_key_id, student_id, class_id, score, total, template_id, captured_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              result.id,
              result.answerKeyId,
              result.studentId,
              result.classId,
              result.score,
              result.total,
              result.templateId,
              result.capturedAt,
              result.createdAt,
            ]
          );

          for (let start = 0; start < result.answers.length; start += BATCH_SIZE) {
            const batch = result.answers.slice(start, start + BATCH_SIZE);
            const params: SqlValue[] = [];
            for (const answer of batch) {
              params.push(
                `${result.id}:${answer.questionNumber}`,
                result.id,
                answer.questionNumber,
                detectedState(answer),
                answer.detectedAnswer,
                answer.finalAnswer,
                answer.correctAnswer,
                answer.isCorrect ? 1 : 0,
                answer.wasCorrected ? 1 : 0,
                answer.confidence
              );
            }
            await db.runAsync(
              `INSERT INTO student_answers
                 (id, result_id, question_number, detected_state, detected_answer, final_answer,
                  correct_answer, is_correct, manually_corrected, confidence)
               VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
              params
            );
          }

          await db.runAsync(
            'INSERT INTO scan_records (id, result_id, image_path, scanned_at) VALUES (?, ?, ?, ?)',
            [result.scanRecordId, result.id, result.imagePath, result.capturedAt]
          );
        })
      );
    },

    listAttempts(answerKeyId, studentId) {
      return withTypedErrors('read the earlier results', async () => {
        const rows = await db.getAllAsync<{
          id: string;
          score: number;
          total: number;
          created_at: string;
        }>(
          `SELECT id, score, total, created_at
             FROM results
            WHERE answer_key_id = ? AND student_id = ?
            ORDER BY created_at DESC, id`,
          [answerKeyId, studentId]
        );
        return rows.map((row) => ({
          id: row.id,
          score: row.score,
          total: row.total,
          createdAt: row.created_at,
        }));
      });
    },

    countAttemptsByStudent(answerKeyId) {
      return withTypedErrors('count the earlier results', async () => {
        const rows = await db.getAllAsync<{ student_id: string; total: number }>(
          'SELECT student_id, COUNT(*) AS total FROM results WHERE answer_key_id = ? GROUP BY student_id',
          [answerKeyId]
        );
        return Object.fromEntries(rows.map((row) => [row.student_id, row.total]));
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
  };
}
