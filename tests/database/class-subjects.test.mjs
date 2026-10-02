// Verifies migration 2 (class_subjects) and the Subject-to-Class assignment
// use cases and repository against real SQLite, on disposable databases.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { RecordNotFoundError } from '../../src/core/application/errors.ts';
import { DatabaseError } from '../../src/core/infrastructure/database/database-error.ts';
import { initializeDatabase } from '../../src/core/infrastructure/database/initialize-database.ts';
import { MIGRATIONS } from '../../src/core/infrastructure/database/migrations.ts';
import {
  ClassNotFoundError,
  SubjectNotFoundError,
} from '../../src/features/class-subjects/application/class-subject-repository.ts';
import { createClassSubjectUseCases } from '../../src/features/class-subjects/application/class-subject-use-cases.ts';
import { createSqliteClassSubjectRepository } from '../../src/features/class-subjects/infrastructure/sqlite-class-subject-repository.ts';
import { ClassInUseError } from '../../src/features/classes/application/class-repository.ts';
import { createClassUseCases } from '../../src/features/classes/application/class-use-cases.ts';
import { createSqliteClassRepository } from '../../src/features/classes/infrastructure/sqlite-class-repository.ts';
import { SubjectInUseError } from '../../src/features/subjects/application/subject-repository.ts';
import { createSubjectUseCases } from '../../src/features/subjects/application/subject-use-cases.ts';
import { createSqliteSubjectRepository } from '../../src/features/subjects/infrastructure/sqlite-subject-repository.ts';
import { openTestDatabase } from './test-database.mjs';

const T0 = '2026-10-02T08:30:00.000Z';
const T1 = '2026-10-02T09:00:00.000Z';

let t;

afterEach(() => {
  t.close();
});

const userVersion = () => t.get('PRAGMA user_version').user_version;
const links = () =>
  t
    .all('SELECT class_id, subject_id FROM class_subjects ORDER BY class_id, subject_id')
    .map((row) => `${row.class_id}:${row.subject_id}`);
const names = (records) => records.map((record) => record.name);

function insertSubject(id, name) {
  t.run('INSERT INTO subjects VALUES (?, ?, ?, ?)', id, name, T0, T0);
}

function insertClass(id, name) {
  t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', id, name, T0, T0);
}

function useCases(db = t.db, now = T1) {
  return createClassSubjectUseCases({
    repository: createSqliteClassSubjectRepository(db),
    clock: { now: () => now },
  });
}

const dependencies = { clock: { now: () => T1 }, idGenerator: { newId: () => 'new-id' } };
const classUseCases = () =>
  createClassUseCases({ repository: createSqliteClassRepository(t.db), ...dependencies });
const subjectUseCases = () =>
  createSubjectUseCases({ repository: createSqliteSubjectRepository(t.db), ...dependencies });

/** Two classes and three subjects, named so that id order and name order differ. */
function seed() {
  insertClass('cls-1', 'Grade 11 STEM-B');
  insertClass('cls-2', 'BSIT 1A');
  insertClass('cls-3', 'grade 11 STEM-A');
  insertSubject('sub-1', 'Programming 1');
  insertSubject('sub-2', 'Mathematics');
  insertSubject('sub-3', 'biology');
}

describe('migration 2: upgrade paths', () => {
  it('gives a fresh database the class_subjects table', async () => {
    t = openTestDatabase();
    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 2)), 2);
    assert.equal(userVersion(), 2);
    assert.ok(MIGRATIONS.length >= 2);
    assert.equal(t.get('SELECT COUNT(*) AS n FROM class_subjects').n, 0);
  });

  it('upgrades a version-1 database and keeps its subjects, classes, and dependents', async () => {
    t = openTestDatabase();
    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 1)), 1);
    assert.equal(userVersion(), 1);
    assert.throws(() => t.get('SELECT COUNT(*) AS n FROM class_subjects'), /no such table/);

    seed();
    t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', 'stu-1', 'cls-1', '001', 'A', T0, T0);
    t.run('INSERT INTO exams VALUES (?, ?, ?, ?, ?, ?, ?)', 'exm-1', 'sub-1', 'cls-1', 'Quiz', 5, T0, T0);
    const before = {
      subjects: t.all('SELECT * FROM subjects ORDER BY id'),
      classes: t.all('SELECT * FROM classes ORDER BY id'),
      students: t.all('SELECT * FROM students ORDER BY id'),
      exams: t.all('SELECT * FROM exams ORDER BY id'),
    };

    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 2)), 2);

    assert.equal(userVersion(), 2);
    assert.deepEqual(t.all('SELECT * FROM subjects ORDER BY id'), before.subjects);
    assert.deepEqual(t.all('SELECT * FROM classes ORDER BY id'), before.classes);
    assert.deepEqual(t.all('SELECT * FROM students ORDER BY id'), before.students);
    assert.deepEqual(t.all('SELECT * FROM exams ORDER BY id'), before.exams);
    assert.equal(t.get('SELECT COUNT(*) AS n FROM class_subjects').n, 0);

    // The upgraded database is usable straight away.
    await useCases().assignSubjectToClass('cls-1', 'sub-1');
    assert.deepEqual(links(), ['cls-1:sub-1']);
  });

  it('does not run migration 2 twice', async () => {
    t = openTestDatabase();
    await initializeDatabase(t.db);
    seed();
    await useCases().assignSubjectToClass('cls-1', 'sub-1');
    assert.equal(await initializeDatabase(t.db), MIGRATIONS.length);
    assert.deepEqual(links(), ['cls-1:sub-1']);
  });
});

