import { DuplicateNameError, RecordNotFoundError } from '../../../core/application/errors';
import { nameKey } from '../../../core/domain/record-name';
import { DatabaseError } from '../../../core/infrastructure/database/database-error';
import { runInTransaction } from '../../../core/infrastructure/database/run-in-transaction';
import {
  isUniqueViolation,
  withTypedErrors,
  type SqlConnection,
  type SqlValue,
} from '../../../core/infrastructure/database/sql-connection';
import { SubjectNotFoundError } from '../../subjects/application/subject-repository';
import {
  AnswerKeyInUseError,
  AnswerKeyLockedError,
  type AnswerKeyDetails,
  type AnswerKeyRepository,
} from '../application/answer-key-repository';
import {
  assembleAnswers,
  changesScoring,
  type AnswerChoice,
  type AnswerKey,
  type AnswerKeyItem,
} from '../domain/answer-key';

type HeaderRow = {
  id: string;
  subject_id: string;
  name: string;
  question_count: number;
  created_at: string;
  updated_at: string;
  subject_name: string;
  result_count: number;
};

type ItemRow = { answer_key_id: string; question_number: number; correct_answer: string };

// One statement returns every header with its subject name and result count.
const SELECT_HEADERS = `
  SELECT k.id, k.subject_id, k.name, k.question_count, k.created_at, k.updated_at,
         s.name AS subject_name,
         (SELECT COUNT(*) FROM results r WHERE r.answer_key_id = k.id) AS result_count
    FROM answer_keys k
    JOIN subjects s ON s.id = k.subject_id`;

