import { runInTransaction } from '../../../core/infrastructure/database/run-in-transaction';
import {
  withTypedErrors,
  type SqlConnection,
} from '../../../core/infrastructure/database/sql-connection';
import type { SchoolClass } from '../../classes/domain/school-class';
import type { Subject } from '../../subjects/domain/subject';
import { ClassNotFoundError } from '../../classes/application/class-repository';
import { SubjectNotFoundError } from '../../subjects/application/subject-repository';
import type { ClassSubjectRepository } from '../application/class-subject-repository';

type NamedRow = { id: string; name: string; created_at: string; updated_at: string };
type CountRow = { id: string; total: number };

function toRecord(row: NamedRow): Subject & SchoolClass {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

function toCounts(rows: CountRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.id, row.total]));
}

export function createSqliteClassSubjectRepository(db: SqlConnection): ClassSubjectRepository {
  async function requireClass(classId: string): Promise<void> {
    const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM classes WHERE id = ?', [
      classId,
    ]);
    if (!row) throw new ClassNotFoundError(classId);
  }

  async function requireSubject(subjectId: string): Promise<void> {
    const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM subjects WHERE id = ?', [
      subjectId,
    ]);
    if (!row) throw new SubjectNotFoundError(subjectId);
  }

  function insert(classId: string, subjectId: string, createdAt: string) {
    return db.runAsync(
      `INSERT INTO class_subjects (class_id, subject_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT (class_id, subject_id) DO NOTHING`,
      [classId, subjectId, createdAt]
    );
  }

  return {
    listSubjectsForClass(classId) {
      return withTypedErrors('read the subjects of the class', async () => {
        await requireClass(classId);
        const rows = await db.getAllAsync<NamedRow>(
          `SELECT s.id, s.name, s.created_at, s.updated_at
             FROM class_subjects cs
             JOIN subjects s ON s.id = cs.subject_id
            WHERE cs.class_id = ?
            ORDER BY s.name COLLATE NOCASE, s.name, s.id`,
          [classId]
        );
        return rows.map(toRecord);
      });
    },

    listClassesForSubject(subjectId) {
      return withTypedErrors('read the classes of the subject', async () => {
        await requireSubject(subjectId);
        const rows = await db.getAllAsync<NamedRow>(
          `SELECT c.id, c.name, c.created_at, c.updated_at
             FROM class_subjects cs
             JOIN classes c ON c.id = cs.class_id
            WHERE cs.subject_id = ?
            ORDER BY c.name COLLATE NOCASE, c.name, c.id`,
          [subjectId]
        );
        return rows.map(toRecord);
      });
    },

    isAssigned(classId, subjectId) {
      return withTypedErrors('read the assignment', async () => {
        await requireClass(classId);
        await requireSubject(subjectId);
        const row = await db.getFirstAsync<{ class_id: string }>(
          'SELECT class_id FROM class_subjects WHERE class_id = ? AND subject_id = ?',
          [classId, subjectId]
        );
        return row !== null;
      });
    },

    assign(classId, subjectId, createdAt) {
      return withTypedErrors('assign the subject', () =>
        runInTransaction(db, async () => {
          await requireClass(classId);
          await requireSubject(subjectId);
          await insert(classId, subjectId, createdAt);
        })
      );
    },

    remove(classId, subjectId) {
      return withTypedErrors('remove the subject', () =>
        runInTransaction(db, async () => {
          await requireClass(classId);
          await requireSubject(subjectId);
          await db.runAsync('DELETE FROM class_subjects WHERE class_id = ? AND subject_id = ?', [
            classId,
            subjectId,
          ]);
        })
      );
    },

    replaceSubjectsForClass(classId, subjectIds, createdAt) {
      return withTypedErrors('save the subjects of the class', () =>
        runInTransaction(db, async () => {
          await requireClass(classId);
          const wanted = new Set(subjectIds);
          for (const subjectId of wanted) await requireSubject(subjectId);

          const current = await db.getAllAsync<{ subject_id: string }>(
            'SELECT subject_id FROM class_subjects WHERE class_id = ?',
            [classId]
          );
          const existing = new Set(current.map((row) => row.subject_id));

          for (const subjectId of existing) {
            if (wanted.has(subjectId)) continue;
            await db.runAsync('DELETE FROM class_subjects WHERE class_id = ? AND subject_id = ?', [
              classId,
              subjectId,
            ]);
          }
          for (const subjectId of wanted) {
            if (!existing.has(subjectId)) await insert(classId, subjectId, createdAt);
          }
        })
      );
    },

    countSubjectsByClass() {
      return withTypedErrors('count the subjects of each class', async () =>
        toCounts(
          await db.getAllAsync<CountRow>(
            'SELECT class_id AS id, COUNT(*) AS total FROM class_subjects GROUP BY class_id',
            []
          )
        )
      );
    },

    countClassesBySubject() {
      return withTypedErrors('count the classes of each subject', async () =>
        toCounts(
          await db.getAllAsync<CountRow>(
            'SELECT subject_id AS id, COUNT(*) AS total FROM class_subjects GROUP BY subject_id',
            []
          )
        )
      );
    },
  };
}
