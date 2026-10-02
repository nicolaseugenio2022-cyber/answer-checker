// Verifies the Subjects and Classes use cases and their SQLite repositories
// against real SQLite, on disposable databases created by migration 1.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  ApplicationError,
  DuplicateNameError,
  InvalidNameError,
  RecordInUseError,
  RecordNotFoundError,
} from '../../src/core/application/errors.ts';
import { DatabaseError } from '../../src/core/infrastructure/database/database-error.ts';
import { initializeDatabase } from '../../src/core/infrastructure/database/initialize-database.ts';
import { ClassInUseError } from '../../src/features/classes/application/class-repository.ts';
import { createClassUseCases } from '../../src/features/classes/application/class-use-cases.ts';
import { CLASS_NAME_MAX_LENGTH } from '../../src/features/classes/domain/school-class.ts';
import { createSqliteClassRepository } from '../../src/features/classes/infrastructure/sqlite-class-repository.ts';
import { SubjectInUseError } from '../../src/features/subjects/application/subject-repository.ts';
import { createSubjectUseCases } from '../../src/features/subjects/application/subject-use-cases.ts';
import { SUBJECT_NAME_MAX_LENGTH } from '../../src/features/subjects/domain/subject.ts';
import { createSqliteSubjectRepository } from '../../src/features/subjects/infrastructure/sqlite-subject-repository.ts';
import { openTestDatabase } from './test-database.mjs';

const T0 = '2026-10-02T08:30:00.000Z';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let t;

beforeEach(async () => {
  t = openTestDatabase();
  await initializeDatabase(t.db);
});

afterEach(() => {
  t.close();
});

/** Ids id-1, id-2, ... and a clock that advances one second per reading, starting at T0. */
function deterministicDependencies() {
  let ids = 0;
  let ticks = 0;
  return {
    idGenerator: { newId: () => `id-${++ids}` },
    clock: { now: () => new Date(Date.parse(T0) + 1000 * ticks++).toISOString() },
  };
}

/** Wraps a connection and records every statement and its parameters. */
function recording(db) {
  const calls = [];
  const record =
    (method) =>
    (sql, params = []) => {
      calls.push({ sql, params });
      return db[method](sql, params);
    };
  return {
    calls,
    db: {
      ...db,
      getFirstAsync: record('getFirstAsync'),
      getAllAsync: record('getAllAsync'),
      runAsync: record('runAsync'),
    },
  };
}

/**
 * A connection whose matching write is carried out and then reported as
 * failed, so only a rollback can undo it.
 */
function failingAfterWrite(db, pattern) {
  return {
    ...db,
    runAsync: async (sql, params = []) => {
      const result = await db.runAsync(sql, params);
      if (pattern.test(sql)) throw new Error('disk I/O error');
      return result;
    },
  };
}

function insertSubject(id, name) {
  t.run('INSERT INTO subjects VALUES (?, ?, ?, ?)', id, name, T0, T0);
}

function insertClass(id, name) {
  t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', id, name, T0, T0);
}

function insertStudent(id, classId) {
  t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', id, classId, id, `Student ${id}`, T0, T0);
}

function insertExam(id, subjectId, classId) {
  t.run('INSERT INTO exams VALUES (?, ?, ?, ?, ?, ?, ?)', id, subjectId, classId, id, 10, T0, T0);
}

// One description per feature, so both get the same rules tested the same way.
const FEATURES = [
  {
    table: 'subjects',
    maxLength: SUBJECT_NAME_MAX_LENGTH,
    build(db, dependencies) {
      const repository = createSqliteSubjectRepository(db);
      const useCases = createSubjectUseCases({ repository, ...dependencies });
      return {
        repository,
        list: useCases.listSubjects,
        add: useCases.addSubject,
        rename: useCases.renameSubject,
        remove: useCases.deleteSubject,
      };
    },
  },
  {
    table: 'classes',
    maxLength: CLASS_NAME_MAX_LENGTH,
    build(db, dependencies) {
      const repository = createSqliteClassRepository(db);
      const useCases = createClassUseCases({ repository, ...dependencies });
      return {
        repository,
        list: useCases.listClasses,
        add: useCases.addClass,
        rename: useCases.renameClass,
        remove: useCases.deleteClass,
      };
    },
  },
];

