// Verifies migration 4 (answer keys replace exams), the Answer Key rules, its
// SQLite repository and use cases, and the Keys navigation wiring.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { DuplicateNameError, RecordNotFoundError } from '../../src/core/application/errors.ts';
import {
  DatabaseError,
  MigrationFailedError,
} from '../../src/core/infrastructure/database/database-error.ts';
import { initializeDatabase } from '../../src/core/infrastructure/database/initialize-database.ts';
import { MIGRATIONS } from '../../src/core/infrastructure/database/migrations.ts';
import {
  AnswerKeyInUseError,
  AnswerKeyLockedError,
  InvalidAnswerKeyError,
} from '../../src/features/answer-keys/application/answer-key-repository.ts';
import { createAnswerKeyUseCases } from '../../src/features/answer-keys/application/answer-key-use-cases.ts';
import {
  ANSWER_KEY_MAX_QUESTIONS,
  ANSWER_KEY_NAME_MAX_LENGTH,
  assembleAnswers,
  proposeCopyName,
  validateAnswerKeyInput,
} from '../../src/features/answer-keys/domain/answer-key.ts';
import { createSqliteAnswerKeyRepository } from '../../src/features/answer-keys/infrastructure/sqlite-answer-key-repository.ts';
import {
  SubjectInUseError,
  SubjectNotFoundError,
} from '../../src/features/subjects/application/subject-repository.ts';
import { createSubjectUseCases } from '../../src/features/subjects/application/subject-use-cases.ts';
import { createSqliteSubjectRepository } from '../../src/features/subjects/infrastructure/sqlite-subject-repository.ts';
import { openTestDatabase } from './test-database.mjs';

const T0 = '2026-10-02T08:30:00.000Z';
const T1 = '2026-10-02T08:30:01.000Z';
const LATEST = MIGRATIONS.length;

let t;

afterEach(() => {
  t.close();
});

const userVersion = () => t.get('PRAGMA user_version').user_version;
const count = (table) => t.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
const tables = () =>
  t
    .all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((row) => row.name);
const schemaSnapshot = () =>
  JSON.stringify(t.all('SELECT type, name, sql FROM sqlite_master ORDER BY type, name'));
const plain = (rows) => rows.map((row) => ({ ...row }));

/** Use cases with ids id-1, id-2, ... and a clock that advances one second per reading. */
function build(db = t.db) {
  let ids = 0;
  let ticks = 0;
  return createAnswerKeyUseCases({
    repository: createSqliteAnswerKeyRepository(db),
    idGenerator: { newId: () => `id-${++ids}` },
    clock: { now: () => new Date(Date.parse(T0) + 1000 * ticks++).toISOString() },
  });
}

const subjectUseCases = () =>
  createSubjectUseCases({
    repository: createSqliteSubjectRepository(t.db),
    idGenerator: { newId: () => 'new-subject' },
    clock: { now: () => T0 },
  });

/** A connection whose matching write is carried out and then reported as failed. */
function failingAfterWrite(db, pattern) {
  return {
    ...db,
    runAsync: async (sql, params = []) => {
      const result = await db.runAsync(sql, params);
      if (pattern.test(sql.trim())) throw new Error('disk I/O error');
      return result;
    },
  };
}

function insertSubject(id, name) {
  t.run('INSERT INTO subjects VALUES (?, ?, ?, ?)', id, name, T0, T0);
}

/** One saved result scored with the answer key, for a student created on the spot. */
function insertResult(answerKeyId, resultId = `res-${answerKeyId}`) {
  t.run('INSERT OR IGNORE INTO classes VALUES (?, ?, ?, ?)', 'cls-1', 'BSIT 1A', T0, T0);
  t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', `stu-${resultId}`, 'cls-1', resultId, 'Student', T0, T0);
  t.run(
    "INSERT INTO results (id, answer_key_id, student_id, class_id, score, total, template_id, captured_at, created_at) VALUES (?1, ?2, ?3, (SELECT class_id FROM students WHERE id = ?3), ?4, ?5, 'AC-40-V1', ?6, ?6)",
    resultId,
    answerKeyId,
    `stu-${resultId}`,
    1,
    2,
    T0
  );
}

const input = (changes = {}) => ({
  name: 'Midterm',
  subjectId: 'sub-1',
  questionCount: 4,
  answers: ['A', 'B', 'C', 'D'],
  ...changes,
});

async function openMigrated() {
  t = openTestDatabase();
  await initializeDatabase(t.db);
  insertSubject('sub-1', 'Mathematics');
  insertSubject('sub-2', 'biology');
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/** Legacy rows as a database at schema versions 1 to 3 could hold them. */
function seedLegacy() {
  insertSubject('sub-1', 'Mathematics');
  insertSubject('sub-2', 'Science');
  t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', 'cls-1', 'BSIT 1A', T0, T0);
  t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', 'cls-2', 'BSIT 1B', T0, T0);
  t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', 'stu-1', 'cls-1', '2026-001', 'Maria Santos', T0, T0);

  const exam = (id, subjectId, classId, title, questionCount) =>
    t.run('INSERT INTO exams VALUES (?, ?, ?, ?, ?, ?, ?)', id, subjectId, classId, title, questionCount, T0, T1);
  // Inserted out of order on purpose: the conversion must not depend on row order.
  const question = (examId, number, answer) => {
    t.run('INSERT INTO exam_questions VALUES (?, ?, ?, ?, ?)', `q-${examId}-${number}`, examId, number, 4, 1);
    t.run('INSERT INTO answer_keys VALUES (?, ?, ?)', `k-${examId}-${number}`, `q-${examId}-${number}`, answer);
  };

  exam('exm-1', 'sub-1', 'cls-1', 'Midterm', 3);
  question('exm-1', 3, 'A');
  question('exm-1', 1, 'B');
  question('exm-1', 2, 'D');

  // The same title in the same subject for another class: allowed before, a clash now.
  exam('exm-2', 'sub-1', 'cls-2', 'midterm', 1);
  question('exm-2', 1, 'C');

  // The same title under another subject is no clash.
  exam('exm-3', 'sub-2', 'cls-1', '  Midterm ', 2);
  question('exm-3', 1, 'A');
  question('exm-3', 2, 'A');

  t.run('INSERT INTO exam_results VALUES (?, ?, ?, ?, ?, ?)', 'res-1', 'exm-1', 'stu-1', 2, 3, T1);
  t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)', 'ans-1', 'res-1', 1, 'SELECTED', 'B', 1, 0);
  t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)', 'ans-2', 'res-1', 2, 'BLANK', null, 0, 1);
  t.run('INSERT INTO scan_records VALUES (?, ?, ?, ?)', 'scn-1', 'res-1', 'scans/res-1.jpg', T1);
}

