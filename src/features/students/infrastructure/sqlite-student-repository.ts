import { RecordNotFoundError } from '../../../core/application/errors';
import { runInTransaction } from '../../../core/infrastructure/database/run-in-transaction';
import {
  isUniqueViolation,
  withTypedErrors,
  type SqlConnection,
  type SqlValue,
} from '../../../core/infrastructure/database/sql-connection';
import { ClassNotFoundError } from '../../classes/application/class-repository';
import {
  DuplicateStudentIdError,
  StudentInUseError,
  type StudentRepository,
  type StudentWithClass,
} from '../application/student-repository';
import { studentNumberKey, type Student } from '../domain/student';

type StudentRow = {
  id: string;
  class_id: string;
  student_number: string;
  full_name: string;
  created_at: string;
  updated_at: string;
  class_name: string;
};

const SELECT = `
  SELECT s.id, s.class_id, s.student_number, s.full_name, s.created_at, s.updated_at,
         c.name AS class_name
    FROM students s
    JOIN classes c ON c.id = s.class_id`;

const INSERT_COLUMNS = '(id, class_id, student_number, full_name, created_at, updated_at)';

/** Rows per INSERT statement in a batch: 600 parameters, well under SQLite's limit. */
const BATCH_SIZE = 100;

function toStudent(row: StudentRow): StudentWithClass {
  return {
    id: row.id,
    studentNumber: row.student_number,
    fullName: row.full_name,
    classId: row.class_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    className: row.class_name,
  };
}

export function createSqliteStudentRepository(db: SqlConnection): StudentRepository {
  async function find(id: string): Promise<StudentWithClass | null> {
    const row = await db.getFirstAsync<StudentRow>(`${SELECT} WHERE s.id = ?`, [id]);
    return row ? toStudent(row) : null;
  }

  /** Keys of the stored Student IDs, optionally leaving one student out. */
  async function storedKeys(exceptId: string | null): Promise<Set<string>> {
    const rows = await db.getAllAsync<{ id: string; student_number: string }>(
      'SELECT id, student_number FROM students',
      []
    );
    return new Set(
      rows.filter((row) => row.id !== exceptId).map((row) => studentNumberKey(row.student_number))
    );
  }

  async function requireClasses(classIds: Iterable<string>): Promise<void> {
    const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM classes', []);
    const known = new Set(rows.map((row) => row.id));
    for (const classId of classIds) {
      if (!known.has(classId)) throw new ClassNotFoundError(classId);
    }
  }

  /** Maps the UNIQUE index, the final safeguard, to the same typed error. */
  async function writing<T>(studentNumber: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateStudentIdError(studentNumber);
      throw error;
    }
  }

  return {
    list(classId) {
      return withTypedErrors('read the students', async () => {
        const rows = await db.getAllAsync<StudentRow>(
          `${SELECT}
            WHERE (? IS NULL OR s.class_id = ?)
            ORDER BY c.name COLLATE NOCASE, c.name, c.id,
                     s.full_name COLLATE NOCASE, s.full_name,
                     s.student_number COLLATE NOCASE, s.student_number,
                     s.id`,
          [classId, classId]
        );
        return rows.map(toStudent);
      });
    },

    getById(id) {
      return withTypedErrors('read the student', () => find(id));
    },

    listStudentNumbers() {
      return withTypedErrors('read the Student IDs', async () => {
        const rows = await db.getAllAsync<{ student_number: string }>(
          'SELECT student_number FROM students',
          []
        );
        return rows.map((row) => row.student_number);
      });
    },

    create(student) {
      return withTypedErrors('save the student', () =>
        runInTransaction(db, async () => {
          await requireClasses([student.classId]);
          if ((await storedKeys(null)).has(studentNumberKey(student.studentNumber))) {
            throw new DuplicateStudentIdError(student.studentNumber);
          }
          await writing(student.studentNumber, () =>
            db.runAsync(`INSERT INTO students ${INSERT_COLUMNS} VALUES (?, ?, ?, ?, ?, ?)`, [
              student.id,
              student.classId,
              student.studentNumber,
              student.fullName,
              student.createdAt,
              student.updatedAt,
            ])
          );
        })
      );
    },

    createMany(students) {
      return withTypedErrors('save the students', () =>
        runInTransaction(db, async () => {
          // Two reads check the whole batch, however many students it has.
          await requireClasses(new Set(students.map((student) => student.classId)));
          const taken = await storedKeys(null);
          for (const student of students) {
            const key = studentNumberKey(student.studentNumber);
            if (taken.has(key)) throw new DuplicateStudentIdError(student.studentNumber);
            taken.add(key);
          }

          for (let start = 0; start < students.length; start += BATCH_SIZE) {
            const batch = students.slice(start, start + BATCH_SIZE);
            const params: SqlValue[] = [];
            for (const student of batch) {
              params.push(
                student.id,
                student.classId,
                student.studentNumber,
                student.fullName,
                student.createdAt,
                student.updatedAt
              );
            }
            const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
            await writing(batch[0].studentNumber, () =>
              db.runAsync(`INSERT INTO students ${INSERT_COLUMNS} VALUES ${placeholders}`, params)
            );
          }
        })
      );
    },

    update(id, changes, updatedAt) {
      return withTypedErrors('save the student', () =>
        runInTransaction(db, async () => {
          const current = await find(id);
          if (!current) throw new RecordNotFoundError(id);
          await requireClasses([changes.classId]);
          if ((await storedKeys(id)).has(studentNumberKey(changes.studentNumber))) {
            throw new DuplicateStudentIdError(changes.studentNumber);
          }
          await writing(changes.studentNumber, () =>
            db.runAsync(
              `UPDATE students
                  SET student_number = ?, full_name = ?, class_id = ?, updated_at = ?
                WHERE id = ?`,
              [changes.studentNumber, changes.fullName, changes.classId, updatedAt, id]
            )
          );
          const student: Student = {
            id,
            studentNumber: changes.studentNumber,
            fullName: changes.fullName,
            classId: changes.classId,
            createdAt: current.createdAt,
            updatedAt,
          };
          return student;
        })
      );
    },

    delete(id) {
      return withTypedErrors('delete the student', () =>
        runInTransaction(db, async () => {
          if (!(await find(id))) throw new RecordNotFoundError(id);
          const usage = await db.getFirstAsync<{ result_count: number }>(
            'SELECT COUNT(*) AS result_count FROM results WHERE student_id = ?',
            [id]
          );
          const resultCount = usage?.result_count ?? 0;
          if (resultCount > 0) throw new StudentInUseError(resultCount);
          // A physical delete. ON DELETE RESTRICT on results.student_id still guards it.
          await db.runAsync('DELETE FROM students WHERE id = ?', [id]);
        })
      );
    },
  };
}
