import { runInTransaction } from '../../../core/infrastructure/database/run-in-transaction';
import {
  isUniqueViolation,
  withTypedErrors,
  type SqlConnection,
  type SqlValue,
} from '../../../core/infrastructure/database/sql-connection';
import {
  DemoDataConflictError,
  type DemoDataRepository,
} from '../application/demo-data-use-cases';
import { DEMO_ID_PREFIX } from '../domain/demo-data';

/** Matches the id of every demo record. The prefix has no LIKE wildcard in it. */
const DEMO = `${DEMO_ID_PREFIX}%`;

// What belongs to the demo data: the demo records, and whatever hangs under one.
const DEMO_CLASSES = `SELECT id FROM classes WHERE id LIKE ?1`;
const DEMO_SUBJECTS = `SELECT id FROM subjects WHERE id LIKE ?1`;
const DEMO_STUDENTS = `SELECT id FROM students WHERE id LIKE ?1 OR class_id IN (${DEMO_CLASSES})`;
const DEMO_KEYS = `SELECT id FROM answer_keys WHERE id LIKE ?1 OR subject_id IN (${DEMO_SUBJECTS})`;
const DEMO_RESULTS = `
  SELECT id FROM results
   WHERE id LIKE ?1
      OR student_id IN (${DEMO_STUDENTS})
      OR answer_key_id IN (${DEMO_KEYS})
      OR class_id IN (${DEMO_CLASSES})`;

export function createSqliteDemoDataRepository(db: SqlConnection): DemoDataRepository {
  return {
    exists() {
      return withTypedErrors('look for demo data', async () => {
        const row = await db.getFirstAsync<{ found: number }>(
          `SELECT EXISTS (SELECT 1 FROM subjects WHERE id LIKE ?1)
               OR EXISTS (SELECT 1 FROM classes WHERE id LIKE ?1)
               OR EXISTS (SELECT 1 FROM students WHERE id LIKE ?1)
               OR EXISTS (SELECT 1 FROM answer_keys WHERE id LIKE ?1)
               OR EXISTS (SELECT 1 FROM results WHERE id LIKE ?1) AS found`,
          [DEMO]
        );
        return row?.found === 1;
      });
    },

    insert(data) {
      return withTypedErrors('add the demo data', () =>
        runInTransaction(db, async () => {
          const at = data.createdAt;
          /** One INSERT for all rows of a table. */
          const insertAll = async (table: string, columns: string[], rows: SqlValue[][]) => {
            if (rows.length === 0) return;
            const row = `(${columns.map(() => '?').join(', ')})`;
            await db.runAsync(
              `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${rows.map(() => row).join(', ')}`,
              rows.flat()
            );
          };

          try {
            await insertAll(
              'subjects',
              ['id', 'name', 'created_at', 'updated_at'],
              data.subjects.map((subject) => [subject.id, subject.name, at, at])
            );
            await insertAll(
              'classes',
              ['id', 'name', 'created_at', 'updated_at'],
              data.classes.map((schoolClass) => [schoolClass.id, schoolClass.name, at, at])
            );
            await insertAll(
              'class_subjects',
              ['class_id', 'subject_id', 'created_at'],
              data.classSubjects.map((link) => [link.classId, link.subjectId, at])
            );
            await insertAll(
              'students',
              ['id', 'class_id', 'student_number', 'full_name', 'created_at', 'updated_at'],
              data.students.map((student) => [
                student.id, student.classId, student.studentNumber, student.fullName, at, at,
              ])
            );
            await insertAll(
              'answer_keys',
              ['id', 'subject_id', 'name', 'question_count', 'created_at', 'updated_at'],
              data.answerKeys.map((key) => [key.id, key.subjectId, key.name, key.answers.length, at, at])
            );
          } catch (error) {
            // One of the Teacher's own records already has a demo name or Student ID.
            if (isUniqueViolation(error)) throw new DemoDataConflictError();
            throw error;
          }

          for (const key of data.answerKeys) {
            await insertAll(
              'answer_key_items',
              ['answer_key_id', 'question_number', 'correct_answer'],
              key.answers.map((answer, index) => [key.id, index + 1, answer])
            );
          }
          await insertAll(
            'results',
            [
              'id', 'answer_key_id', 'student_id', 'class_id', 'score', 'total', 'template_id',
              'captured_at', 'created_at',
              'student_name', 'student_number', 'class_name', 'subject_name', 'answer_key_name',
            ],
            data.results.map((result) => [
              result.id, result.answerKeyId, result.studentId, result.classId, result.score,
              result.total, result.templateId, result.capturedAt, result.createdAt,
              result.studentName, result.studentNumber, result.className, result.subjectName,
              result.answerKeyName,
            ])
          );
          for (const result of data.results) {
            await insertAll(
              'student_answers',
              [
                'id', 'result_id', 'question_number', 'detected_state', 'detected_answer',
                'final_answer', 'correct_answer', 'is_correct', 'manually_corrected', 'confidence',
              ],
              result.answers.map((answer) => [
                `${result.id}:${answer.questionNumber}`, result.id, answer.questionNumber,
                answer.detectedState, answer.detectedAnswer, answer.finalAnswer, answer.correctAnswer,
                answer.isCorrect ? 1 : 0, answer.manuallyCorrected ? 1 : 0, answer.confidence,
              ])
            );
          }
          await insertAll(
            'scan_records',
            ['id', 'result_id', 'image_path', 'scanned_at'],
            data.results.map((result) => [
              result.scanRecordId, result.id, result.imagePath, result.capturedAt,
            ])
          );
        })
      );
    },

    remove() {
      return withTypedErrors('remove the demo data', () =>
        runInTransaction(db, async () => {
          // Children first, each named, so nothing depends on a cascade.
          await db.runAsync(`DELETE FROM student_answers WHERE result_id IN (${DEMO_RESULTS})`, [DEMO]);
          await db.runAsync(`DELETE FROM scan_records WHERE result_id IN (${DEMO_RESULTS})`, [DEMO]);
          const results = await db.runAsync(`DELETE FROM results WHERE id IN (${DEMO_RESULTS})`, [DEMO]);
          const students = await db.runAsync(`DELETE FROM students WHERE id IN (${DEMO_STUDENTS})`, [DEMO]);
          await db.runAsync(`DELETE FROM answer_key_items WHERE answer_key_id IN (${DEMO_KEYS})`, [DEMO]);
          const answerKeys = await db.runAsync(`DELETE FROM answer_keys WHERE id IN (${DEMO_KEYS})`, [DEMO]);
          await db.runAsync(
            `DELETE FROM class_subjects WHERE class_id LIKE ?1 OR subject_id LIKE ?1`,
            [DEMO]
          );
          await db.runAsync(`DELETE FROM classes WHERE id LIKE ?1`, [DEMO]);
          await db.runAsync(`DELETE FROM subjects WHERE id LIKE ?1`, [DEMO]);
          return {
            results: results.changes,
            students: students.changes,
            answerKeys: answerKeys.changes,
          };
        })
      );
    },
  };
}