describe('class_subjects', () => {
  beforeEach(async () => {
    t = openTestDatabase();
    await initializeDatabase(t.db);
    seed();
  });

  describe('table', () => {
    it('is STRICT with a composite primary key and no other columns', () => {
      const columns = t.all("SELECT name, type, pk, \"notnull\" FROM pragma_table_info('class_subjects')");
      assert.deepEqual(
        columns.map((column) => ({ ...column })),
        [
          { name: 'class_id', type: 'TEXT', pk: 1, notnull: 1 },
          { name: 'subject_id', type: 'TEXT', pk: 2, notnull: 1 },
          { name: 'created_at', type: 'TEXT', pk: 0, notnull: 1 },
        ]
      );
      const table = t.get("SELECT strict FROM pragma_table_list WHERE name = 'class_subjects'");
      assert.equal(table.strict, 1);
    });

    it('makes a duplicate assignment impossible', () => {
      t.run('INSERT INTO class_subjects VALUES (?, ?, ?)', 'cls-1', 'sub-1', T0);
      assert.throws(
        () => t.run('INSERT INTO class_subjects VALUES (?, ?, ?)', 'cls-1', 'sub-1', T1),
        /UNIQUE constraint failed/
      );
    });

    it('rejects unknown parents and a malformed timestamp', () => {
      assert.throws(
        () => t.run('INSERT INTO class_subjects VALUES (?, ?, ?)', 'nope', 'sub-1', T0),
        /FOREIGN KEY constraint failed/
      );
      assert.throws(
        () => t.run('INSERT INTO class_subjects VALUES (?, ?, ?)', 'cls-1', 'nope', T0),
        /FOREIGN KEY constraint failed/
      );
      assert.throws(
        () => t.run('INSERT INTO class_subjects VALUES (?, ?, ?)', 'cls-1', 'sub-1', '2026-10-02'),
        /CHECK constraint failed/
      );
    });

    it('has an index for lookups by subject', () => {
      const plan = t
        .all('EXPLAIN QUERY PLAN SELECT class_id FROM class_subjects WHERE subject_id = ?', 'sub-1')
        .map((row) => row.detail)
        .join(' ');
      assert.match(plan, /idx_class_subjects_subject_id/);
    });
  });

  describe('assign and remove', () => {
    it('assigns a subject to a class with the injected timestamp', async () => {
      await useCases().assignSubjectToClass('cls-1', 'sub-1');

      assert.deepEqual(
        t.all('SELECT * FROM class_subjects').map((row) => ({ ...row })),
        [{ class_id: 'cls-1', subject_id: 'sub-1', created_at: T1 }]
      );
      assert.equal(await useCases().isSubjectAssignedToClass('cls-1', 'sub-1'), true);
      assert.equal(await useCases().isSubjectAssignedToClass('cls-1', 'sub-2'), false);
      assert.equal(await useCases().isSubjectAssignedToClass('cls-2', 'sub-1'), false);
    });

    it('treats a repeated assignment as already done and keeps the first timestamp', async () => {
      await useCases(t.db, T0).assignSubjectToClass('cls-1', 'sub-1');
      await useCases(t.db, T1).assignSubjectToClass('cls-1', 'sub-1');

      assert.deepEqual(links(), ['cls-1:sub-1']);
      assert.equal(t.get('SELECT created_at FROM class_subjects').created_at, T0);
    });

    it('lets one subject belong to many classes and one class have many subjects', async () => {
      const assignments = useCases();
      await assignments.assignSubjectToClass('cls-1', 'sub-2');
      await assignments.assignSubjectToClass('cls-3', 'sub-2');
      await assignments.assignSubjectToClass('cls-1', 'sub-1');

      assert.deepEqual(links(), ['cls-1:sub-1', 'cls-1:sub-2', 'cls-3:sub-2']);
    });

    it('removes one assignment and leaves the others', async () => {
      const assignments = useCases();
      await assignments.assignSubjectToClass('cls-1', 'sub-1');
      await assignments.assignSubjectToClass('cls-1', 'sub-2');
      await assignments.assignSubjectToClass('cls-2', 'sub-1');

      await assignments.removeSubjectFromClass('cls-1', 'sub-1');

      assert.deepEqual(links(), ['cls-1:sub-2', 'cls-2:sub-1']);
      assert.equal(t.get('SELECT COUNT(*) AS n FROM subjects').n, 3);
      assert.equal(t.get('SELECT COUNT(*) AS n FROM classes').n, 3);
    });

    it('does nothing when removing an assignment that does not exist', async () => {
      await useCases().removeSubjectFromClass('cls-1', 'sub-1');
      assert.deepEqual(links(), []);
    });
  });

  describe('lists', () => {
    beforeEach(async () => {
      const assignments = useCases();
      for (const subjectId of ['sub-1', 'sub-2', 'sub-3']) {
        await assignments.assignSubjectToClass('cls-1', subjectId);
      }
      await assignments.assignSubjectToClass('cls-2', 'sub-2');
      await assignments.assignSubjectToClass('cls-3', 'sub-2');
    });

    it('lists the subjects of a class alphabetically, ignoring case, as full records', async () => {
      const subjects = await useCases().listSubjectsForClass('cls-1');
      assert.deepEqual(names(subjects), ['biology', 'Mathematics', 'Programming 1']);
      assert.deepEqual(subjects[0], { id: 'sub-3', name: 'biology', createdAt: T0, updatedAt: T0 });
      assert.deepEqual(names(await useCases().listSubjectsForClass('cls-1')), names(subjects));
    });

    it('lists the classes of a subject alphabetically, ignoring case, as full records', async () => {
      const classes = await useCases().listClassesForSubject('sub-2');
      assert.deepEqual(names(classes), ['BSIT 1A', 'grade 11 STEM-A', 'Grade 11 STEM-B']);
      assert.deepEqual(classes[0], { id: 'cls-2', name: 'BSIT 1A', createdAt: T0, updatedAt: T0 });
    });

    it('returns only the classes of the chosen subject, as the scanning flow will need', async () => {
      assert.deepEqual(names(await useCases().listClassesForSubject('sub-1')), ['Grade 11 STEM-B']);
      assert.deepEqual(names(await useCases().listSubjectsForClass('cls-2')), ['Mathematics']);
    });

    it('returns an empty list for a class or subject with no assignments', async () => {
      insertClass('cls-4', 'BSCS 2B');
      insertSubject('sub-4', 'Data Structures');
      assert.deepEqual(await useCases().listSubjectsForClass('cls-4'), []);
      assert.deepEqual(await useCases().listClassesForSubject('sub-4'), []);
    });

    it('counts assignments per class and per subject, omitting those with none', async () => {
      assert.deepEqual(await useCases().countSubjectsByClass(), {
        'cls-1': 3,
        'cls-2': 1,
        'cls-3': 1,
      });
      assert.deepEqual(await useCases().countClassesBySubject(), {
        'sub-1': 1,
        'sub-2': 3,
        'sub-3': 1,
      });
    });
  });

  describe('replace', () => {
    it('makes the given subjects the complete set, adding and removing in one step', async () => {
      const assignments = useCases(t.db, T0);
      await assignments.assignSubjectToClass('cls-1', 'sub-1');
      await assignments.assignSubjectToClass('cls-1', 'sub-2');
      await assignments.assignSubjectToClass('cls-2', 'sub-1');

      await useCases(t.db, T1).replaceSubjectsForClass('cls-1', ['sub-2', 'sub-3']);

      assert.deepEqual(links(), ['cls-1:sub-2', 'cls-1:sub-3', 'cls-2:sub-1']);
      // The assignment that stayed keeps its timestamp; the new one gets the current time.
      const created = Object.fromEntries(
        t
          .all('SELECT subject_id, created_at FROM class_subjects WHERE class_id = ?', 'cls-1')
          .map((row) => [row.subject_id, row.created_at])
      );
      assert.deepEqual(created, { 'sub-2': T0, 'sub-3': T1 });
    });

    it('accepts an empty selection, leaving the class with no subjects', async () => {
      await useCases().assignSubjectToClass('cls-1', 'sub-1');
      await useCases().assignSubjectToClass('cls-2', 'sub-1');

      await useCases().replaceSubjectsForClass('cls-1', []);

      assert.deepEqual(links(), ['cls-2:sub-1']);
    });

    it('ignores a subject id given twice', async () => {
      await useCases().replaceSubjectsForClass('cls-1', ['sub-1', 'sub-1', 'sub-2']);
      assert.deepEqual(links(), ['cls-1:sub-1', 'cls-1:sub-2']);
    });

    it('changes nothing when one of the subjects does not exist', async () => {
      await useCases().assignSubjectToClass('cls-1', 'sub-1');

      await assert.rejects(
        useCases().replaceSubjectsForClass('cls-1', ['sub-2', 'missing']),
        SubjectNotFoundError
      );
      assert.deepEqual(links(), ['cls-1:sub-1']);
    });

    it('rolls back completely when a write fails part-way', async () => {
      const assignments = useCases();
      await assignments.assignSubjectToClass('cls-1', 'sub-1');
      await assignments.assignSubjectToClass('cls-1', 'sub-2');

      // The delete of sub-1 and the first insert succeed; the second insert fails.
      let inserts = 0;
      const failing = {
        ...t.db,
        runAsync: async (sql, params = []) => {
          const result = await t.db.runAsync(sql, params);
          if (sql.startsWith('INSERT') && ++inserts === 2) throw new Error('disk I/O error');
          return result;
        },
      };

      insertSubject('sub-4', 'Data Structures');
      await assert.rejects(
        useCases(failing).replaceSubjectsForClass('cls-1', ['sub-2', 'sub-3', 'sub-4']),
        (error) => {
          assert.ok(error instanceof DatabaseError);
          assert.equal(error.code, 'DATABASE_ERROR');
          assert.ok(!error.message.includes('disk I/O'));
          return true;
        }
      );
      assert.deepEqual(links(), ['cls-1:sub-1', 'cls-1:sub-2']);

      // The connection still works afterwards.
      await useCases().replaceSubjectsForClass('cls-1', ['sub-3']);
      assert.deepEqual(links(), ['cls-1:sub-3']);
    });

    it('passes every id as a parameter, never inside the SQL text', async () => {
      const calls = [];
      const record = (method) => (sql, params = []) => {
        calls.push({ sql, params });
        return t.db[method](sql, params);
      };
      const spy = {
        ...t.db,
        getFirstAsync: record('getFirstAsync'),
        getAllAsync: record('getAllAsync'),
        runAsync: record('runAsync'),
      };
      const assignments = useCases(spy);

      await assignments.replaceSubjectsForClass('cls-1', ['sub-1', 'sub-2']);
      await assignments.removeSubjectFromClass('cls-1', 'sub-1');
      await assignments.listSubjectsForClass('cls-1');
      await assignments.listClassesForSubject('sub-2');
      await assignments.isSubjectAssignedToClass('cls-1', 'sub-2');

      assert.ok(calls.length >= 10);
      for (const { sql } of calls) {
        assert.doesNotMatch(sql, /cls-1|sub-1|sub-2|2026-/);
      }
    });
  });

  describe('unknown records', () => {
    const assertUnknownClass = (promise) =>
      assert.rejects(promise, (error) => {
        assert.ok(error instanceof ClassNotFoundError);
        assert.ok(error instanceof RecordNotFoundError);
        assert.equal(error.code, 'NOT_FOUND');
        assert.equal(error.id, 'missing');
        return true;
      });
    const assertUnknownSubject = (promise) =>
      assert.rejects(promise, (error) => {
        assert.ok(error instanceof SubjectNotFoundError);
        assert.ok(error instanceof RecordNotFoundError);
        assert.equal(error.code, 'NOT_FOUND');
        assert.equal(error.id, 'missing');
        return true;
      });

    it('reports an unknown class with a typed error in every operation', async () => {
      const assignments = useCases();
      await assertUnknownClass(assignments.listSubjectsForClass('missing'));
      await assertUnknownClass(assignments.assignSubjectToClass('missing', 'sub-1'));
      await assertUnknownClass(assignments.removeSubjectFromClass('missing', 'sub-1'));
      await assertUnknownClass(assignments.replaceSubjectsForClass('missing', ['sub-1']));
      await assertUnknownClass(assignments.isSubjectAssignedToClass('missing', 'sub-1'));
      assert.deepEqual(links(), []);
    });

    it('reports an unknown subject with a typed error in every operation', async () => {
      const assignments = useCases();
      await assertUnknownSubject(assignments.listClassesForSubject('missing'));
      await assertUnknownSubject(assignments.assignSubjectToClass('cls-1', 'missing'));
      await assertUnknownSubject(assignments.removeSubjectFromClass('cls-1', 'missing'));
      await assertUnknownSubject(assignments.replaceSubjectsForClass('cls-1', ['missing']));
      await assertUnknownSubject(assignments.isSubjectAssignedToClass('cls-1', 'missing'));
      assert.deepEqual(links(), []);
    });
  });

  describe('deleting a class or a subject', () => {
    beforeEach(async () => {
      const assignments = useCases();
      await assignments.assignSubjectToClass('cls-1', 'sub-1');
      await assignments.assignSubjectToClass('cls-1', 'sub-2');
      await assignments.assignSubjectToClass('cls-2', 'sub-1');
      await assignments.assignSubjectToClass('cls-2', 'sub-3');
    });

    it('deleting an unused class removes its assignments and nothing else', async () => {
      await classUseCases().deleteClass('cls-1');

      assert.deepEqual(links(), ['cls-2:sub-1', 'cls-2:sub-3']);
      assert.deepEqual(
        t.all('SELECT id FROM classes ORDER BY id').map((row) => row.id),
        ['cls-2', 'cls-3']
      );
      assert.equal(t.get('SELECT COUNT(*) AS n FROM subjects').n, 3);
    });

    it('deleting an unused subject removes its assignments and nothing else', async () => {
      await subjectUseCases().deleteSubject('sub-1');

      assert.deepEqual(links(), ['cls-1:sub-2', 'cls-2:sub-3']);
      assert.deepEqual(
        t.all('SELECT id FROM subjects ORDER BY id').map((row) => row.id),
        ['sub-2', 'sub-3']
      );
      assert.equal(t.get('SELECT COUNT(*) AS n FROM classes').n, 3);
    });

    it('still refuses to delete a class that has students, and keeps its assignments', async () => {
      t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', 'stu-1', 'cls-1', '001', 'A', T0, T0);

      await assert.rejects(classUseCases().deleteClass('cls-1'), (error) => {
        assert.ok(error instanceof ClassInUseError);
        assert.equal(error.studentCount, 1);
        return true;
      });
      assert.deepEqual(links(), ['cls-1:sub-1', 'cls-1:sub-2', 'cls-2:sub-1', 'cls-2:sub-3']);
      assert.equal(t.get('SELECT COUNT(*) AS n FROM students').n, 1);
    });

    it('still refuses to delete a class or subject that an exam uses, and keeps assignments', async () => {
      t.run('INSERT INTO exams VALUES (?, ?, ?, ?, ?, ?, ?)', 'exm-1', 'sub-1', 'cls-1', 'Quiz', 5, T0, T0);

      await assert.rejects(classUseCases().deleteClass('cls-1'), ClassInUseError);
      await assert.rejects(subjectUseCases().deleteSubject('sub-1'), (error) => {
        assert.ok(error instanceof SubjectInUseError);
        assert.equal(error.examCount, 1);
        return true;
      });
      assert.deepEqual(links(), ['cls-1:sub-1', 'cls-1:sub-2', 'cls-2:sub-1', 'cls-2:sub-3']);
      assert.equal(t.get('SELECT COUNT(*) AS n FROM exams').n, 1);
    });

    it('removing an assignment never deletes a class, subject, student, or exam', async () => {
      t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', 'stu-1', 'cls-1', '001', 'A', T0, T0);
      t.run('INSERT INTO exams VALUES (?, ?, ?, ?, ?, ?, ?)', 'exm-1', 'sub-1', 'cls-1', 'Quiz', 5, T0, T0);

      await useCases().replaceSubjectsForClass('cls-1', []);

      assert.deepEqual(links(), ['cls-2:sub-1', 'cls-2:sub-3']);
      for (const [table, expected] of [['classes', 3], ['subjects', 3], ['students', 1], ['exams', 1]]) {
        assert.equal(t.get(`SELECT COUNT(*) AS n FROM ${table}`).n, expected, table);
      }
    });
  });
});
