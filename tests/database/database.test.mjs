// Verifies the database foundation against real SQLite (Node's built-in
// node:sqlite), using the app's own migration and transaction code.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  DatabaseError,
  MigrationFailedError,
  UnsupportedSchemaVersionError,
} from '../../src/core/infrastructure/database/database-error.ts';
import { initializeDatabase } from '../../src/core/infrastructure/database/initialize-database.ts';
import { MIGRATIONS } from '../../src/core/infrastructure/database/migrations.ts';
import { runInTransaction } from '../../src/core/infrastructure/database/run-in-transaction.ts';
import { runMigrations } from '../../src/core/infrastructure/database/run-migrations.ts';
import { openTestDatabase } from './test-database.mjs';

const NOW = '2026-10-02T08:30:00.000Z';
const LATEST = MIGRATIONS.length;

const EXPECTED_TABLES = [
  'answer_keys',
  'class_subjects',
  'classes',
  'exam_questions',
  'exam_results',
  'exams',
  'scan_records',
  'student_answers',
  'students',
  'subjects',
];

let t;

beforeEach(async () => {
  t = openTestDatabase();
  await initializeDatabase(t.db);
});

afterEach(() => {
  t.close();
});

/** Inserts one of everything: a subject, class, student, exam with a keyed question, and a result. */
function seed() {
  t.run('INSERT INTO subjects VALUES (?, ?, ?, ?)', 'sub-1', 'Mathematics', NOW, NOW);
  t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', 'cls-1', 'Grade 7 - A', NOW, NOW);
  t.run(
    'INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)',
    'stu-1',
    'cls-1',
    '001',
    'Student One',
    NOW,
    NOW
  );
  t.run(
    'INSERT INTO exams VALUES (?, ?, ?, ?, ?, ?, ?)',
    'exm-1',
    'sub-1',
    'cls-1',
    'Quiz 1',
    2,
    NOW,
    NOW
  );
  t.run('INSERT INTO exam_questions VALUES (?, ?, ?, ?, ?)', 'q-1', 'exm-1', 1, 4, 1);
  t.run('INSERT INTO exam_questions VALUES (?, ?, ?, ?, ?)', 'q-2', 'exm-1', 2, 4, 1);
  t.run('INSERT INTO answer_keys VALUES (?, ?, ?)', 'key-1', 'q-1', 'B');
  t.run('INSERT INTO exam_results VALUES (?, ?, ?, ?, ?, ?)', 'res-1', 'exm-1', 'stu-1', 1, 2, NOW);
  t.run(
    'INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)',
    'ans-1',
    'res-1',
    1,
    'SELECTED',
    'B',
    1,
    0
  );
  t.run(
    'INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)',
    'ans-2',
    'res-1',
    2,
    'BLANK',
    null,
    0,
    0
  );
  t.run('INSERT INTO scan_records VALUES (?, ?, ?, ?)', 'scn-1', 'res-1', 'scans/res-1.jpg', NOW);
}

const count = (table) => t.get(`SELECT count(*) AS n FROM ${table}`).n;
const userVersion = () => t.get('PRAGMA user_version').user_version;
const schemaSnapshot = () =>
  JSON.stringify(t.all('SELECT type, name, sql FROM sqlite_master ORDER BY type, name'));