for (const feature of FEATURES) {
  const { table, maxLength } = feature;
  const rows = () => t.all(`SELECT * FROM ${table} ORDER BY id`);
  const build = (db = t.db) => feature.build(db, deterministicDependencies());

  describe(`${table}: create and list`, () => {
    it('creates a record with the injected id and timestamp and stores it', async () => {
      const created = await build().add('Mathematics');

      assert.deepEqual(created, {
        id: 'id-1',
        name: 'Mathematics',
        createdAt: T0,
        updatedAt: T0,
      });
      assert.deepEqual(
        rows().map((row) => ({ ...row })),
        [{ id: 'id-1', name: 'Mathematics', created_at: T0, updated_at: T0 }]
      );
      assert.match(created.createdAt, ISO_UTC);
    });

    it('trims surrounding whitespace before storing', async () => {
      const created = await build().add('  \t Science \n ');
      assert.equal(created.name, 'Science');
      assert.equal(rows()[0].name, 'Science');
    });

    it('lists alphabetically, ignoring letter case, in a stable order', async () => {
      const useCases = build();
      for (const name of ['banana', 'Cherry', 'apple', 'Banana 2', 'APRICOT']) {
        await useCases.add(name);
      }
      const expected = ['apple', 'APRICOT', 'banana', 'Banana 2', 'Cherry'];
      assert.deepEqual((await useCases.list()).map((record) => record.name), expected);
      assert.deepEqual((await useCases.list()).map((record) => record.name), expected);
    });

    it('returns an empty list when nothing has been added', async () => {
      assert.deepEqual(await build().list(), []);
    });

    it('reads one record by id, and null for an unknown id', async () => {
      const { add, repository } = build();
      const created = await add('Mathematics');
      assert.deepEqual(await repository.getById(created.id), created);
      assert.equal(await repository.getById('missing'), null);
    });
  });

  describe(`${table}: name rules`, () => {
    it('rejects an empty or whitespace-only name with a typed error', async () => {
      const useCases = build();
      for (const blank of ['', '   ', '\n\t ']) {
        await assert.rejects(useCases.add(blank), (error) => {
          assert.ok(error instanceof InvalidNameError);
          assert.ok(error instanceof ApplicationError);
          assert.equal(error.code, 'VALIDATION_ERROR');
          assert.equal(error.problem, 'EMPTY');
          return true;
        });
      }
      assert.equal(rows().length, 0);
    });

    it('accepts a name of exactly the maximum length and rejects one character more', async () => {
      const useCases = build();
      const longest = 'x'.repeat(maxLength);

      assert.equal((await useCases.add(`  ${longest}  `)).name, longest);
      await assert.rejects(useCases.add(`${longest}y`), (error) => {
        assert.ok(error instanceof InvalidNameError);
        assert.equal(error.problem, 'TOO_LONG');
        assert.equal(error.maxLength, maxLength);
        return true;
      });
      assert.equal(rows().length, 1);
    });

    it('counts characters, not UTF-16 units, toward the maximum length', async () => {
      const name = '😀'.repeat(maxLength);
      assert.ok(name.length > maxLength);
      assert.equal((await build().add(name)).name, name);
    });

    it('rejects a duplicate name, ignoring letter case and surrounding whitespace', async () => {
      const useCases = build();
      await useCases.add('Mathematics');

      for (const duplicate of ['Mathematics', 'mathematics', '  MATHEMATICS ']) {
        await assert.rejects(useCases.add(duplicate), (error) => {
          assert.ok(error instanceof DuplicateNameError);
          assert.equal(error.code, 'DUPLICATE_NAME');
          assert.equal(error.duplicateName, 'Mathematics');
          return true;
        });
      }
      assert.equal(rows().length, 1);
    });

    it('treats names that differ only in the case of a non-ASCII letter as duplicates', async () => {
      const useCases = build();
      await useCases.add('Édukasyon');
      await assert.rejects(useCases.add('édukasyon'), DuplicateNameError);
      assert.equal(rows().length, 1);
    });

    it('reports the UNIQUE constraint itself as a duplicate when the earlier check is bypassed', async () => {
      const blind = {
        ...t.db,
        getAllAsync: async (sql, params) =>
          sql.startsWith('SELECT id, name FROM') ? [] : t.db.getAllAsync(sql, params),
      };
      const useCases = build(blind);
      await useCases.add('Mathematics');
      await assert.rejects(useCases.add('MATHEMATICS'), DuplicateNameError);
      assert.equal(rows().length, 1);
    });
  });

  describe(`${table}: rename`, () => {
    it('changes the name and updated_at and keeps the id and created_at', async () => {
      const useCases = build();
      const created = await useCases.add('Mathematics');

      const renamed = await useCases.rename(created.id, '  General Mathematics ');

      assert.equal(renamed.id, created.id);
      assert.equal(renamed.name, 'General Mathematics');
      assert.equal(renamed.createdAt, T0);
      assert.equal(renamed.updatedAt, '2026-10-02T08:30:01.000Z');
      assert.deepEqual({ ...rows()[0] }, {
        id: created.id,
        name: 'General Mathematics',
        created_at: T0,
        updated_at: '2026-10-02T08:30:01.000Z',
      });
    });

    it('does nothing when the new name equals the current one', async () => {
      const spy = recording(t.db);
      const useCases = build(spy.db);
      const created = await useCases.add('Mathematics');
      spy.calls.length = 0;

      const result = await useCases.rename(created.id, '  Mathematics ');

      assert.deepEqual(result, created);
      assert.equal(rows()[0].updated_at, T0);
      assert.ok(spy.calls.every((call) => !call.sql.startsWith('UPDATE')));
    });

    it('allows changing only the letter case of a name', async () => {
      const useCases = build();
      const created = await useCases.add('mathematics');
      assert.equal((await useCases.rename(created.id, 'Mathematics')).name, 'Mathematics');
      assert.equal(rows()[0].name, 'Mathematics');
    });

    it('rejects renaming to the name of another record', async () => {
      const useCases = build();
      await useCases.add('Mathematics');
      const science = await useCases.add('Science');

      await assert.rejects(useCases.rename(science.id, 'MATHEMATICS'), DuplicateNameError);
      assert.equal(t.get(`SELECT name FROM ${table} WHERE id = ?`, science.id).name, 'Science');
    });

    it('rejects an invalid new name and leaves the record unchanged', async () => {
      const useCases = build();
      const created = await useCases.add('Mathematics');

      await assert.rejects(useCases.rename(created.id, '   '), InvalidNameError);
      await assert.rejects(useCases.rename(created.id, 'x'.repeat(maxLength + 1)), InvalidNameError);
      assert.equal(rows()[0].name, 'Mathematics');
    });

    it('reports a missing record with a typed error', async () => {
      await assert.rejects(build().rename('missing', 'Mathematics'), (error) => {
        assert.ok(error instanceof RecordNotFoundError);
        assert.equal(error.code, 'NOT_FOUND');
        assert.equal(error.id, 'missing');
        return true;
      });
    });

    it('reports a record that vanished between the read and the write', async () => {
      const { repository } = build();
      await assert.rejects(repository.rename('missing', 'Mathematics', T0), RecordNotFoundError);
    });
  });

  describe(`${table}: permanent deletion`, () => {
    it('physically deletes an unused record and leaves no row behind', async () => {
      const useCases = build();
      const kept = await useCases.add('Mathematics');
      const removed = await useCases.add('Science');

      await useCases.remove(removed.id);

      assert.deepEqual(rows().map((row) => row.id), [kept.id]);
      assert.equal(t.get(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`, removed.id).n, 0);
      assert.deepEqual((await useCases.list()).map((record) => record.name), ['Mathematics']);
    });

    it('has no column that could mark a row as deleted instead of removing it', () => {
      const columns = t.all(`SELECT name FROM pragma_table_info('${table}')`).map((c) => c.name);
      assert.deepEqual(columns, ['id', 'name', 'created_at', 'updated_at']);
    });

    it('lets a deleted name be used again', async () => {
      const useCases = build();
      const first = await useCases.add('Mathematics');
      await useCases.remove(first.id);
      assert.equal((await useCases.add('mathematics')).name, 'mathematics');
    });

    it('reports a missing record with a typed error', async () => {
      await assert.rejects(build().remove('missing'), RecordNotFoundError);
    });
  });

  describe(`${table}: SQL safety and failures`, () => {
    it('passes every value as a parameter, never inside the SQL text', async () => {
      const spy = recording(t.db);
      const useCases = build(spy.db);
      const hostile = `x'); DROP TABLE ${table}; --`;
      const renamedTo = `y" OR 1=1; DELETE FROM ${table}; --`;

      const created = await useCases.add(hostile);
      await useCases.rename(created.id, renamedTo);
      await useCases.list();
      await useCases.remove(created.id);

      assert.ok(spy.calls.length >= 8);
      for (const { sql } of spy.calls) {
        for (const value of [hostile, renamedTo, created.id, 'DROP TABLE', 'OR 1=1']) {
          assert.ok(!sql.includes(value), `value found inside SQL: ${sql}`);
        }
      }
      const parameters = spy.calls.flatMap((call) => call.params);
      for (const value of [hostile, renamedTo, created.id]) {
        assert.ok(parameters.includes(value));
      }
      // The table survived, and the hostile text was stored as plain text.
      assert.equal(rows().length, 0);
      const again = await useCases.add(hostile);
      assert.equal(t.get(`SELECT name FROM ${table} WHERE id = ?`, again.id).name, hostile);
    });

    it('rolls back a create whose write failed, and reports a typed database error', async () => {
      const useCases = build(failingAfterWrite(t.db, /^INSERT/));

      await assert.rejects(useCases.add('Mathematics'), (error) => {
        assert.ok(error instanceof DatabaseError);
        assert.equal(error.code, 'DATABASE_ERROR');
        assert.ok(!error.message.includes('disk I/O'));
        assert.equal(error.cause.message, 'disk I/O error');
        return true;
      });
      assert.equal(rows().length, 0);
    });

    it('rolls back a rename whose write failed', async () => {
      const created = await build().add('Mathematics');
      const useCases = build(failingAfterWrite(t.db, /^UPDATE/));

      await assert.rejects(useCases.rename(created.id, 'Science'), DatabaseError);
      assert.deepEqual({ ...rows()[0] }, {
        id: created.id,
        name: 'Mathematics',
        created_at: T0,
        updated_at: T0,
      });
    });

    it('rolls back a delete whose write failed', async () => {
      const created = await build().add('Mathematics');
      const useCases = build(failingAfterWrite(t.db, /^DELETE/));

      await assert.rejects(useCases.remove(created.id), DatabaseError);
      assert.equal(rows().length, 1);
    });

    it('keeps working on the same connection after a failed write', async () => {
      await assert.rejects(build(failingAfterWrite(t.db, /^INSERT/)).add('Mathematics'));
      assert.equal((await build().add('Mathematics')).name, 'Mathematics');
    });

    it('wraps a failed read in a typed database error', async () => {
      const broken = {
        ...t.db,
        getAllAsync: async () => {
          throw new Error('database disk image is malformed');
        },
      };
      await assert.rejects(build(broken).list(), (error) => {
        assert.ok(error instanceof DatabaseError);
        assert.ok(!error.message.includes('malformed'));
        return true;
      });
    });
  });
}

describe('subjects: deletion blocked by exams', () => {
  const useCases = () => FEATURES[0].build(t.db, deterministicDependencies());

  it('refuses to delete a subject that exams use, and reports how many', async () => {
    insertSubject('sub-1', 'Mathematics');
    insertSubject('sub-2', 'Science');
    insertClass('cls-1', 'Grade 7 - A');
    insertExam('exm-1', 'sub-1', 'cls-1');
    insertExam('exm-2', 'sub-1', 'cls-1');
    insertExam('exm-3', 'sub-2', 'cls-1');

    await assert.rejects(useCases().remove('sub-1'), (error) => {
      assert.ok(error instanceof SubjectInUseError);
      assert.ok(error instanceof RecordInUseError);
      assert.equal(error.code, 'IN_USE');
      assert.equal(error.examCount, 2);
      return true;
    });

    // Nothing was deleted: not the subject, and not its exams.
    assert.equal(t.get('SELECT COUNT(*) AS n FROM subjects').n, 2);
    assert.equal(t.get('SELECT COUNT(*) AS n FROM exams').n, 3);
  });

  it('deletes the subject once no exam uses it', async () => {
    insertSubject('sub-1', 'Mathematics');
    insertClass('cls-1', 'Grade 7 - A');
    insertExam('exm-1', 'sub-1', 'cls-1');
    await assert.rejects(useCases().remove('sub-1'), SubjectInUseError);

    t.run('DELETE FROM exams WHERE id = ?', 'exm-1');
    await useCases().remove('sub-1');
    assert.equal(t.get('SELECT COUNT(*) AS n FROM subjects').n, 0);
  });
});

describe('classes: deletion blocked by students and exams', () => {
  const useCases = () => FEATURES[1].build(t.db, deterministicDependencies());

  const assertBlocked = async (studentCount, examCount) => {
    await assert.rejects(useCases().remove('cls-1'), (error) => {
      assert.ok(error instanceof ClassInUseError);
      assert.ok(error instanceof RecordInUseError);
      assert.equal(error.code, 'IN_USE');
      assert.equal(error.studentCount, studentCount);
      assert.equal(error.examCount, examCount);
      return true;
    });
    assert.equal(t.get('SELECT COUNT(*) AS n FROM classes WHERE id = ?', 'cls-1').n, 1);
  };

  beforeEach(() => {
    insertClass('cls-1', 'Grade 7 - A');
    insertClass('cls-2', 'Grade 7 - B');
    insertSubject('sub-1', 'Mathematics');
  });

  it('refuses to delete a class that has students, and reports how many', async () => {
    insertStudent('stu-1', 'cls-1');
    insertStudent('stu-2', 'cls-1');
    insertStudent('stu-3', 'cls-2');

    await assertBlocked(2, 0);
    assert.equal(t.get('SELECT COUNT(*) AS n FROM students').n, 3);
  });

  it('refuses to delete a class that exams use, and reports how many', async () => {
    insertExam('exm-1', 'sub-1', 'cls-1');
    insertExam('exm-2', 'sub-1', 'cls-2');

    await assertBlocked(0, 1);
    assert.equal(t.get('SELECT COUNT(*) AS n FROM exams').n, 2);
  });

  it('reports both counts accurately when students and exams exist', async () => {
    for (const id of ['stu-1', 'stu-2', 'stu-3']) insertStudent(id, 'cls-1');
    insertStudent('stu-4', 'cls-2');
    insertExam('exm-1', 'sub-1', 'cls-1');
    insertExam('exm-2', 'sub-1', 'cls-1');
    insertExam('exm-3', 'sub-1', 'cls-2');

    await assertBlocked(3, 2);
    assert.equal(t.get('SELECT COUNT(*) AS n FROM students').n, 4);
    assert.equal(t.get('SELECT COUNT(*) AS n FROM exams').n, 3);
  });

  it('deletes the class once it has no students and no exams', async () => {
    insertStudent('stu-1', 'cls-1');
    insertExam('exm-1', 'sub-1', 'cls-1');
    await assertBlocked(1, 1);

    t.run('DELETE FROM students WHERE id = ?', 'stu-1');
    t.run('DELETE FROM exams WHERE id = ?', 'exm-1');
    await useCases().remove('cls-1');

    assert.deepEqual(
      t.all('SELECT id FROM classes').map((row) => row.id),
      ['cls-2']
    );
  });
});
