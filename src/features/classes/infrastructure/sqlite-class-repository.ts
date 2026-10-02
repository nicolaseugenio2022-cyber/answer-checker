import { DuplicateNameError, RecordNotFoundError } from '../../../core/application/errors';
import { nameKey } from '../../../core/domain/record-name';
import { runInTransaction } from '../../../core/infrastructure/database/run-in-transaction';
import {
  isUniqueViolation,
  withTypedErrors,
  type SqlConnection,
} from '../../../core/infrastructure/database/sql-connection';
import { ClassInUseError, type ClassRepository } from '../application/class-repository';
import type { SchoolClass } from '../domain/school-class';

type ClassRow = { id: string; name: string; created_at: string; updated_at: string };

const COLUMNS = 'id, name, created_at, updated_at';

function toSchoolClass(row: ClassRow): SchoolClass {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function createSqliteClassRepository(db: SqlConnection): ClassRepository {
  async function find(id: string): Promise<SchoolClass | null> {
    const row = await db.getFirstAsync<ClassRow>(`SELECT ${COLUMNS} FROM classes WHERE id = ?`, [
      id,
    ]);
    return row ? toSchoolClass(row) : null;
  }

  /**
   * The UNIQUE constraint on the table ignores case only for ASCII letters, so
   * the full comparison is done here, inside the transaction of the caller.
   */
  async function requireUnusedName(name: string, exceptId: string | null): Promise<void> {
    const rows = await db.getAllAsync<{ id: string; name: string }>(
      'SELECT id, name FROM classes',
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
      return withTypedErrors('read the classes', async () => {
        const rows = await db.getAllAsync<ClassRow>(
          `SELECT ${COLUMNS} FROM classes ORDER BY name COLLATE NOCASE, name, id`,
          []
        );
        return rows.map(toSchoolClass);
      });
    },

    getById(id) {
      return withTypedErrors('read the class', () => find(id));
    },

    create(schoolClass) {
      return withTypedErrors('save the class', () =>
        runInTransaction(db, async () => {
          await requireUnusedName(schoolClass.name, null);
          await writingName(schoolClass.name, () =>
            db.runAsync(`INSERT INTO classes (${COLUMNS}) VALUES (?, ?, ?, ?)`, [
              schoolClass.id,
              schoolClass.name,
              schoolClass.createdAt,
              schoolClass.updatedAt,
            ])
          );
        })
      );
    },

    rename(id, name, updatedAt) {
      return withTypedErrors('rename the class', () =>
        runInTransaction(db, async () => {
          const current = await find(id);
          if (!current) throw new RecordNotFoundError(id);
          await requireUnusedName(name, id);
          await writingName(name, () =>
            db.runAsync('UPDATE classes SET name = ?, updated_at = ? WHERE id = ?', [
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
      return withTypedErrors('delete the class', () =>
        runInTransaction(db, async () => {
          if (!(await find(id))) throw new RecordNotFoundError(id);
          const usage = await db.getFirstAsync<{ student_count: number; result_count: number }>(
            `SELECT
               (SELECT COUNT(*) FROM students WHERE class_id = ?) AS student_count,
               (SELECT COUNT(*) FROM results WHERE class_id = ?) AS result_count`,
            [id, id]
          );
          const studentCount = usage?.student_count ?? 0;
          const resultCount = usage?.result_count ?? 0;
          if (studentCount > 0 || resultCount > 0) {
            throw new ClassInUseError(studentCount, resultCount);
          }
          // A physical delete. ON DELETE RESTRICT on students.class_id and
          // results.class_id still guards it.
          await db.runAsync('DELETE FROM classes WHERE id = ?', [id]);
        })
      );
    },
  };
}