export function createSqliteAnswerKeyRepository(db: SqlConnection): AnswerKeyRepository {
  /** Joins headers and items into complete keys. Stored keys must be whole. */
  function assemble(headers: HeaderRow[], items: ItemRow[]): AnswerKeyDetails[] {
    const itemsByKey = new Map<string, AnswerKeyItem[]>();
    for (const item of items) {
      const list = itemsByKey.get(item.answer_key_id) ?? [];
      list.push({ questionNumber: item.question_number, correctAnswer: item.correct_answer });
      itemsByKey.set(item.answer_key_id, list);
    }
    return headers.map((header) => {
      const assembled = assembleAnswers(header.question_count, itemsByKey.get(header.id) ?? []);
      if (!assembled.ok) {
        // Never guess a missing answer: a key with a gap would score sheets wrongly.
        throw new DatabaseError('A stored answer key is incomplete.');
      }
      return {
        id: header.id,
        subjectId: header.subject_id,
        name: header.name,
        questionCount: header.question_count,
        answers: assembled.answers,
        createdAt: header.created_at,
        updatedAt: header.updated_at,
        subjectName: header.subject_name,
        resultCount: header.result_count,
      };
    });
  }

  async function find(id: string): Promise<AnswerKeyDetails | null> {
    const headers = await db.getAllAsync<HeaderRow>(`${SELECT_HEADERS} WHERE k.id = ?`, [id]);
    if (headers.length === 0) return null;
    const items = await db.getAllAsync<ItemRow>(
      'SELECT answer_key_id, question_number, correct_answer FROM answer_key_items WHERE answer_key_id = ?',
      [id]
    );
    return assemble(headers, items)[0];
  }

  async function requireSubject(subjectId: string): Promise<void> {
    const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM subjects WHERE id = ?', [
      subjectId,
    ]);
    if (!row) throw new SubjectNotFoundError(subjectId);
  }

  /**
   * The UNIQUE index ignores case only for ASCII letters, so the full
   * comparison is done here, inside the transaction of the caller.
   */
  async function requireUnusedName(
    subjectId: string,
    name: string,
    exceptId: string | null
  ): Promise<void> {
    const rows = await db.getAllAsync<{ id: string; name: string }>(
      'SELECT id, name FROM answer_keys WHERE subject_id = ?',
      [subjectId]
    );
    const key = nameKey(name);
    const taken = rows.find((row) => row.id !== exceptId && nameKey(row.name) === key);
    if (taken) throw new DuplicateNameError(taken.name);
  }

  /** Maps the UNIQUE index, the final safeguard, to the same typed error. */
  async function writingName<T>(name: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateNameError(name);
      throw error;
    }
  }

  /** All answers of a key in one statement. */
  async function insertItems(answerKeyId: string, answers: readonly AnswerChoice[]) {
    const params: SqlValue[] = [];
    answers.forEach((answer, index) => params.push(answerKeyId, index + 1, answer));
    const placeholders = answers.map(() => '(?, ?, ?)').join(', ');
    await db.runAsync(
      `INSERT INTO answer_key_items (answer_key_id, question_number, correct_answer) VALUES ${placeholders}`,
      params
    );
  }

  return {
    list(subjectId) {
      return withTypedErrors('read the answer keys', async () => {
        // Two statements however many keys there are: headers, then all items.
        const headers = await db.getAllAsync<HeaderRow>(
          `${SELECT_HEADERS}
            WHERE (? IS NULL OR k.subject_id = ?)
            ORDER BY s.name COLLATE NOCASE, s.name, s.id, k.name COLLATE NOCASE, k.name, k.id`,
          [subjectId, subjectId]
        );
        const items = await db.getAllAsync<ItemRow>(
          `SELECT i.answer_key_id, i.question_number, i.correct_answer
             FROM answer_key_items i
             JOIN answer_keys k ON k.id = i.answer_key_id
            WHERE (? IS NULL OR k.subject_id = ?)`,
          [subjectId, subjectId]
        );
        return assemble(headers, items);
      });
    },

    getById(id) {
      return withTypedErrors('read the answer key', () => find(id));
    },

    countResults(id) {
      return withTypedErrors('count the results of the answer key', async () => {
        const row = await db.getFirstAsync<{ result_count: number }>(
          'SELECT COUNT(*) AS result_count FROM results WHERE answer_key_id = ?',
          [id]
        );
        return row?.result_count ?? 0;
      });
    },

    create(answerKey) {
      return withTypedErrors('save the answer key', () =>
        runInTransaction(db, async () => {
          await requireSubject(answerKey.subjectId);
          await requireUnusedName(answerKey.subjectId, answerKey.name, null);
          await writingName(answerKey.name, () =>
            db.runAsync(
              `INSERT INTO answer_keys (id, subject_id, name, question_count, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                answerKey.id,
                answerKey.subjectId,
                answerKey.name,
                answerKey.questionCount,
                answerKey.createdAt,
                answerKey.updatedAt,
              ]
            )
          );
          await insertItems(answerKey.id, answerKey.answers);
        })
      );
    },

    update(id, changes, updatedAt) {
      return withTypedErrors('save the answer key', () =>
        runInTransaction(db, async () => {
          const current = await find(id);
          if (!current) throw new RecordNotFoundError(id);

          const scoringChanges = changesScoring(current, changes);
          // Checked here, in the transaction, so a result saved a moment ago counts.
          if (scoringChanges && current.resultCount > 0) {
            throw new AnswerKeyLockedError(current.resultCount);
          }
          await requireSubject(changes.subjectId);
          await requireUnusedName(changes.subjectId, changes.name, id);

          await writingName(changes.name, () =>
            db.runAsync(
              `UPDATE answer_keys
                  SET subject_id = ?, name = ?, question_count = ?, updated_at = ?
                WHERE id = ?`,
              [changes.subjectId, changes.name, changes.questionCount, updatedAt, id]
            )
          );
          if (scoringChanges) {
            await db.runAsync('DELETE FROM answer_key_items WHERE answer_key_id = ?', [id]);
            await insertItems(id, changes.answers);
          }

          const answerKey: AnswerKey = {
            id,
            subjectId: changes.subjectId,
            name: changes.name,
            questionCount: changes.questionCount,
            answers: [...changes.answers],
            createdAt: current.createdAt,
            updatedAt,
          };
          return answerKey;
        })
      );
    },

    delete(id) {
      return withTypedErrors('delete the answer key', () =>
        runInTransaction(db, async () => {
          const exists = await db.getFirstAsync<{ id: string }>(
            'SELECT id FROM answer_keys WHERE id = ?',
            [id]
          );
          if (!exists) throw new RecordNotFoundError(id);
          const usage = await db.getFirstAsync<{ result_count: number }>(
            'SELECT COUNT(*) AS result_count FROM results WHERE answer_key_id = ?',
            [id]
          );
          const resultCount = usage?.result_count ?? 0;
          if (resultCount > 0) throw new AnswerKeyInUseError(resultCount);
          // A physical delete. Its items go with it (CASCADE); ON DELETE RESTRICT
          // on results.answer_key_id still guards it.
          await db.runAsync('DELETE FROM answer_keys WHERE id = ?', [id]);
        })
      );
    },
  };
}