function assertConverted() {
  // The migration ran on a second connection and replaced tables this one had
  // already read. Stepping any query makes SQLite reload the schema here; without
  // it, Node's SQLite sizes the next result by the old table's column count.
  t.all('SELECT name FROM sqlite_master LIMIT 1');
  assert.equal(userVersion(), LATEST);

  assert.deepEqual(plain(t.all('SELECT * FROM answer_keys ORDER BY id')), [
    { id: 'exm-1', subject_id: 'sub-1', name: 'Midterm (BSIT 1A)', question_count: 3, created_at: T0, updated_at: T1 },
    { id: 'exm-2', subject_id: 'sub-1', name: 'midterm (BSIT 1B)', question_count: 1, created_at: T0, updated_at: T1 },
    { id: 'exm-3', subject_id: 'sub-2', name: 'Midterm', question_count: 2, created_at: T0, updated_at: T1 },
  ]);
  assert.deepEqual(
    plain(t.all('SELECT * FROM answer_key_items ORDER BY answer_key_id, question_number')),
    [
      { answer_key_id: 'exm-1', question_number: 1, correct_answer: 'B' },
      { answer_key_id: 'exm-1', question_number: 2, correct_answer: 'D' },
      { answer_key_id: 'exm-1', question_number: 3, correct_answer: 'A' },
      { answer_key_id: 'exm-2', question_number: 1, correct_answer: 'C' },
      { answer_key_id: 'exm-3', question_number: 1, correct_answer: 'A' },
      { answer_key_id: 'exm-3', question_number: 2, correct_answer: 'A' },
    ]
  );
  // Results keep their ids and now point at the answer key.
  // ...and, since migration 6, carry the class of the scan and a template id.
  assert.deepEqual(plain(t.all('SELECT * FROM results')), [
    {
      id: 'res-1',
      answer_key_id: 'exm-1',
      student_id: 'stu-1',
      class_id: 'cls-1',
      score: 2,
      total: 3,
      template_id: 'UNKNOWN',
      captured_at: T1,
      created_at: T1,
    },
  ]);
  assert.deepEqual(plain(t.all('SELECT * FROM student_answers ORDER BY id')), [
    { id: 'ans-1', result_id: 'res-1', question_number: 1, detected_state: 'MARKED', detected_answer: 'B', final_answer: 'B', correct_answer: 'B', is_correct: 1, manually_corrected: 0, confidence: null },
    { id: 'ans-2', result_id: 'res-1', question_number: 2, detected_state: 'BLANK', detected_answer: null, final_answer: null, correct_answer: 'D', is_correct: 0, manually_corrected: 1, confidence: null },
  ]);
  assert.deepEqual(plain(t.all('SELECT * FROM scan_records')), [
    { id: 'scn-1', result_id: 'res-1', image_path: 'scans/res-1.jpg', scanned_at: T1 },
  ]);
  // Everything else is untouched.
  assert.equal(count('subjects'), 2);
  assert.equal(count('classes'), 2);
  assert.equal(count('students'), 1);
}

function assertSchemaIsClean() {
  assert.deepEqual(tables(), [
    'answer_key_items',
    'answer_keys',
    'class_subjects',
    'classes',
    'results',
    'scan_records',
    'student_answers',
    'students',
    'subjects',
  ]);
  // No exam table, index, or temporary migration table is left, in any schema.
  const names = t
    .all('SELECT name, sql FROM sqlite_master UNION ALL SELECT name, sql FROM sqlite_temp_master')
    .map((row) => `${row.name} ${row.sql ?? ''}`)
    .join('\n');
  assert.doesNotMatch(names, /exam|new_|migration_/i);

  // An answer key belongs to a subject only: it has no class column.
  assert.deepEqual(
    t.all("SELECT name FROM pragma_table_info('answer_keys')").map((column) => column.name),
    ['id', 'subject_id', 'name', 'question_count', 'created_at', 'updated_at']
  );
  assert.deepEqual(
    plain(t.all("SELECT name, pk FROM pragma_table_info('answer_key_items')")),
    [
      { name: 'answer_key_id', pk: 1 },
      { name: 'question_number', pk: 2 },
      { name: 'correct_answer', pk: 0 },
    ]
  );
  for (const table of ['answer_keys', 'answer_key_items', 'results', 'student_answers', 'scan_records']) {
    assert.equal(t.get('SELECT strict FROM pragma_table_list WHERE name = ?', table).strict, 1, table);
  }

  // Every foreign key points at a table that exists.
  const existing = new Set(tables());
  for (const table of existing) {
    for (const foreignKey of t.all(`SELECT * FROM pragma_foreign_key_list('${table}')`)) {
      assert.ok(existing.has(foreignKey.table), `${table} references missing ${foreignKey.table}`);
    }
  }
  assert.deepEqual(t.all('PRAGMA foreign_key_check'), []);
  assert.deepEqual(plain(t.all('PRAGMA integrity_check')), [{ integrity_check: 'ok' }]);
}