describe('fresh database', () => {
  it('applies every migration and sets user_version to the latest', () => {
    assert.equal(userVersion(), LATEST);
    assert.ok(LATEST >= 1);
  });

  it('creates exactly the expected tables', () => {
    const tables = t
      .all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .map((row) => row.name)
      .sort();
    assert.deepEqual(tables, EXPECTED_TABLES);
  });

  it('creates every table as STRICT', () => {
    for (const row of t.all('SELECT * FROM pragma_table_list')) {
      if (EXPECTED_TABLES.includes(row.name)) assert.equal(row.strict, 1, row.name);
    }
  });

  it('creates the expected indexes', () => {
    const indexes = t
      .all("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
      .map((row) => row.name)
      .sort();
    assert.deepEqual(indexes, [
      'idx_class_subjects_subject_id',
      'idx_exam_results_created_at',
      'idx_exam_results_exam_id_student_id',
      'idx_exam_results_student_id',
      'idx_exams_class_id',
      'idx_exams_created_at',
      'idx_exams_subject_id',
      'idx_students_class_id_full_name',
      'idx_students_student_number',
    ]);
  });

  it('has an index that starts with every foreign-key column', () => {
    for (const table of EXPECTED_TABLES) {
      const leadingColumns = t
        .all(`SELECT * FROM pragma_index_list('${table}')`)
        .map((index) => t.all(`SELECT * FROM pragma_index_info('${index.name}') ORDER BY seqno`)[0].name);
      for (const foreignKey of t.all(`SELECT * FROM pragma_foreign_key_list('${table}')`)) {
        assert.ok(
          leadingColumns.includes(foreignKey.from),
          `${table}.${foreignKey.from} has no index`
        );
      }
    }
  });

  it('declares the intended foreign keys and delete rules', () => {
    const rules = [];
    for (const table of EXPECTED_TABLES) {
      for (const fk of t.all(`SELECT * FROM pragma_foreign_key_list('${table}')`)) {
        rules.push(`${table}.${fk.from} -> ${fk.table}.${fk.to} ${fk.on_delete}`);
      }
    }
    assert.deepEqual(rules.sort(), [
      'answer_keys.exam_question_id -> exam_questions.id CASCADE',
      'class_subjects.class_id -> classes.id CASCADE',
      'class_subjects.subject_id -> subjects.id CASCADE',
      'exam_questions.exam_id -> exams.id CASCADE',
      'exam_results.exam_id -> exams.id RESTRICT',
      'exam_results.student_id -> students.id RESTRICT',
      'exams.class_id -> classes.id RESTRICT',
      'exams.subject_id -> subjects.id RESTRICT',
      'scan_records.result_id -> exam_results.id CASCADE',
      'student_answers.result_id -> exam_results.id CASCADE',
      'students.class_id -> classes.id RESTRICT',
    ]);
  });

  it('uses a non-null TEXT primary key named id on every table except the join table', () => {
    for (const table of EXPECTED_TABLES) {
      // class_subjects is identified by the pair it links, checked in the migration 2 tests.
      if (table === 'class_subjects') continue;
      const id = t.all(`SELECT * FROM pragma_table_info('${table}')`).find((column) => column.name === 'id');
      assert.ok(id, `${table} has no id column`);
      assert.equal(id.type, 'TEXT', table);
      assert.equal(id.pk, 1, table);
      assert.equal(id.notnull, 1, table);
    }
  });

  it('has no soft-delete, archive, or synchronization columns or tables', () => {
    const forbidden = /delet|archiv|tombstone|sync|remote|cloud|server|outbox|queue|dirty/i;
    for (const table of EXPECTED_TABLES) {
      assert.doesNotMatch(table, forbidden);
      for (const column of t.all(`SELECT * FROM pragma_table_info('${table}')`)) {
        assert.doesNotMatch(column.name, forbidden, `${table}.${column.name}`);
      }
    }
  });

  it('has no teacher, account, role, or permission table', () => {
    for (const table of EXPECTED_TABLES) {
      assert.doesNotMatch(table, /teacher|account|user|role|permission|session/i);
    }
  });

  it('contains no seeded rows', () => {
    for (const table of EXPECTED_TABLES) assert.equal(count(table), 0, table);
  });
});

describe('connection setup', () => {
  it('turns on foreign-key enforcement, which is off when the connection opens', () => {
    assert.equal(t.get('PRAGMA foreign_keys').foreign_keys, 1);
  });

  it('uses write-ahead logging', () => {
    assert.equal(t.get('PRAGMA journal_mode').journal_mode, 'wal');
  });
});

describe('migration runner', () => {
  it('does nothing when run again at the current version', async () => {
    seed();
    const before = schemaSnapshot();
    assert.equal(await runMigrations(t.db, MIGRATIONS), LATEST);
    assert.equal(await initializeDatabase(t.db), LATEST);
    assert.equal(schemaSnapshot(), before);
    assert.equal(userVersion(), LATEST);
    assert.equal(count('exam_results'), 1);
  });

  it('applies a later migration without touching earlier ones', async () => {
    const next = {
      version: LATEST + 1,
      sql: 'CREATE TABLE later_addition (id TEXT PRIMARY KEY NOT NULL) STRICT;',
    };
    assert.equal(await runMigrations(t.db, [...MIGRATIONS, next]), LATEST + 1);
    assert.equal(userVersion(), LATEST + 1);
    assert.equal(count('later_addition'), 0);
  });

  it('rolls back a failing migration completely and keeps the version', async () => {
    const before = schemaSnapshot();
    const failing = {
      version: LATEST + 1,
      // The first statement succeeds; the second fails. Neither may remain.
      sql: 'CREATE TABLE half_done (id TEXT PRIMARY KEY NOT NULL) STRICT; CREATE TABLE subjects (id TEXT);',
    };
    await assert.rejects(runMigrations(t.db, [...MIGRATIONS, failing]), (error) => {
      assert.ok(error instanceof MigrationFailedError);
      assert.ok(error instanceof DatabaseError);
      assert.equal(error.version, LATEST + 1);
      assert.equal(error.code, 'DATABASE_ERROR');
      assert.ok(error.cause);
      return true;
    });
    assert.equal(userVersion(), LATEST);
    assert.equal(schemaSnapshot(), before);
  });

  it('refuses a database that is newer than the app supports', async () => {
    t.raw.exec(`PRAGMA user_version = ${LATEST + 5}`);
    const before = schemaSnapshot();
    await assert.rejects(runMigrations(t.db, MIGRATIONS), (error) => {
      assert.ok(error instanceof UnsupportedSchemaVersionError);
      assert.equal(error.foundVersion, LATEST + 5);
      assert.equal(error.supportedVersion, LATEST);
      return true;
    });
    assert.equal(userVersion(), LATEST + 5);
    assert.equal(schemaSnapshot(), before);
  });

  it('refuses a migration list that is not numbered 1, 2, 3 in order', async () => {
    const gap = [...MIGRATIONS, { version: LATEST + 2, sql: 'SELECT 1;' }];
    await assert.rejects(runMigrations(t.db, gap), DatabaseError);
    const duplicate = [...MIGRATIONS, { version: LATEST, sql: 'SELECT 1;' }];
    await assert.rejects(runMigrations(t.db, duplicate), DatabaseError);
    assert.equal(userVersion(), LATEST);
  });
});

describe('foreign-key enforcement', () => {
  beforeEach(seed);

  it('rejects a row that points at a parent that does not exist', () => {
    assert.throws(
      () =>
        t.run(
          'INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)',
          'stu-x',
          'no-such-class',
          '9',
          'X',
          NOW,
          NOW
        ),
      /FOREIGN KEY/
    );
    assert.throws(
      () =>
        t.run(
          'INSERT INTO exam_results VALUES (?, ?, ?, ?, ?, ?)',
          'res-x',
          'no-such-exam',
          'stu-1',
          0,
          1,
          NOW
        ),
      /FOREIGN KEY/
    );
  });

  it('removes a result together with its answers and scan record', () => {
    t.run('DELETE FROM exam_results WHERE id = ?', 'res-1');
    assert.equal(count('exam_results'), 0);
    assert.equal(count('student_answers'), 0);
    assert.equal(count('scan_records'), 0);
    // Nothing outside the result aggregate is touched.
    assert.equal(count('exams'), 1);
    assert.equal(count('students'), 1);
    assert.equal(count('exam_questions'), 2);
  });

  it('removes an exam that has no results together with its questions and answer keys', () => {
    t.run('DELETE FROM exam_results WHERE id = ?', 'res-1');
    t.run('DELETE FROM exams WHERE id = ?', 'exm-1');
    assert.equal(count('exams'), 0);
    assert.equal(count('exam_questions'), 0);
    assert.equal(count('answer_keys'), 0);
    assert.equal(count('subjects'), 1);
    assert.equal(count('classes'), 1);
  });

  it('removes an answer key when its question is deleted', () => {
    t.run('DELETE FROM exam_questions WHERE id = ?', 'q-1');
    assert.equal(count('answer_keys'), 0);
    assert.equal(count('exam_questions'), 1);
  });

  it('refuses to delete an exam that still has results', () => {
    assert.throws(() => t.run('DELETE FROM exams WHERE id = ?', 'exm-1'), /FOREIGN KEY/);
    assert.equal(count('exams'), 1);
    assert.equal(count('exam_questions'), 2);
    assert.equal(count('exam_results'), 1);
  });

  it('refuses to delete a student who still has results', () => {
    assert.throws(() => t.run('DELETE FROM students WHERE id = ?', 'stu-1'), /FOREIGN KEY/);
    assert.equal(count('students'), 1);
    assert.equal(count('exam_results'), 1);
  });

  it('refuses to delete a class that still has students or exams', () => {
    assert.throws(() => t.run('DELETE FROM classes WHERE id = ?', 'cls-1'), /FOREIGN KEY/);
    assert.equal(count('classes'), 1);
    assert.equal(count('students'), 1);
  });

  it('refuses to delete a subject that still has exams', () => {
    assert.throws(() => t.run('DELETE FROM subjects WHERE id = ?', 'sub-1'), /FOREIGN KEY/);
    assert.equal(count('subjects'), 1);
    assert.equal(count('exams'), 1);
  });

  it('allows deleting parents once their dependents are gone', () => {
    t.run('DELETE FROM exam_results WHERE id = ?', 'res-1');
    t.run('DELETE FROM exams WHERE id = ?', 'exm-1');
    t.run('DELETE FROM students WHERE id = ?', 'stu-1');
    t.run('DELETE FROM classes WHERE id = ?', 'cls-1');
    t.run('DELETE FROM subjects WHERE id = ?', 'sub-1');
    for (const table of EXPECTED_TABLES) assert.equal(count(table), 0, table);
  });
});

describe('uniqueness constraints', () => {
  beforeEach(seed);

  const rejectsUnique = (sql, ...params) => assert.throws(() => t.run(sql, ...params), /UNIQUE/);

  it('rejects a duplicate subject or class name, ignoring letter case', () => {
    rejectsUnique('INSERT INTO subjects VALUES (?, ?, ?, ?)', 'sub-2', 'MATHEMATICS', NOW, NOW);
    rejectsUnique('INSERT INTO classes VALUES (?, ?, ?, ?)', 'cls-2', 'grade 7 - a', NOW, NOW);
  });

  it('rejects a duplicate student number in the same class and in another class', () => {
    rejectsUnique(
      'INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)',
      'stu-2',
      'cls-1',
      '001',
      'Student Two',
      NOW,
      NOW
    );
    // Since migration 3 a Student ID is unique across all classes.
    t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', 'cls-2', 'Grade 7 - B', NOW, NOW);
    rejectsUnique(
      'INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)',
      'stu-2',
      'cls-2',
      '001',
      'Student Two',
      NOW,
      NOW
    );
    t.run(
      'INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)',
      'stu-2',
      'cls-2',
      '002',
      'Student Two',
      NOW,
      NOW
    );
    assert.equal(count('students'), 2);
  });

  it('rejects a duplicate question number in an exam', () => {
    rejectsUnique('INSERT INTO exam_questions VALUES (?, ?, ?, ?, ?)', 'q-3', 'exm-1', 1, 4, 1);
  });

  it('rejects a second answer key for a question', () => {
    rejectsUnique('INSERT INTO answer_keys VALUES (?, ?, ?)', 'key-2', 'q-1', 'C');
  });

  it('rejects a second result for the same student and exam', () => {
    rejectsUnique(
      'INSERT INTO exam_results VALUES (?, ?, ?, ?, ?, ?)',
      'res-2',
      'exm-1',
      'stu-1',
      0,
      2,
      NOW
    );
  });

  it('rejects a duplicate answer for a question, and a second scan record, in one result', () => {
    rejectsUnique(
      'INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)',
      'ans-3',
      'res-1',
      1,
      'BLANK',
      null,
      0,
      0
    );
    rejectsUnique('INSERT INTO scan_records VALUES (?, ?, ?, ?)', 'scn-2', 'res-1', null, NOW);
  });

  it('rejects a duplicate primary key', () => {
    rejectsUnique('INSERT INTO subjects VALUES (?, ?, ?, ?)', 'sub-1', 'Science', NOW, NOW);
  });
});

describe('check constraints', () => {
  beforeEach(seed);

  const rejectsCheck = (sql, ...params) =>
    assert.throws(() => t.run(sql, ...params), /CHECK|NOT NULL|cannot store/);

  it('rejects empty ids and blank names', () => {
    rejectsCheck('INSERT INTO subjects VALUES (?, ?, ?, ?)', '', 'Science', NOW, NOW);
    rejectsCheck('INSERT INTO subjects VALUES (?, ?, ?, ?)', 'sub-2', '   ', NOW, NOW);
    rejectsCheck('INSERT INTO subjects VALUES (?, ?, ?, ?)', null, 'Science', NOW, NOW);
    rejectsCheck('INSERT INTO subjects VALUES (?, ?, ?, ?)', 'sub-2', null, NOW, NOW);
  });

  it('rejects timestamps that are not UTC ISO-8601 with milliseconds', () => {
    for (const bad of ['2026-10-02', '2026-10-02 08:30:00', '2026-10-02T08:30:00Z', 'now', '']) {
      rejectsCheck('INSERT INTO subjects VALUES (?, ?, ?, ?)', 'sub-2', 'Science', bad, NOW);
    }
    t.run(
      'INSERT INTO subjects VALUES (?, ?, ?, ?)',
      'sub-2',
      'Science',
      new Date().toISOString(),
      NOW
    );
  });

  it('rejects values of the wrong type', () => {
    rejectsCheck(
      'INSERT INTO exams VALUES (?, ?, ?, ?, ?, ?, ?)',
      'exm-2',
      'sub-1',
      'cls-1',
      'Quiz 2',
      'ten',
      NOW,
      NOW
    );
  });

  it('rejects out-of-range exam and question values', () => {
    rejectsCheck(
      'INSERT INTO exams VALUES (?, ?, ?, ?, ?, ?, ?)',
      'exm-2',
      'sub-1',
      'cls-1',
      'Quiz 2',
      0,
      NOW,
      NOW
    );
    rejectsCheck('INSERT INTO exam_questions VALUES (?, ?, ?, ?, ?)', 'q-3', 'exm-1', 0, 4, 1);
    rejectsCheck('INSERT INTO exam_questions VALUES (?, ?, ?, ?, ?)', 'q-3', 'exm-1', 3, 1, 1);
    rejectsCheck('INSERT INTO exam_questions VALUES (?, ?, ?, ?, ?)', 'q-3', 'exm-1', 3, 5, 1);
    rejectsCheck('INSERT INTO exam_questions VALUES (?, ?, ?, ?, ?)', 'q-3', 'exm-1', 3, 4, 0);
  });

  it('accepts a choice count from 2 to 4 and defaults to 4', () => {
    const insert = 'INSERT INTO exam_questions VALUES (?, ?, ?, ?, ?)';
    t.run(insert, 'q-3', 'exm-1', 3, 2, 1);
    t.run(insert, 'q-4', 'exm-1', 4, 3, 1);
    t.run(insert, 'q-5', 'exm-1', 5, 4, 1);
    t.run('INSERT INTO exam_questions (id, exam_id, question_number) VALUES (?, ?, ?)', 'q-6', 'exm-1', 6);
    assert.equal(t.get("SELECT choice_count FROM exam_questions WHERE id = 'q-6'").choice_count, 4);
  });

  it('accepts each of A, B, C, D as an answer key and as a student answer', () => {
    t.run('DELETE FROM answer_keys');
    t.run('DELETE FROM student_answers');
    ['A', 'B', 'C', 'D'].forEach((letter, index) => {
      const number = index + 10;
      t.run('INSERT INTO exam_questions VALUES (?, ?, ?, ?, ?)', `q-${number}`, 'exm-1', number, 4, 1);
      t.run('INSERT INTO answer_keys VALUES (?, ?, ?)', `key-${number}`, `q-${number}`, letter);
      t.run(
        'INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)',
        `ans-${number}`,
        'res-1',
        number,
        'SELECTED',
        letter,
        1,
        0
      );
    });
    assert.equal(count('answer_keys'), 4);
    assert.equal(count('student_answers'), 4);
  });

  it('rejects an answer key letter outside A to D, including E', () => {
    rejectsCheck('INSERT INTO answer_keys VALUES (?, ?, ?)', 'key-2', 'q-2', 'E');
    rejectsCheck('INSERT INTO answer_keys VALUES (?, ?, ?)', 'key-2', 'q-2', 'F');
    rejectsCheck('INSERT INTO answer_keys VALUES (?, ?, ?)', 'key-2', 'q-2', 'b');
    rejectsCheck('INSERT INTO answer_keys VALUES (?, ?, ?)', 'key-2', 'q-2', '');
  });

  it('rejects E as a student answer', () => {
    rejectsCheck(
      'INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)',
      'ans-3',
      'res-1',
      3,
      'SELECTED',
      'E',
      0,
      0
    );
  });

  it('rejects impossible scores', () => {
    t.run('DELETE FROM exam_results WHERE id = ?', 'res-1');
    const insert = 'INSERT INTO exam_results VALUES (?, ?, ?, ?, ?, ?)';
    rejectsCheck(insert, 'res-2', 'exm-1', 'stu-1', -1, 2, NOW);
    rejectsCheck(insert, 'res-2', 'exm-1', 'stu-1', 3, 2, NOW);
    rejectsCheck(insert, 'res-2', 'exm-1', 'stu-1', 0, -1, NOW);
  });

  it('rejects unknown answer states and inconsistent state and letter pairs', () => {
    const insert = 'INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)';
    rejectsCheck(insert, 'ans-3', 'res-1', 3, 'GUESSED', null, 0, 0);
    rejectsCheck(insert, 'ans-3', 'res-1', 3, 'SELECTED', null, 0, 0);
    rejectsCheck(insert, 'ans-3', 'res-1', 3, 'BLANK', 'A', 0, 0);
    rejectsCheck(insert, 'ans-3', 'res-1', 3, 'MULTIPLE', 'A', 0, 0);
    rejectsCheck(insert, 'ans-3', 'res-1', 3, 'SELECTED', 'Z', 0, 0);
    rejectsCheck(insert, 'ans-3', 'res-1', 3, 'SELECTED', 'A', 2, 0);
    rejectsCheck(insert, 'ans-3', 'res-1', 3, 'SELECTED', 'A', 1, 5);
    for (const [id, number, state] of [
      ['ans-3', 3, 'MULTIPLE'],
      ['ans-4', 4, 'UNCERTAIN'],
    ]) {
      t.run(insert, id, 'res-1', number, state, null, 0, 0);
    }
    assert.equal(count('student_answers'), 4);
  });

  it('allows a scan record without an image but rejects an empty path', () => {
    t.run('DELETE FROM scan_records WHERE id = ?', 'scn-1');
    rejectsCheck('INSERT INTO scan_records VALUES (?, ?, ?, ?)', 'scn-2', 'res-1', '', NOW);
    t.run('INSERT INTO scan_records VALUES (?, ?, ?, ?)', 'scn-2', 'res-1', null, NOW);
    assert.equal(t.get('SELECT image_path FROM scan_records').image_path, null);
  });
});

describe('runInTransaction', () => {
  beforeEach(seed);

  it('commits everything the task wrote and returns its value', async () => {
    const value = await runInTransaction(t.db, async () => {
      await t.db.execAsync("DELETE FROM exam_results WHERE id = 'res-1'");
      await t.db.execAsync("DELETE FROM exams WHERE id = 'exm-1'");
      return 'done';
    });
    assert.equal(value, 'done');
    assert.equal(count('exams'), 0);
    assert.equal(count('student_answers'), 0);
    assert.equal(t.raw.isTransaction, false);
  });

  it('rolls back everything and rethrows the task error when the task fails', async () => {
    const failure = new Error('stop');
    await assert.rejects(
      runInTransaction(t.db, async () => {
        await t.db.execAsync("DELETE FROM exam_results WHERE id = 'res-1'");
        throw failure;
      }),
      (error) => error === failure
    );
    assert.equal(count('exam_results'), 1);
    assert.equal(count('student_answers'), 2);
    assert.equal(count('scan_records'), 1);
    assert.equal(t.raw.isTransaction, false);
  });

  it('enforces foreign keys inside the transaction and rolls back on a violation', async () => {
    await assert.rejects(
      runInTransaction(t.db, async () => {
        await t.db.execAsync(
          `INSERT INTO subjects VALUES ('sub-2', 'Science', '${NOW}', '${NOW}')`
        );
        await t.db.execAsync("DELETE FROM exams WHERE id = 'exm-1'");
      }),
      /FOREIGN KEY/
    );
    assert.equal(count('subjects'), 1);
    assert.equal(count('exams'), 1);
  });

  it('runs concurrent transactions one after another, never interleaved', async () => {
    const order = [];
    const slow = runInTransaction(t.db, async () => {
      order.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('first:end');
    });
    const fast = runInTransaction(t.db, async () => {
      order.push('second:start');
      order.push('second:end');
    });
    await Promise.all([slow, fast]);
    assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('keeps working after a failed transaction', async () => {
    await assert.rejects(
      runInTransaction(t.db, async () => {
        throw new Error('first fails');
      })
    );
    await runInTransaction(t.db, async () => {
      await t.db.execAsync("DELETE FROM scan_records WHERE id = 'scn-1'");
    });
    assert.equal(count('scan_records'), 0);
  });
});
