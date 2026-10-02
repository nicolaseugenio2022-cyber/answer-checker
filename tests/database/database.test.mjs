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
  'answer_key_items',
  'answer_keys',
  'class_subjects',
  'classes',
  'results',
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

/** Inserts one of everything: a subject, class, student, answer key with two items, and a result. */
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
  t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-1', 'sub-1', 'Quiz 1', 2, NOW, NOW);
  t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-1', 1, 'B');
  t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-1', 2, 'D');
  t.run('INSERT INTO results VALUES (?, ?, ?, ?, ?, ?)', 'res-1', 'key-1', 'stu-1', 1, 2, NOW);
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
      'idx_answer_keys_created_at',
      'idx_answer_keys_subject_id_name',
      'idx_class_subjects_subject_id',
      'idx_results_answer_key_id_student_id',
      'idx_results_created_at',
      'idx_results_student_id',
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
      'answer_key_items.answer_key_id -> answer_keys.id CASCADE',
      'answer_keys.subject_id -> subjects.id RESTRICT',
      'class_subjects.class_id -> classes.id CASCADE',
      'class_subjects.subject_id -> subjects.id CASCADE',
      'results.answer_key_id -> answer_keys.id RESTRICT',
      'results.student_id -> students.id RESTRICT',
      'scan_records.result_id -> results.id CASCADE',
      'student_answers.result_id -> results.id CASCADE',
      'students.class_id -> classes.id RESTRICT',
    ]);
  });

  it('uses a non-null TEXT primary key named id on every table except the two keyed by a pair', () => {
    for (const table of EXPECTED_TABLES) {
      // These two are identified by a pair of columns, checked in their own migration tests.
      if (table === 'class_subjects' || table === 'answer_key_items') continue;
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
    assert.equal(count('results'), 1);
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
        t.run('INSERT INTO results VALUES (?, ?, ?, ?, ?, ?)', 'res-x', 'no-such-key', 'stu-1', 0, 1, NOW),
      /FOREIGN KEY/
    );
    assert.throws(
      () => t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-x', 'no-such-subject', 'X', 1, NOW, NOW),
      /FOREIGN KEY/
    );
    assert.throws(
      () => t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'no-such-key', 1, 'A'),
      /FOREIGN KEY/
    );
  });

  it('removes a result together with its answers and scan record', () => {
    t.run('DELETE FROM results WHERE id = ?', 'res-1');
    assert.equal(count('results'), 0);
    assert.equal(count('student_answers'), 0);
    assert.equal(count('scan_records'), 0);
    // Nothing outside the result aggregate is touched.
    assert.equal(count('answer_keys'), 1);
    assert.equal(count('students'), 1);
    assert.equal(count('answer_key_items'), 2);
  });

  it('removes an answer key that has no results together with its items and nothing else', () => {
    t.run('DELETE FROM results WHERE id = ?', 'res-1');
    t.run('DELETE FROM answer_keys WHERE id = ?', 'key-1');
    assert.equal(count('answer_keys'), 0);
    assert.equal(count('answer_key_items'), 0);
    assert.equal(count('subjects'), 1);
    assert.equal(count('classes'), 1);
    assert.equal(count('students'), 1);
  });

  it('refuses to delete an answer key that still has results', () => {
    assert.throws(() => t.run('DELETE FROM answer_keys WHERE id = ?', 'key-1'), /FOREIGN KEY/);
    assert.equal(count('answer_keys'), 1);
    assert.equal(count('answer_key_items'), 2);
    assert.equal(count('results'), 1);
  });

  it('refuses to delete a student who still has results', () => {
    assert.throws(() => t.run('DELETE FROM students WHERE id = ?', 'stu-1'), /FOREIGN KEY/);
    assert.equal(count('students'), 1);
    assert.equal(count('results'), 1);
  });

  it('refuses to delete a class that still has students', () => {
    assert.throws(() => t.run('DELETE FROM classes WHERE id = ?', 'cls-1'), /FOREIGN KEY/);
    assert.equal(count('classes'), 1);
    assert.equal(count('students'), 1);
  });

  it('refuses to delete a subject that still has answer keys', () => {
    assert.throws(() => t.run('DELETE FROM subjects WHERE id = ?', 'sub-1'), /FOREIGN KEY/);
    assert.equal(count('subjects'), 1);
    assert.equal(count('answer_keys'), 1);
  });

  it('allows deleting parents once their dependents are gone', () => {
    t.run('DELETE FROM results WHERE id = ?', 'res-1');
    t.run('DELETE FROM answer_keys WHERE id = ?', 'key-1');
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

  it('rejects a duplicate answer key name in one subject, ignoring case, but allows it in another', () => {
    const insert = 'INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)';
    rejectsUnique(insert, 'key-2', 'sub-1', 'QUIZ 1', 5, NOW, NOW);
    t.run('INSERT INTO subjects VALUES (?, ?, ?, ?)', 'sub-2', 'Science', NOW, NOW);
    t.run(insert, 'key-2', 'sub-2', 'Quiz 1', 5, NOW, NOW);
    assert.equal(count('answer_keys'), 2);
  });

  it('rejects a second answer for the same question of an answer key', () => {
    rejectsUnique('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-1', 1, 'C');
  });

  it('rejects a second result for the same student and answer key', () => {
    rejectsUnique('INSERT INTO results VALUES (?, ?, ?, ?, ?, ?)', 'res-2', 'key-1', 'stu-1', 0, 2, NOW);
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
    rejectsCheck('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-2', 'sub-1', '  ', 5, NOW, NOW);
  });

  it('rejects timestamps that are not UTC ISO-8601 with milliseconds', () => {
    for (const bad of ['2026-10-02', '2026-10-02 08:30:00', '2026-10-02T08:30:00Z', 'now', '']) {
      rejectsCheck('INSERT INTO subjects VALUES (?, ?, ?, ?)', 'sub-2', 'Science', bad, NOW);
      rejectsCheck('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-2', 'sub-1', 'Quiz 2', 5, bad, NOW);
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
    rejectsCheck('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-2', 'sub-1', 'Quiz 2', 'ten', NOW, NOW);
    rejectsCheck('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-1', 'three', 'A');
  });

  it('accepts a question count from 1 to 40 and rejects 0 and 41', () => {
    const insert = 'INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)';
    t.run(insert, 'key-2', 'sub-1', 'One', 1, NOW, NOW);
    t.run(insert, 'key-3', 'sub-1', 'Forty', 40, NOW, NOW);
    rejectsCheck(insert, 'key-4', 'sub-1', 'Zero', 0, NOW, NOW);
    rejectsCheck(insert, 'key-4', 'sub-1', 'Forty-one', 41, NOW, NOW);
  });

  it('accepts a question number from 1 to 40 and rejects 0 and 41', () => {
    const insert = 'INSERT INTO answer_key_items VALUES (?, ?, ?)';
    t.run(insert, 'key-1', 40, 'A');
    rejectsCheck(insert, 'key-1', 0, 'A');
    rejectsCheck(insert, 'key-1', 41, 'A');
  });

  it('accepts each of A, B, C, D as a correct answer and as a student answer', () => {
    t.run('DELETE FROM answer_key_items');
    t.run('DELETE FROM student_answers');
    ['A', 'B', 'C', 'D'].forEach((letter, index) => {
      const number = index + 10;
      t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-1', number, letter);
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
    assert.equal(count('answer_key_items'), 4);
    assert.equal(count('student_answers'), 4);
  });

  it('rejects a correct answer outside A to D, including E', () => {
    for (const bad of ['E', 'F', 'b', '', 'AB']) {
      rejectsCheck('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-1', 3, bad);
    }
    rejectsCheck('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-1', 3, null);
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
    t.run('DELETE FROM results WHERE id = ?', 'res-1');
    const insert = 'INSERT INTO results VALUES (?, ?, ?, ?, ?, ?)';
    rejectsCheck(insert, 'res-2', 'key-1', 'stu-1', -1, 2, NOW);
    rejectsCheck(insert, 'res-2', 'key-1', 'stu-1', 3, 2, NOW);
    rejectsCheck(insert, 'res-2', 'key-1', 'stu-1', 0, -1, NOW);
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
    rejectsCheck(insert, 'ans-3', 'res-1', 41, 'BLANK', null, 0, 0);
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
      await t.db.execAsync("DELETE FROM results WHERE id = 'res-1'");
      await t.db.execAsync("DELETE FROM answer_keys WHERE id = 'key-1'");
      return 'done';
    });
    assert.equal(value, 'done');
    assert.equal(count('answer_keys'), 0);
    assert.equal(count('student_answers'), 0);
    assert.equal(t.raw.isTransaction, false);
  });

  it('rolls back everything and rethrows the task error when the task fails', async () => {
    const failure = new Error('stop');
    await assert.rejects(
      runInTransaction(t.db, async () => {
        await t.db.execAsync("DELETE FROM results WHERE id = 'res-1'");
        throw failure;
      }),
      (error) => error === failure
    );
    assert.equal(count('results'), 1);
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
        await t.db.execAsync("DELETE FROM answer_keys WHERE id = 'key-1'");
      }),
      /FOREIGN KEY/
    );
    assert.equal(count('subjects'), 1);
    assert.equal(count('answer_keys'), 1);
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
