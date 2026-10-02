import { DuplicateNameError, RecordNotFoundError } from '../../../core/application/errors';
import { nameKey } from '../../../core/domain/record-name';
import { runInTransaction } from '../../../core/infrastructure/database/run-in-transaction';
import {
  isUniqueViolation,
  withTypedErrors,
  type SqlConnection,
} from '../../../core/infrastructure/database/sql-connection';
import { SubjectInUseError, type SubjectRepository } from '../application/subject-repository';
import type { Subject } from '../domain/subject';

type SubjectRow = { id: string; name: string; created_at: string; updated_at: string };

const COLUMNS = 'id, name, created_at, updated_at';

function toSubject(row: SubjectRow): Subject {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function createSqliteSubjectRepository(db: SqlConnection): SubjectRepository {
  async function find(id: string): Promise<Subject | null> {
    const row = await db.getFirstAsync<SubjectRow>(
      `SELECT ${COLUMNS} FROM subjects WHERE id = ?`,
      [id]
    );
    return row ? toSubject(row) : null;
  }

  /**
   * The UNIQUE constraint on the table ignores case only for ASCII letters, so
   * the full comparison is done here, inside the transaction of the caller.
   */
  async function requireUnusedName(name: string, exceptId: string | null): Promise<void> {
    const rows = await db.getAllAsync<{ id: string; name: string }>(
      'SELECT id, name FROM subjects',
      []
    );
    const key = nameKey(name);
    const taken = rows.find((row) => row.id !== exceptId && nameKey(row.name) === key);
    if (taken) throw new DuplicateNameError(taken.name);
  }

  /** Maps the UNIQUE constraint, the final safeguard, to the same typed error. */
  async function writingName<T>(name: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateNameError(name);
      throw error;
    }
  }

  return {
    list() {
      return withTypedErrors('read the subjects', async () => {
        const rows = await db.getAllAsync<SubjectRow>(
          `SELECT ${COLUMNS} FROM subjects ORDER BY name COLLATE NOCASE, name, id`,
          []
        );
        return rows.map(toSubject);
      });
    },

    getById(id) {
      return withTypedErrors('read the subject', () => find(id));
    },

    create(subject) {
      return withTypedErrors('save the subject', () =>
        runInTransaction(db, async () => {
          await requireUnusedName(subject.name, null);
          await writingName(subject.name, () =>
            db.runAsync(`INSERT INTO subjects (${COLUMNS}) VALUES (?, ?, ?, ?)`, [
              subject.id,
              subject.name,
              subject.createdAt,
              subject.updatedAt,
            ])
          );
        })
      );
    },

    rename(id, name, updatedAt) {
      return withTypedErrors('rename the subject', () =>
        runInTransaction(db, async () => {
          const current = await find(id);
          if (!current) throw new RecordNotFoundError(id);
          await requireUnusedName(name, id);
          await writingName(name, () =>
            db.runAsync('UPDATE subjects SET name = ?, updated_at = ? WHERE id = ?', [
              name,
              updatedAt,
              id,
            ])
          );
          return { ...current, name, updatedAt };
        })
      );
    },

    delete(id) {
      return withTypedErrors('delete the subject', () =>
        runInTransaction(db, async () => {
          if (!(await find(id))) throw new RecordNotFoundError(id);
          const usage = await db.getFirstAsync<{ exam_count: number }>(
            'SELECT COUNT(*) AS exam_count FROM exams WHERE subject_id = ?',
            [id]
          );
          const examCount = usage?.exam_count ?? 0;
          if (examCount > 0) throw new SubjectInUseError(examCount);
          // A physical delete. ON DELETE RESTRICT on exams.subject_id still guards it.
          await db.runAsync('DELETE FROM subjects WHERE id = ?', [id]);
        })
      );
    },
  };
}