describe('migration 4: answer keys replace exams', () => {
  it('gives a fresh database the answer key schema', async () => {
    t = openTestDatabase();
    assert.equal(await initializeDatabase(t.db), LATEST);
    assert.ok(LATEST >= 4);
    assertSchemaIsClean();
    for (const table of tables()) assert.equal(count(table), 0, table);
  });

  for (const from of [1, 2, 3]) {
    it(`upgrades a version-${from} database and converts its exams, answers, and results`, async () => {
      t = openTestDatabase();
      assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, from)), from);
      seedLegacy();

      assert.equal(await initializeDatabase(t.db), LATEST);

      assertConverted();
      assertSchemaIsClean();
      // The converted key is complete and usable straight away.
      const converted = await build().getAnswerKey('exm-1');
      assert.deepEqual(converted.answers, ['B', 'D', 'A']);
      assert.equal(converted.subjectName, 'Mathematics');
      assert.equal(converted.resultCount, 1);
    });
  }

  it('enforces the new rules on a converted database', async () => {
    t = openTestDatabase();
    await initializeDatabase(t.db, MIGRATIONS.slice(0, 3));
    seedLegacy();
    await initializeDatabase(t.db);

    assert.throws(() => t.run('DELETE FROM subjects WHERE id = ?', 'sub-1'), /FOREIGN KEY/);
    assert.throws(() => t.run('DELETE FROM answer_keys WHERE id = ?', 'exm-1'), /FOREIGN KEY/);
    assert.throws(() => t.run('DELETE FROM students WHERE id = ?', 'stu-1'), /FOREIGN KEY/);
    // A class is no longer held by an answer key.
    t.run('DELETE FROM classes WHERE id = ?', 'cls-2');
    // Deleting a result takes its answers and scan record; deleting a key takes its items.
    t.run('DELETE FROM results WHERE id = ?', 'res-1');
    assert.equal(count('student_answers') + count('scan_records'), 0);
    t.run('DELETE FROM answer_keys WHERE id = ?', 'exm-1');
    assert.equal(t.get('SELECT COUNT(*) AS n FROM answer_key_items WHERE answer_key_id = ?', 'exm-1').n, 0);
    assert.equal(count('answer_key_items'), 3);
  });

  it('does nothing when run again', async () => {
    t = openTestDatabase();
    await initializeDatabase(t.db, MIGRATIONS.slice(0, 3));
    seedLegacy();
    await initializeDatabase(t.db);
    const before = schemaSnapshot();

    assert.equal(await initializeDatabase(t.db), LATEST);

    assert.equal(schemaSnapshot(), before);
    assertConverted();
  });

  describe('legacy data that cannot be converted exactly', () => {
    const exam = (id, questionCount, title = id, classId = 'cls-1') =>
      t.run('INSERT INTO exams VALUES (?, ?, ?, ?, ?, ?, ?)', id, 'sub-1', classId, title, questionCount, T0, T0);
    const question = (examId, number, answer, points = 1) => {
      t.run('INSERT INTO exam_questions VALUES (?, ?, ?, ?, ?)', `q-${examId}-${number}`, examId, number, 4, points);
      if (answer) {
        t.run('INSERT INTO answer_keys VALUES (?, ?, ?)', `k-${examId}-${number}`, `q-${examId}-${number}`, answer);
      }
    };

    const CASES = {
      'a question without a correct answer': () => {
        exam('exm-1', 2);
        question('exm-1', 1, 'A');
        question('exm-1', 2, null);
      },
      'fewer questions than the question count': () => {
        exam('exm-1', 3);
        question('exm-1', 1, 'A');
        question('exm-1', 2, 'B');
      },
      'question numbers with a gap': () => {
        exam('exm-1', 2);
        question('exm-1', 1, 'A');
        question('exm-1', 3, 'B');
      },
      'an exam with no questions at all': () => {
        exam('exm-1', 5);
      },
      'more than 40 questions': () => {
        exam('exm-1', 41);
        for (let number = 1; number <= 41; number++) question('exm-1', number, 'A');
      },
      'a question worth more than one point': () => {
        exam('exm-1', 1);
        question('exm-1', 1, 'A', 2);
      },
      'two exams of one subject and class with the same title': () => {
        exam('exm-1', 1, 'Quiz');
        question('exm-1', 1, 'A');
        exam('exm-2', 1, 'quiz');
        question('exm-2', 1, 'B');
      },
    };

    for (const [name, seedBad] of Object.entries(CASES)) {
      it(`rolls back and keeps everything for ${name}`, async () => {
        t = openTestDatabase();
        await initializeDatabase(t.db, MIGRATIONS.slice(0, 3));
        insertSubject('sub-1', 'Mathematics');
        t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', 'cls-1', 'BSIT 1A', T0, T0);
        seedBad();
        const before = {
          schema: schemaSnapshot(),
          exams: t.all('SELECT * FROM exams ORDER BY id'),
          questions: t.all('SELECT * FROM exam_questions ORDER BY id'),
          keys: t.all('SELECT * FROM answer_keys ORDER BY id'),
        };

        await assert.rejects(initializeDatabase(t.db), (error) => {
          assert.ok(error instanceof MigrationFailedError);
          assert.equal(error.version, 4);
          return true;
        });

        // Nothing was converted, dropped, or invented.
        assert.equal(userVersion(), 3);
        assert.equal(schemaSnapshot(), before.schema);
        assert.deepEqual(t.all('SELECT * FROM exams ORDER BY id'), before.exams);
        assert.deepEqual(t.all('SELECT * FROM exam_questions ORDER BY id'), before.questions);
        assert.deepEqual(t.all('SELECT * FROM answer_keys ORDER BY id'), before.keys);
        assert.equal(t.get("SELECT COUNT(*) AS n FROM sqlite_temp_master WHERE name LIKE 'migration_%'").n, 0);
      });
    }
  });
});

