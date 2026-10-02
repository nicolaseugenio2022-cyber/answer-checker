import { runInTransaction } from '../../../core/infrastructure/database/run-in-transaction';
import {
  withTypedErrors,
  type SqlConnection,
  type SqlValue,
} from '../../../core/infrastructure/database/sql-connection';
import type { AnswerChoice } from '../../answer-keys/domain/answer-key';
import {
  ResultNotFoundError,
  type ResultQuery,
  type ResultsRepository,
} from '../application/results-ports';
import type { ResultAnswer, ResultSummary, StoredDetectionState } from '../domain/result';

type SummaryRow = {
  id: string;
  score: number;
  total: number;
  captured_at: string;
  created_at: string;
  student_name: string;
  student_number: string;
  class_name: string;
  subject_name: string;
  answer_key_name: string;
  attempt_number: number;
  attempt_count: number;
};

type DetailRow = SummaryRow & {
  answer_key_id: string;
  student_id: string;
  class_id: string;
  template_id: string;
  image_path: string | null;
};

type AnswerRow = {
  question_number: number;
  detected_state: StoredDetectionState;
  detected_answer: AnswerChoice | null;
  final_answer: AnswerChoice | null;
  correct_answer: AnswerChoice;
  is_correct: number;
  manually_corrected: number;
  confidence: number | null;
};

/**
 * A result's attempt number is its place, by capture time, among the results
 * of the same student with the same answer key; the count is how many there
 * are. Both are counted over all results, whatever the list is narrowed to,
 * and only for the rows a statement returns: each is one lookup in the index
 * on (answer_key_id, student_id).
 */
const SUMMARY_COLUMNS = `
  r.id, r.score, r.total, r.captured_at, r.created_at,
  r.student_name, r.student_number, r.class_name, r.subject_name, r.answer_key_name,
  (SELECT COUNT(*)
     FROM results a
    WHERE a.answer_key_id = r.answer_key_id AND a.student_id = r.student_id
      AND (a.captured_at, a.created_at, a.id) <= (r.captured_at, r.created_at, r.id)
  ) AS attempt_number,
  (SELECT COUNT(*)
     FROM results a
    WHERE a.answer_key_id = r.answer_key_id AND a.student_id = r.student_id
  ) AS attempt_count`;

/** The names a result is searched by: the ones it was saved under, which are the ones it shows. */
const SEARCHED = ['student_name', 'student_number', 'answer_key_name', 'subject_name', 'class_name'];

/** Makes typed text literal inside a LIKE pattern. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * The WHERE conditions of a query, with their values. `r` is the alias of the
 * results row. Only fixed text is put into the SQL; everything the Teacher
 * chose or typed travels as a parameter.
 */
function conditions(query: ResultQuery, r: string): { sql: string[]; params: SqlValue[] } {
  const sql: string[] = [];
  const params: SqlValue[] = [];
  const { filter } = query;

  if (filter.subjectId !== null) {
    // The subject is reached through the answer key.
    sql.push(`${r}.answer_key_id IN (SELECT id FROM answer_keys WHERE subject_id = ?)`);
    params.push(filter.subjectId);
  }
  if (filter.answerKeyId !== null) {
    sql.push(`${r}.answer_key_id = ?`);
    params.push(filter.answerKeyId);
  }
  if (filter.classId !== null) {
    sql.push(`${r}.class_id = ?`);
    params.push(filter.classId);
  }
  if (filter.studentId !== null) {
    sql.push(`${r}.student_id = ?`);
    params.push(filter.studentId);
  }

  const search = query.search.trim();
  if (search.length > 0) {
    // SQLite's LIKE ignores the case of ASCII letters only. Trying the text as
    // typed, in lower case, and in upper case also finds "Peña" for "PEÑA".
    const forms = [...new Set([search, search.toLowerCase(), search.toUpperCase()])];
    const alternatives: string[] = [];
    for (const form of forms) {
      for (const column of SEARCHED) {
        alternatives.push(`${r}.${column} LIKE ? ESCAPE '\\'`);
        params.push(`%${escapeLike(form)}%`);
      }
    }
    sql.push(`(${alternatives.join(' OR ')})`);
  }
  return { sql, params };
}

const toSummary = (row: SummaryRow): ResultSummary => ({
  id: row.id,
  score: row.score,
  total: row.total,
  capturedAt: row.captured_at,
  createdAt: row.created_at,
  studentName: row.student_name,
  studentNumber: row.student_number,
  className: row.class_name,
  subjectName: row.subject_name,
  answerKeyName: row.answer_key_name,
  attempt: { number: row.attempt_number, count: row.attempt_count },
});