describe('migration 5: no upper limit on the number of questions', () => {
  /** A version-4 database with two keys, their items, and a result with answers and a scan record. */
  async function openVersion4() {
    t = openTestDatabase();
    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 4)), 4);
    insertSubject('sub-1', 'Mathematics');
    t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', 'cls-1', 'BSIT 1A', T0, T0);
    t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', 'stu-1', 'cls-1', '2026-001', 'Maria Santos', T0, T0);
    t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-1', 'sub-1', 'Midterm', 3, T0, T1);
    t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-2', 'sub-1', 'Finals', 40, T0, T0);
    for (const [number, answer] of [[2, 'D'], [1, 'B'], [3, 'A']]) {
      t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-1', number, answer);
    }
    for (let number = 1; number <= 40; number++) {
      t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-2', number, 'C');
    }
    t.run('INSERT INTO results VALUES (?, ?, ?, ?, ?, ?)', 'res-1', 'key-1', 'stu-1', 2, 3, T1);
    t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)', 'ans-1', 'res-1', 1, 'SELECTED', 'B', 1, 0);
    t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)', 'ans-2', 'res-1', 2, 'BLANK', null, 0, 1);
    t.run('INSERT INTO scan_records VALUES (?, ?, ?, ?)', 'scn-1', 'res-1', 'scans/res-1.jpg', T1);
  }

  const TABLES = ['answer_keys', 'answer_key_items', 'results', 'student_answers', 'scan_records', 'subjects', 'classes', 'students'];
  const dump = () => Object.fromEntries(TABLES.map((table) => [table, plain(t.all(`SELECT * FROM ${table} ORDER BY 1, 2`))]));

  it('the version-4 schema still refuses 41 questions, which is what this migration lifts', async () => {
    await openVersion4();
    assert.throws(
      () => t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-3', 'sub-1', 'Long', 41, T0, T0),
      /CHECK constraint failed/
    );
  });

  it('upgrades a version-4 database and keeps every row exactly', async () => {
    await openVersion4();
    const before = dump();

    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 5)), 5);
    t.all('SELECT name FROM sqlite_master LIMIT 1');

    assert.ok(LATEST >= 5);
    assert.equal(userVersion(), 5);
    assert.deepEqual(dump(), before);
    assertSchemaIsClean();
    const key = await build().getAnswerKey('key-1');
    assert.deepEqual(key.answers, ['B', 'D', 'A']);
    assert.equal(key.resultCount, 1);
  });

  it('allows more than 40 questions afterwards, in every table that had the limit', async () => {
    await openVersion4();
    await initializeDatabase(t.db, MIGRATIONS.slice(0, 5));
    t.all('SELECT name FROM sqlite_master LIMIT 1');

    t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-3', 'sub-1', 'Long', 120, T0, T0);
    t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-3', 120, 'A');
    t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)', 'ans-3', 'res-1', 120, 'BLANK', null, 0, 0);
    for (const bad of [0, -1]) {
      assert.throws(
        () => t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-4', 'sub-1', 'Bad', bad, T0, T0),
        /CHECK constraint failed/
      );
      assert.throws(() => t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-3', bad, 'A'), /CHECK constraint failed/);
    }
  });

  it('keeps the indexes, the delete rules, and the name rule of the rebuilt tables', async () => {
    await openVersion4();
    await initializeDatabase(t.db, MIGRATIONS.slice(0, 5));
    t.all('SELECT name FROM sqlite_master LIMIT 1');

    const indexes = t
      .all("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_answer_keys%' ORDER BY name")
      .map((row) => row.name);
    assert.deepEqual(indexes, ['idx_answer_keys_created_at', 'idx_answer_keys_subject_id_name']);
    assert.throws(
      () => t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-3', 'sub-1', 'MIDTERM', 5, T0, T0),
      /UNIQUE constraint failed/
    );
    // A key with results and a subject with keys are still protected.
    assert.throws(() => t.run('DELETE FROM answer_keys WHERE id = ?', 'key-1'), /FOREIGN KEY/);
    assert.throws(() => t.run('DELETE FROM subjects WHERE id = ?', 'sub-1'), /FOREIGN KEY/);
    // Deleting a result takes its answers; deleting an unused key takes its items.
    t.run('DELETE FROM answer_keys WHERE id = ?', 'key-2');
    assert.equal(count('answer_key_items'), 3);
    t.run('DELETE FROM results WHERE id = ?', 'res-1');
    assert.equal(count('student_answers'), 0);
  });

  it('upgrades from versions 1, 2, and 3 through the conversion, and does nothing when run again', async () => {
    for (const from of [1, 2, 3]) {
      t = openTestDatabase();
      await initializeDatabase(t.db, MIGRATIONS.slice(0, from));
      seedLegacy();
      assert.equal(await initializeDatabase(t.db), LATEST);
      assertConverted();
      assertSchemaIsClean();
      const before = schemaSnapshot();
      assert.equal(await initializeDatabase(t.db), LATEST);
      assert.equal(schemaSnapshot(), before);
      if (from !== 3) t.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Domain rules
// ---------------------------------------------------------------------------

describe('answer key rules', () => {
  beforeEach(() => {
    t = openTestDatabase();
  });

  const problemsOf = (changes) => {
    const result = validateAnswerKeyInput(input(changes));
    assert.equal(result.ok, false);
    return result.problems;
  };

  it('accepts a complete key and returns it in stored form', () => {
    assert.deepEqual(validateAnswerKeyInput(input({ name: '  Midterm \n', subjectId: ' sub-1 ' })), {
      ok: true,
      value: { name: 'Midterm', subjectId: 'sub-1', questionCount: 4, answers: ['A', 'B', 'C', 'D'] },
    });
  });

  it('accepts 1 question, more than 40, and the ceiling, and rejects 0, one more, and a fraction', () => {
    const MAX = ANSWER_KEY_MAX_QUESTIONS;
    assert.ok(MAX > 40);
    for (const questionCount of [1, 41, 75, MAX]) {
      assert.equal(
        validateAnswerKeyInput(input({ questionCount, answers: Array(questionCount).fill('D') })).ok,
        true,
        `${questionCount} questions`
      );
    }
    for (const [questionCount, answers] of [
      [0, []],
      [ANSWER_KEY_MAX_QUESTIONS + 1, Array(ANSWER_KEY_MAX_QUESTIONS + 1).fill('A')],
      [-3, []],
      [2.5, ['A', 'B']],
      [Number.NaN, []],
    ]) {
      assert.deepEqual(problemsOf({ questionCount, answers }), [
        { field: 'questionCount', problem: 'OUT_OF_RANGE', min: 1, max: ANSWER_KEY_MAX_QUESTIONS },
      ]);
    }
  });

  it('rejects choices other than A, B, C, D and names the questions', () => {
    assert.deepEqual(problemsOf({ answers: ['A', 'E', 'b', 'AB'] }), [
      { field: 'answers', problem: 'INVALID_CHOICE', questionNumbers: [2, 3, 4] },
    ]);
  });

  it('rejects missing answers and names the questions', () => {
    assert.deepEqual(problemsOf({ answers: ['A', null, 'C', undefined] }), [
      { field: 'answers', problem: 'MISSING', questionNumbers: [2, 4] },
    ]);
    assert.deepEqual(problemsOf({ answers: ['', 'B', 'x', 'D'] }), [
      { field: 'answers', problem: 'MISSING', questionNumbers: [1] },
      { field: 'answers', problem: 'INVALID_CHOICE', questionNumbers: [3] },
    ]);
  });

  it('rejects more or fewer answers than questions', () => {
    assert.deepEqual(problemsOf({ answers: ['A', 'B', 'C'] }), [
      { field: 'answers', problem: 'WRONG_COUNT', expected: 4, actual: 3 },
    ]);
    assert.deepEqual(problemsOf({ answers: ['A', 'B', 'C', 'D', 'A'] }), [
      { field: 'answers', problem: 'WRONG_COUNT', expected: 4, actual: 5 },
    ]);
  });

  it('requires a name and a subject, and reports every problem at once', () => {
    assert.deepEqual(problemsOf({ name: '  ', subjectId: '', answers: ['A', null, 'C', 'D'] }), [
      { field: 'name', problem: 'EMPTY' },
      { field: 'subjectId', problem: 'EMPTY' },
      { field: 'answers', problem: 'MISSING', questionNumbers: [2] },
    ]);
  });

  it('limits the name by characters, not UTF-16 units', () => {
    const longest = '😀'.repeat(ANSWER_KEY_NAME_MAX_LENGTH);
    assert.ok(longest.length > ANSWER_KEY_NAME_MAX_LENGTH);
    assert.equal(validateAnswerKeyInput(input({ name: longest })).ok, true);
    assert.deepEqual(problemsOf({ name: `${longest}😀` }), [
      { field: 'name', problem: 'TOO_LONG', maxLength: ANSWER_KEY_NAME_MAX_LENGTH },
    ]);
  });

  it('assembles stored items into ordered answers, whatever their order', () => {
    const items = [
      { questionNumber: 3, correctAnswer: 'C' },
      { questionNumber: 1, correctAnswer: 'A' },
      { questionNumber: 2, correctAnswer: 'B' },
    ];
    assert.deepEqual(assembleAnswers(3, items), { ok: true, answers: ['A', 'B', 'C'] });
  });

  it('rejects stored items with a duplicate question, a gap, a wrong count, or a bad letter', () => {
    const item = (questionNumber, correctAnswer = 'A') => ({ questionNumber, correctAnswer });
    assert.deepEqual(assembleAnswers(2, [item(1), item(1)]), { ok: false, problem: 'DUPLICATE_QUESTION' });
    assert.deepEqual(assembleAnswers(2, [item(1), item(3)]), { ok: false, problem: 'NOT_CONTINUOUS' });
    assert.deepEqual(assembleAnswers(2, [item(0), item(1)]), { ok: false, problem: 'NOT_CONTINUOUS' });
    assert.deepEqual(assembleAnswers(3, [item(1), item(2)]), { ok: false, problem: 'WRONG_COUNT' });
    assert.deepEqual(assembleAnswers(1, [item(1), item(2)]), { ok: false, problem: 'WRONG_COUNT' });
    assert.deepEqual(assembleAnswers(1, [item(1, 'E')]), { ok: false, problem: 'INVALID_CHOICE' });
  });

  it('proposes a copy name that is not taken and stays within the limit', () => {
    assert.equal(proposeCopyName('Midterm', ['Midterm']), 'Midterm – Copy');
    assert.equal(proposeCopyName('Midterm', ['Midterm', 'midterm – copy']), 'Midterm – Copy 2');
    assert.equal(
      proposeCopyName('Midterm', ['Midterm', 'Midterm – Copy', 'MIDTERM – COPY 2']),
      'Midterm – Copy 3'
    );
    const long = 'x'.repeat(ANSWER_KEY_NAME_MAX_LENGTH);
    const proposed = proposeCopyName(long, [long]);
    assert.equal(Array.from(proposed).length, ANSWER_KEY_NAME_MAX_LENGTH);
    assert.ok(proposed.endsWith(' – Copy'));
  });
});

// ---------------------------------------------------------------------------
// Use cases and repository
// ---------------------------------------------------------------------------

describe('answer keys: create and read', () => {
  beforeEach(openMigrated);

  it('creates a key with the injected id and timestamp and stores header and items', async () => {
    const created = await build().createAnswerKey(input({ name: '  Midterm ' }));

    assert.deepEqual(created, {
      id: 'id-1',
      subjectId: 'sub-1',
      name: 'Midterm',
      questionCount: 4,
      answers: ['A', 'B', 'C', 'D'],
      createdAt: T0,
      updatedAt: T0,
    });
    assert.deepEqual(plain(t.all('SELECT * FROM answer_keys')), [
      { id: 'id-1', subject_id: 'sub-1', name: 'Midterm', question_count: 4, created_at: T0, updated_at: T0 },
    ]);
    assert.deepEqual(
      plain(t.all('SELECT * FROM answer_key_items ORDER BY question_number')),
      ['A', 'B', 'C', 'D'].map((correct_answer, index) => ({
        answer_key_id: 'id-1',
        question_number: index + 1,
        correct_answer,
      }))
    );
  });

  it('reads a key whole, with its answers in question order, its subject, and its use', async () => {
    const keys = build();
    const created = await keys.createAnswerKey(input({ questionCount: 40, answers: Array.from({ length: 40 }, (_, i) => 'ABCD'[i % 4]) }));
    // Rewrite the items in reverse so storage order differs from question order.
    const items = t.all('SELECT * FROM answer_key_items ORDER BY question_number DESC');
    t.run('DELETE FROM answer_key_items');
    for (const item of items) {
      t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', item.answer_key_id, item.question_number, item.correct_answer);
    }

    const read = await keys.getAnswerKey(created.id);

    assert.deepEqual(read, { ...created, subjectName: 'Mathematics', resultCount: 0 });
    assert.equal(read.answers.length, 40);
    assert.equal(read.answers[39], 'D');
    assert.equal(await keys.getAnswerKey('missing'), null);
  });

  it('stores keys of 1 question, more than 40, and the ceiling, complete and in order', async () => {
    const keys = build();
    const pattern = (length) => Array.from({ length }, (_, index) => 'ABCD'[index % 4]);
    await keys.createAnswerKey(input({ name: 'One', questionCount: 1, answers: ['C'] }));
    const sixty = await keys.createAnswerKey(input({ name: 'Sixty', questionCount: 60, answers: pattern(60) }));
    const largest = await keys.createAnswerKey(
      input({ name: 'Largest', questionCount: ANSWER_KEY_MAX_QUESTIONS, answers: pattern(ANSWER_KEY_MAX_QUESTIONS) })
    );

    assert.equal(count('answer_keys'), 3);
    assert.equal(count('answer_key_items'), 1 + 60 + ANSWER_KEY_MAX_QUESTIONS);
    assert.deepEqual((await keys.getAnswerKey(sixty.id)).answers, pattern(60));
    assert.deepEqual((await keys.getAnswerKey(largest.id)).answers, pattern(ANSWER_KEY_MAX_QUESTIONS));
    assert.equal(t.get('SELECT MAX(question_number) AS n FROM answer_key_items').n, ANSWER_KEY_MAX_QUESTIONS);
  });

  it('rejects an invalid key with a typed error and stores nothing', async () => {
    const keys = build();
    for (const bad of [
      { questionCount: 0, answers: [] },
      { questionCount: ANSWER_KEY_MAX_QUESTIONS + 1, answers: Array(ANSWER_KEY_MAX_QUESTIONS + 1).fill('A') },
      { answers: ['A', 'B', 'C', 'E'] },
      { answers: ['A', 'B', null, 'D'] },
      { answers: ['A', 'B'] },
      { name: '   ' },
      { subjectId: '' },
    ]) {
      await assert.rejects(keys.createAnswerKey(input(bad)), (error) => {
        assert.ok(error instanceof InvalidAnswerKeyError);
        assert.equal(error.code, 'VALIDATION_ERROR');
        assert.ok(error.problems.length > 0);
        return true;
      });
    }
    assert.equal(count('answer_keys'), 0);
    assert.equal(count('answer_key_items'), 0);
  });

  it('rejects a subject that does not exist', async () => {
    await assert.rejects(build().createAnswerKey(input({ subjectId: 'missing' })), (error) => {
      assert.ok(error instanceof SubjectNotFoundError);
      assert.equal(error.code, 'NOT_FOUND');
      assert.equal(error.id, 'missing');
      return true;
    });
    assert.equal(count('answer_keys'), 0);
  });

  it('rejects a name another key of the same subject has, ignoring letter case', async () => {
    const keys = build();
    await keys.createAnswerKey(input({ name: 'Midterm' }));
    for (const duplicate of ['Midterm', 'MIDTERM', '  midterm ']) {
      await assert.rejects(keys.createAnswerKey(input({ name: duplicate })), (error) => {
        assert.ok(error instanceof DuplicateNameError);
        assert.equal(error.duplicateName, 'Midterm');
        return true;
      });
    }
    await keys.createAnswerKey(input({ name: 'Ñandú' }));
    await assert.rejects(keys.createAnswerKey(input({ name: 'ñANDÚ' })), DuplicateNameError);
    assert.equal(count('answer_keys'), 2);
  });

  it('allows the same name under another subject', async () => {
    const keys = build();
    await keys.createAnswerKey(input({ name: 'Midterm', subjectId: 'sub-1' }));
    await keys.createAnswerKey(input({ name: 'Midterm', subjectId: 'sub-2' }));
    assert.equal(count('answer_keys'), 2);
  });

  it('reports the UNIQUE index itself as a duplicate when the earlier check is bypassed', async () => {
    await build().createAnswerKey(input());
    const blind = {
      ...t.db,
      getAllAsync: async (sql, params) =>
        sql.startsWith('SELECT id, name FROM answer_keys') ? [] : t.db.getAllAsync(sql, params),
    };
    await assert.rejects(build(blind).createAnswerKey(input({ name: 'MIDTERM' })), DuplicateNameError);
    assert.equal(count('answer_keys'), 1);
  });

  it('rolls back the header when writing the answers fails', async () => {
    const keys = build(failingAfterWrite(t.db, /^INSERT INTO answer_key_items/));
    await assert.rejects(keys.createAnswerKey(input()), (error) => {
      assert.ok(error instanceof DatabaseError);
      assert.equal(error.code, 'DATABASE_ERROR');
      assert.ok(!error.message.includes('disk I/O'));
      return true;
    });
    assert.equal(count('answer_keys'), 0);
    assert.equal(count('answer_key_items'), 0);
  });

  it('passes every value as a parameter, never inside the SQL text', async () => {
    const statements = [];
    const record = (method) => (sql, params = []) => {
      statements.push(sql);
      return t.db[method](sql, params);
    };
    const spy = { ...t.db, getFirstAsync: record('getFirstAsync'), getAllAsync: record('getAllAsync'), runAsync: record('runAsync') };
    const keys = build(spy);
    const hostile = `x'); DROP TABLE answer_keys; --`;

    const created = await keys.createAnswerKey(input({ name: hostile }));
    await keys.updateAnswerKey(created.id, input({ name: 'Renamed', answers: ['D', 'C', 'B', 'A'] }));
    await keys.listAnswerKeys({ subjectId: 'sub-1', search: hostile });
    await keys.deleteAnswerKey(created.id);

    assert.ok(statements.length >= 10);
    for (const sql of statements) assert.doesNotMatch(sql, /DROP TABLE|Renamed|sub-1|id-1/);
    assert.deepEqual(tables().includes('answer_keys'), true);
  });

  it('refuses to read a stored key that has a gap instead of guessing its answers', async () => {
    const created = await build().createAnswerKey(input());
    t.run('DELETE FROM answer_key_items WHERE answer_key_id = ? AND question_number = 2', created.id);
    await assert.rejects(build().getAnswerKey(created.id), DatabaseError);
    await assert.rejects(build().listAnswerKeys(), DatabaseError);
  });
});

describe('answer keys: list, filter, and search', () => {
  beforeEach(async () => {
    await openMigrated();
    const keys = build();
    await keys.createAnswerKey(input({ name: 'quiz 2', subjectId: 'sub-1' }));
    await keys.createAnswerKey(input({ name: 'Midterm', subjectId: 'sub-1' }));
    await keys.createAnswerKey(input({ name: 'Quiz 1', subjectId: 'sub-1' }));
    await keys.createAnswerKey(input({ name: 'Finals', subjectId: 'sub-2', questionCount: 2, answers: ['D', 'A'] }));
  });

  const names = (keys) => keys.map((key) => `${key.subjectName} / ${key.name}`);

  it('lists every key by subject name, then key name, ignoring letter case', async () => {
    const listed = await build().listAnswerKeys();
    assert.deepEqual(names(listed), [
      'biology / Finals',
      'Mathematics / Midterm',
      'Mathematics / Quiz 1',
      'Mathematics / quiz 2',
    ]);
    assert.deepEqual(listed[0].answers, ['D', 'A']);
    assert.deepEqual(listed[1].answers, ['A', 'B', 'C', 'D']);
    assert.deepEqual(names(await build().listAnswerKeys()), names(listed));
  });

  it('lists the keys of one subject, as the scan flow will need', async () => {
    const keys = build();
    assert.deepEqual(names(await keys.listAnswerKeys({ subjectId: 'sub-2' })), ['biology / Finals']);
    assert.equal((await keys.listAnswerKeys({ subjectId: 'sub-1' })).length, 3);
    assert.deepEqual(await keys.listAnswerKeys({ subjectId: 'missing' }), []);
  });

  it('searches by name, ignoring letter case, within the subject filter', async () => {
    const keys = build();
    assert.deepEqual(names(await keys.listAnswerKeys({ search: 'QUIZ' })), [
      'Mathematics / Quiz 1',
      'Mathematics / quiz 2',
    ]);
    assert.deepEqual(names(await keys.listAnswerKeys({ search: ' fin ', subjectId: 'sub-2' })), ['biology / Finals']);
    assert.deepEqual(await keys.listAnswerKeys({ search: 'fin', subjectId: 'sub-1' }), []);
    assert.deepEqual(await keys.listAnswerKeys({ search: '%' }), []);
    assert.equal((await keys.listAnswerKeys({ search: '  ' })).length, 4);
  });

  it('reads all keys with two statements, however many there are', async () => {
    const statements = [];
    const spy = {
      ...t.db,
      getAllAsync: (sql, params) => {
        statements.push(sql);
        return t.db.getAllAsync(sql, params);
      },
      getFirstAsync: (sql, params) => {
        statements.push(sql);
        return t.db.getFirstAsync(sql, params);
      },
    };
    assert.equal((await build(spy).listAnswerKeys()).length, 4);
    assert.equal(statements.length, 2);
  });

  it('reports how many results were scored with each key', async () => {
    const [finals] = await build().listAnswerKeys({ subjectId: 'sub-2' });
    insertResult(finals.id, 'res-1');
    insertResult(finals.id, 'res-2');

    const listed = await build().listAnswerKeys();
    assert.deepEqual(listed.map((key) => key.resultCount), [2, 0, 0, 0]);
    assert.equal(await build().countResults(finals.id), 2);
    assert.equal(await build().hasResults(finals.id), true);
    assert.equal(await build().hasResults(listed[1].id), false);
    assert.equal(await build().countResults('missing'), 0);
  });
});

describe('answer keys: update', () => {
  let keys;
  let original;

  beforeEach(async () => {
    await openMigrated();
    keys = build();
    original = await keys.createAnswerKey(input());
  });

  it('changes name, subject, question count, and answers together and keeps id and created_at', async () => {
    const updated = await keys.updateAnswerKey(original.id, {
      name: ' Finals ',
      subjectId: 'sub-2',
      questionCount: 2,
      answers: ['D', 'D'],
    });

    assert.deepEqual(updated, {
      id: original.id,
      subjectId: 'sub-2',
      name: 'Finals',
      questionCount: 2,
      answers: ['D', 'D'],
      createdAt: T0,
      updatedAt: T1,
    });
    assert.deepEqual(await keys.getAnswerKey(original.id), { ...updated, subjectName: 'biology', resultCount: 0 });
    assert.equal(count('answer_key_items'), 2);
  });

  it('grows a key when the added questions are answered, and refuses when they are not', async () => {
    await assert.rejects(
      keys.updateAnswerKey(original.id, input({ questionCount: 6, answers: ['A', 'B', 'C', 'D', null, null] })),
      InvalidAnswerKeyError
    );
    assert.equal(count('answer_key_items'), 4);

    const grown = await keys.updateAnswerKey(original.id, input({ questionCount: 6, answers: ['A', 'B', 'C', 'D', 'A', 'B'] }));
    assert.deepEqual(grown.answers, ['A', 'B', 'C', 'D', 'A', 'B']);
    assert.equal(count('answer_key_items'), 6);
  });

  it('does nothing when nothing changed, and treats a same-name rename as no change', async () => {
    const writes = [];
    const spy = { ...t.db, runAsync: (sql, params) => (writes.push(sql), t.db.runAsync(sql, params)) };
    const result = await build(spy).updateAnswerKey(original.id, input({ name: '  Midterm ' }));
    assert.deepEqual(result, original);
    assert.deepEqual(writes, []);
  });

  it('allows a rename that changes only letter case', async () => {
    assert.equal((await keys.updateAnswerKey(original.id, input({ name: 'MIDTERM' }))).name, 'MIDTERM');
  });

  it('rejects the name of another key of the subject and leaves the key unchanged', async () => {
    await keys.createAnswerKey(input({ name: 'Finals' }));
    await assert.rejects(keys.updateAnswerKey(original.id, input({ name: 'finals' })), DuplicateNameError);
    // Moving to a subject that already has the name is a clash too.
    await keys.createAnswerKey(input({ name: 'Midterm', subjectId: 'sub-2' }));
    await assert.rejects(keys.updateAnswerKey(original.id, input({ subjectId: 'sub-2' })), DuplicateNameError);
    assert.deepEqual((await keys.getAnswerKey(original.id)).name, 'Midterm');
  });

  it('rejects invalid values, a missing subject, and a missing key with typed errors', async () => {
    await assert.rejects(keys.updateAnswerKey(original.id, input({ answers: ['A', 'B', 'C', 'Z'] })), InvalidAnswerKeyError);
    await assert.rejects(keys.updateAnswerKey(original.id, input({ subjectId: 'missing' })), SubjectNotFoundError);
    await assert.rejects(keys.updateAnswerKey('missing', input()), (error) => {
      assert.ok(error instanceof RecordNotFoundError);
      assert.ok(!(error instanceof SubjectNotFoundError));
      return true;
    });
    assert.deepEqual((await keys.getAnswerKey(original.id)).answers, ['A', 'B', 'C', 'D']);
  });

  it('rolls back the whole update when writing the new answers fails', async () => {
    const failing = build(failingAfterWrite(t.db, /^INSERT INTO answer_key_items/));
    await assert.rejects(
      failing.updateAnswerKey(original.id, input({ name: 'Changed', questionCount: 2, answers: ['D', 'D'] })),
      DatabaseError
    );
    assert.deepEqual(await keys.getAnswerKey(original.id), { ...original, subjectName: 'Mathematics', resultCount: 0 });
  });
});

describe('answer keys: historical integrity', () => {
  let keys;
  let used;

  beforeEach(async () => {
    await openMigrated();
    keys = build();
    used = await keys.createAnswerKey(input());
    insertResult(used.id, 'res-1');
    insertResult(used.id, 'res-2');
  });

  const assertLocked = (promise) =>
    assert.rejects(promise, (error) => {
      assert.ok(error instanceof AnswerKeyLockedError);
      assert.equal(error.code, 'ANSWER_KEY_LOCKED');
      assert.equal(error.resultCount, 2);
      return true;
    });

  it('blocks a change of answers, question count, or subject once results exist', async () => {
    await assertLocked(keys.updateAnswerKey(used.id, input({ answers: ['A', 'B', 'C', 'A'] })));
    await assertLocked(keys.updateAnswerKey(used.id, input({ questionCount: 3, answers: ['A', 'B', 'C'] })));
    await assertLocked(keys.updateAnswerKey(used.id, input({ questionCount: 5, answers: ['A', 'B', 'C', 'D', 'A'] })));
    await assertLocked(keys.updateAnswerKey(used.id, input({ subjectId: 'sub-2' })));
    await assertLocked(keys.updateAnswerKey(used.id, input({ name: 'Renamed', answers: ['D', 'B', 'C', 'D'] })));

    // Nothing changed, not even the name sent together with a blocked change.
    assert.deepEqual(await keys.getAnswerKey(used.id), { ...used, subjectName: 'Mathematics', resultCount: 2 });
    assert.deepEqual(plain(t.all('SELECT score, total FROM results ORDER BY id')), [
      { score: 1, total: 2 },
      { score: 1, total: 2 },
    ]);
  });

  it('still allows viewing and renaming a used key, without touching its answers or results', async () => {
    const renamed = await keys.updateAnswerKey(used.id, input({ name: 'Midterm 2026' }));
    assert.equal(renamed.name, 'Midterm 2026');
    assert.deepEqual(renamed.answers, used.answers);
    assert.notEqual(renamed.updatedAt, used.updatedAt);
    assert.equal(count('results'), 2);
    assert.equal(count('answer_key_items'), 4);
  });

  it('duplicates a used key into an unused copy that can be revised', async () => {
    const copy = await keys.duplicateAnswerKey(used.id);

    assert.notEqual(copy.id, used.id);
    assert.equal(copy.name, 'Midterm – Copy');
    assert.equal(copy.subjectId, used.subjectId);
    assert.equal(copy.questionCount, used.questionCount);
    assert.deepEqual(copy.answers, used.answers);
    assert.notEqual(copy.createdAt, used.createdAt);
    // The copy has no results, so it can be changed; the original keeps its own.
    assert.equal(await keys.countResults(copy.id), 0);
    assert.equal(await keys.countResults(used.id), 2);
    const revised = await keys.updateAnswerKey(copy.id, input({ name: copy.name, answers: ['D', 'B', 'C', 'D'] }));
    assert.deepEqual(revised.answers, ['D', 'B', 'C', 'D']);
    assert.deepEqual((await keys.getAnswerKey(used.id)).answers, ['A', 'B', 'C', 'D']);
  });

  it('refuses to delete a key with results, and reports how many', async () => {
    await assert.rejects(keys.deleteAnswerKey(used.id), (error) => {
      assert.ok(error instanceof AnswerKeyInUseError);
      assert.equal(error.code, 'IN_USE');
      assert.equal(error.resultCount, 2);
      return true;
    });
    assert.equal(count('answer_keys'), 1);
    assert.equal(count('answer_key_items'), 4);
    assert.equal(count('results'), 2);
  });

  it('deletes the key once its results are gone', async () => {
    t.run('DELETE FROM results');
    await keys.deleteAnswerKey(used.id);
    assert.equal(count('answer_keys'), 0);
  });
});

describe('answer keys: duplicate and delete', () => {
  let keys;
  let original;

  beforeEach(async () => {
    await openMigrated();
    keys = build();
    original = await keys.createAnswerKey(input());
  });

  it('drafts a copy with a free name and stores nothing until it is saved', async () => {
    const draft = await keys.draftDuplicate(original.id);
    assert.deepEqual(draft, {
      name: 'Midterm – Copy',
      subjectId: 'sub-1',
      questionCount: 4,
      answers: ['A', 'B', 'C', 'D'],
    });
    assert.equal(count('answer_keys'), 1);

    const saved = await keys.createAnswerKey({ ...draft, name: 'Midterm B' });
    assert.equal(saved.name, 'Midterm B');
    assert.notEqual(saved.id, original.id);
    assert.equal(count('answer_key_items'), 8);
  });

  it('proposes the next free name when copies already exist', async () => {
    assert.equal((await keys.duplicateAnswerKey(original.id)).name, 'Midterm – Copy');
    assert.equal((await keys.duplicateAnswerKey(original.id)).name, 'Midterm – Copy 2');
  });

  it('enforces the same name rule on a copy, and reports a missing original', async () => {
    await assert.rejects(keys.duplicateAnswerKey(original.id, 'MIDTERM'), DuplicateNameError);
    await assert.rejects(keys.duplicateAnswerKey(original.id, '  '), InvalidAnswerKeyError);
    await assert.rejects(keys.duplicateAnswerKey('missing'), RecordNotFoundError);
    assert.equal(count('answer_keys'), 1);
  });

  it('physically deletes an unused key with its items and nothing else', async () => {
    const other = await keys.createAnswerKey(input({ name: 'Finals' }));

    await keys.deleteAnswerKey(original.id);

    assert.deepEqual(t.all('SELECT id FROM answer_keys').map((row) => row.id), [other.id]);
    assert.equal(t.get('SELECT COUNT(*) AS n FROM answer_key_items WHERE answer_key_id = ?', original.id).n, 0);
    assert.equal(count('answer_key_items'), 4);
    assert.equal(count('subjects'), 2);
    // The name is free again.
    await keys.createAnswerKey(input());
  });

  it('reports a missing key with a typed error, and rolls back a failed delete', async () => {
    await assert.rejects(keys.deleteAnswerKey('missing'), RecordNotFoundError);
    await assert.rejects(
      build(failingAfterWrite(t.db, /^DELETE FROM answer_keys/)).deleteAnswerKey(original.id),
      DatabaseError
    );
    assert.equal(count('answer_keys'), 1);
    assert.equal(count('answer_key_items'), 4);
  });
});

describe('subjects and answer keys', () => {
  beforeEach(openMigrated);

  it('blocks deleting a subject while answer keys belong to it, with the count', async () => {
    const keys = build();
    const first = await keys.createAnswerKey(input({ name: 'Midterm' }));
    const second = await keys.createAnswerKey(input({ name: 'Finals' }));

    await assert.rejects(subjectUseCases().deleteSubject('sub-1'), (error) => {
      assert.ok(error instanceof SubjectInUseError);
      assert.equal(error.answerKeyCount, 2);
      return true;
    });

    await keys.deleteAnswerKey(first.id);
    await assert.rejects(subjectUseCases().deleteSubject('sub-1'), (error) => {
      assert.equal(error.answerKeyCount, 1);
      return true;
    });

    await keys.deleteAnswerKey(second.id);
    await subjectUseCases().deleteSubject('sub-1');
    assert.deepEqual(t.all('SELECT id FROM subjects').map((row) => row.id), ['sub-2']);
  });
});

// ---------------------------------------------------------------------------
// Navigation wiring, checked in the source: the navigation modules import
// native UI code and cannot be loaded here.
// ---------------------------------------------------------------------------

describe('Keys navigation', () => {
  beforeEach(() => {
    t = openTestDatabase();
  });

  const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const destinations = source('src/core/presentation/navigation/destinations.ts');
  const block = (name) => destinations.slice(destinations.indexOf(`export const ${name}`)).split('];')[0];
  const routesOf = (text) => [...text.matchAll(/route: ([A-Z_]+|'[a-z-]+')/g)].map((match) => match[1].replace(/'/g, ''));
  const labelsOf = (text) => [...text.matchAll(/tabLabel: '([^']+)'/g)].map((match) => match[1]);

  it('has exactly five tabs in the approved order, with Keys second', () => {
    const tabs = block('TAB_DESTINATIONS');
    assert.deepEqual(labelsOf(tabs), ['Home', 'Keys', 'Scan', 'Students', 'Results']);
    assert.deepEqual(routesOf(tabs), ['HOME_ROUTE', 'keys', 'SCAN_ROUTE', 'students', 'results']);
    assert.match(tabs, /route: 'keys', title: 'Answer Keys', tabLabel: 'Keys'/);
  });

  it('keeps Classes, Subjects, and Settings out of the tab bar', () => {
    assert.deepEqual(labelsOf(block('SECONDARY_DESTINATIONS')), ['Classes', 'Subjects', 'Settings']);
  });

  it('registers a route file for every destination and no exams route', () => {
    const routes = readdirSync(new URL('../../src/app', import.meta.url))
      .filter((file) => !file.startsWith('_'))
      .map((file) => file.replace(/\.tsx$/, ''))
      .sort();
    assert.deepEqual(routes, ['classes', 'index', 'keys', 'results', 'scan', 'settings', 'students', 'subjects']);
    assert.match(source('src/app/keys.tsx'), /AnswerKeysScreen as default/);
    assert.equal(existsSync(new URL('../../src/features/exams', import.meta.url)), false);
  });

  it('selects the tab whose route is current, so Keys is active on /keys', () => {
    const tabBar = source('src/core/presentation/navigation/bottom-tab-bar.tsx');
    assert.match(tabBar, /TAB_DESTINATIONS\.some\(\(tab\) => tab\.route === currentRoute\)/);
    assert.match(tabBar, /const isActive = destination\.route === selectedRoute;/);
  });

  it('points the Home shortcuts at Keys with answer key wording', () => {
    const home = source('src/features/dashboard/presentation/home-screen.tsx');
    assert.match(home, /label: 'Create answer key', icon: \w+, href: '\/keys'/);
    assert.match(home, /title: 'Recent answer keys'/);
    assert.doesNotMatch(home, /href: '\/exams'|Create exam|Recent exams/);
  });

  it('shows no exam wording in any destination label or title', () => {
    assert.doesNotMatch(destinations, /exam/i);
  });
});