const toAnswer = (row: AnswerRow): ResultAnswer => ({
  questionNumber: row.question_number,
  detectedState: row.detected_state,
  detectedAnswer: row.detected_answer,
  finalAnswer: row.final_answer,
  correctAnswer: row.correct_answer,
  isCorrect: row.is_correct === 1,
  manuallyCorrected: row.manually_corrected === 1,
  confidence: row.confidence,
});

export function createSqliteResultsRepository(db: SqlConnection): ResultsRepository {
  return {
    list(query, limit, after) {
      return withTypedErrors('read the results', async () => {
        const { sql, params } = conditions(query, 'r');
        if (after !== null) {
          sql.push('(r.captured_at, r.created_at, r.id) < (?, ?, ?)');
          params.push(after.capturedAt, after.createdAt, after.id);
        }
        // One more than asked for tells whether another page follows.
        const rows = await db.getAllAsync<SummaryRow>(
          `SELECT ${SUMMARY_COLUMNS}
             FROM results r
            ${sql.length > 0 ? `WHERE ${sql.join(' AND ')}` : ''}
            ORDER BY r.captured_at DESC, r.created_at DESC, r.id DESC
            LIMIT ?`,
          [...params, limit + 1]
        );
        const items = rows.slice(0, limit).map(toSummary);
        const last = items[items.length - 1];
        return {
          items,
          next:
            rows.length > limit && last
              ? { capturedAt: last.capturedAt, createdAt: last.createdAt, id: last.id }
              : null,
        };
      });
    },

    count(query) {
      return withTypedErrors('count the results', async () => {
        const { sql, params } = conditions(query, 'r');
        const row = await db.getFirstAsync<{ matching: number; total: number }>(
          `SELECT (SELECT COUNT(*) FROM results r ${sql.length > 0 ? `WHERE ${sql.join(' AND ')}` : ''}) AS matching,
                  (SELECT COUNT(*) FROM results) AS total`,
          params
        );
        return { matching: row?.matching ?? 0, total: row?.total ?? 0 };
      });
    },

    listLinks() {
      return withTypedErrors('read the result filters', async () => {
        const rows = await db.getAllAsync<{
          subject_id: string;
          subject_name: string;
          answer_key_id: string;
          answer_key_name: string;
          class_id: string;
          class_name: string;
          student_id: string;
          student_name: string;
          student_number: string;
        }>(
          `SELECT DISTINCT k.subject_id, s.name AS subject_name,
                  r.answer_key_id, k.name AS answer_key_name,
                  r.class_id, c.name AS class_name,
                  r.student_id, st.full_name AS student_name, st.student_number
             FROM results r
             JOIN answer_keys k ON k.id = r.answer_key_id
             JOIN subjects s ON s.id = k.subject_id
             JOIN classes c ON c.id = r.class_id
             JOIN students st ON st.id = r.student_id`,
          []
        );
        return rows.map((row) => ({
          subjectId: row.subject_id,
          subjectName: row.subject_name,
          answerKeyId: row.answer_key_id,
          answerKeyName: row.answer_key_name,
          classId: row.class_id,
          className: row.class_name,
          studentId: row.student_id,
          studentName: row.student_name,
          studentNumber: row.student_number,
        }));
      });
    },

    getById(id) {
      return withTypedErrors('read the result', async () => {
        const row = await db.getFirstAsync<DetailRow>(
          `SELECT ${SUMMARY_COLUMNS},
                  r.answer_key_id, r.student_id, r.class_id, r.template_id,
                  (SELECT image_path FROM scan_records WHERE result_id = r.id LIMIT 1) AS image_path
             FROM results r
            WHERE r.id = ?`,
          [id]
        );
        if (!row) return null;
        const answers = await db.getAllAsync<AnswerRow>(
          `SELECT question_number, detected_state, detected_answer, final_answer, correct_answer,
                  is_correct, manually_corrected, confidence
             FROM student_answers
            WHERE result_id = ?
            ORDER BY question_number`,
          [id]
        );
        return {
          ...toSummary(row),
          answerKeyId: row.answer_key_id,
          studentId: row.student_id,
          classId: row.class_id,
          templateId: row.template_id,
          imagePath: row.image_path,
          answers: answers.map(toAnswer),
        };
      });
    },

    delete(id) {
      return withTypedErrors('delete the result', () =>
        runInTransaction(db, async () => {
          // The dependents are deleted by name, not left to the cascade, so the
          // deletion does not depend on a connection setting.
          await db.runAsync('DELETE FROM student_answers WHERE result_id = ?', [id]);
          await db.runAsync('DELETE FROM scan_records WHERE result_id = ?', [id]);
          const { changes } = await db.runAsync('DELETE FROM results WHERE id = ?', [id]);
          if (changes === 0) throw new ResultNotFoundError(id);
        })
      );
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
