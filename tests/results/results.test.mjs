// Verifies Results: migration 7 (the names a result was saved under), the
// list with search, filters, pages, and attempt numbers, a result's details,
// the private scan-image store, and permanent deletion with its file handling.
// Uses Node's built-in SQLite on disposable databases and an in-memory file
// system; nothing here touches a device.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { initializeDatabase } from '../../src/core/infrastructure/database/initialize-database.ts';
import { MIGRATIONS } from '../../src/core/infrastructure/database/migrations.ts';
import { AnswerKeyInUseError } from '../../src/features/answer-keys/application/answer-key-repository.ts';
import { createSqliteAnswerKeyRepository } from '../../src/features/answer-keys/infrastructure/sqlite-answer-key-repository.ts';
import { ClassInUseError } from '../../src/features/classes/application/class-repository.ts';
import { createSqliteClassRepository } from '../../src/features/classes/infrastructure/sqlite-class-repository.ts';
import {
  ResultImageError,
  ResultNotFoundError,
} from '../../src/features/results/application/results-ports.ts';
import { createResultsUseCases } from '../../src/features/results/application/results-use-cases.ts';
import {
  answersInView,
  percentage,
  tallyAnswers,
} from '../../src/features/results/domain/result.ts';
import {
  NO_FILTER,
  filterChoices,
  hasActiveFilter,
  setFilter,
  withoutIncompatible,
} from '../../src/features/results/domain/result-filter.ts';
import {
  createResultImageStore,
  scanImageFileName,
} from '../../src/features/results/infrastructure/result-image-store.ts';
import { createSqliteResultsRepository } from '../../src/features/results/infrastructure/sqlite-results-repository.ts';
import { createSqliteResultRepository } from '../../src/features/scan/infrastructure/sqlite-result-repository.ts';
import { StudentInUseError } from '../../src/features/students/application/student-repository.ts';
import { createSqliteStudentRepository } from '../../src/features/students/infrastructure/sqlite-student-repository.ts';
import { SubjectInUseError } from '../../src/features/subjects/application/subject-repository.ts';
import { createSqliteSubjectRepository } from '../../src/features/subjects/infrastructure/sqlite-subject-repository.ts';
import { openTestDatabase } from '../database/test-database.mjs';

const T0 = '2026-10-02T08:00:00.000Z';
const at = (minutes) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();
const LATEST = MIGRATIONS.length;
const DOCUMENTS = 'file:///data/user/0/app/files/';
const CACHE = 'file:///data/user/0/app/cache/';
const PNG = new Uint8Array([137, 80, 78, 71]);

let t;

afterEach(() => {
  t.close();
});

const count = (table) => t.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
const plain = (rows) => rows.map((row) => ({ ...row }));
const reload = () => t.all('SELECT name FROM sqlite_master LIMIT 1');

/**
 * Two subjects, two classes, three students, three answer keys:
 *   Mathematics (sub-1): Midterm (key-1, A B C D) and Finals (key-2, A A)
 *   Science (sub-2): Quiz (key-3, B C)
 *   BSIT 1A (cls-1): Maria Santos, Paolo Garcia; BSIT 1B (cls-2): Ana Peña
 */
function seedRecords() {
  for (const [id, name] of [['sub-1', 'Mathematics'], ['sub-2', 'Science']]) {
    t.run('INSERT INTO subjects VALUES (?, ?, ?, ?)', id, name, T0, T0);
  }
  for (const [id, name] of [['cls-1', 'BSIT 1A'], ['cls-2', 'BSIT 1B']]) {
    t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', id, name, T0, T0);
  }
  for (const [id, classId, number, name] of [
    ['stu-1', 'cls-1', '2026-001', 'Maria Santos'],
    ['stu-2', 'cls-1', '2026-002', 'Paolo Garcia'],
    ['stu-3', 'cls-2', '2026-003', 'Ana Peña'],
  ]) {
    t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', id, classId, number, name, T0, T0);
  }
  for (const [id, subjectId, name, answers] of [
    ['key-1', 'sub-1', 'Midterm', ['A', 'B', 'C', 'D']],
    ['key-2', 'sub-1', 'Finals', ['A', 'A']],
    ['key-3', 'sub-2', 'Quiz', ['B', 'C']],
  ]) {
    t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', id, subjectId, name, answers.length, T0, T0);
    answers.forEach((answer, index) => t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', id, index + 1, answer));
  }
}

async function openSeeded() {
  t = openTestDatabase();
  await initializeDatabase(t.db);
  seedRecords();
}

/** An in-memory documents folder that records what was moved and deleted. */
function fakeFiles(files = {}, { failMove = () => false, failDelete = () => false } = {}) {
  const store = new Map(Object.entries(files));
  const log = { moved: [], deleted: [] };
  return {
    store,
    log,
    fileSystem: {
      documentDirectory: () => DOCUMENTS,
      exists: async (uri) => store.has(uri),
      move: async (from, to) => {
        if (failMove(from, to)) throw new Error('EXDEV: raw device message');
        if (!store.has(from)) throw new Error('ENOENT');
        store.set(to, store.get(from));
        store.delete(from);
        log.moved.push([from, to]);
      },
      delete: async (uri) => {
        if (failDelete(uri)) throw new Error('EBUSY: raw device message');
        log.deleted.push(uri);
        store.delete(uri);
      },
      ensureDirectory: async () => undefined,
      listFiles: async (directory) =>
        [...store.keys()].filter((uri) => uri.startsWith(directory) && !uri.slice(directory.length).includes('/')),
    },
  };
}

/**
 * Saves a result the way Scan does, through the scan repository, so the names
 * it is saved under are written by the real code. `finals` is what was scored
 * for each question (null is a blank); `detected` overrides what the reader
 * read for a question: [state, letter].
 */
async function addResult({
  id,
  key = 'key-1',
  student = 'stu-1',
  capturedAt = T0,
  createdAt = capturedAt,
  finals,
  detected = {},
  confidence = 0.9,
  imagePath = `scans/${id}.png`,
  files,
}) {
  const row = t.get(
    `SELECT st.full_name, st.student_number, st.class_id, c.name AS class_name, s.name AS subject_name, k.name AS key_name
       FROM students st JOIN classes c ON c.id = st.class_id, answer_keys k JOIN subjects s ON s.id = k.subject_id
      WHERE st.id = ? AND k.id = ?`,
    student,
    key
  );
  const correct = t.all('SELECT correct_answer FROM answer_key_items WHERE answer_key_id = ? ORDER BY question_number', key).map((r) => r.correct_answer);
  const given = finals ?? correct;
  const answers = correct.map((correctAnswer, index) => {
    const finalAnswer = given[index];
    const [state, letter] = detected[index + 1] ?? (finalAnswer === null ? ['blank', null] : ['marked', finalAnswer]);
    return {
      questionNumber: index + 1,
      detectedState: state,
      detectedAnswer: letter,
      finalAnswer,
      correctAnswer,
      isCorrect: finalAnswer !== null && finalAnswer === correctAnswer,
      wasCorrected: finalAnswer !== letter,
      confidence,
    };
  });
  await createSqliteResultRepository(t.db).save({
    id,
    answerKeyId: key,
    studentId: student,
    classId: row.class_id,
    studentName: row.full_name,
    studentNumber: row.student_number,
    className: row.class_name,
    subjectName: row.subject_name,
    answerKeyName: row.key_name,
    score: answers.filter((answer) => answer.isCorrect).length,
    total: answers.length,
    templateId: `AC-${answers.length}-V2`,
    capturedAt,
    createdAt,
    answers,
    scanRecordId: `scn-${id}`,
    imagePath,
  });
  if (files && imagePath) files.store.set(`${DOCUMENTS}${imagePath}`, PNG);
}

function build({ files = fakeFiles(), db = t.db } = {}) {
  return createResultsUseCases({
    repository: createSqliteResultsRepository(db),
    images: createResultImageStore(files.fileSystem),
  });
}

const ids = (page) => page.items.map((item) => item.id);
const list = (overrides = {}) => build().listResults({ filter: NO_FILTER, search: '', ...overrides });

// ---------------------------------------------------------------------------
// Migration 7
// ---------------------------------------------------------------------------

describe('migration 7: the names a result was saved under', () => {
  const RESULT_COLUMNS = [
    'id', 'answer_key_id', 'student_id', 'class_id', 'score', 'total', 'template_id', 'captured_at', 'created_at',
    'student_name', 'student_number', 'class_name', 'subject_name', 'answer_key_name',
  ];
  const columns = (table) => t.all(`SELECT name FROM pragma_table_info('${table}')`).map((c) => c.name);
  const indexes = () =>
    t.all("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'results' AND name LIKE 'idx_%' ORDER BY name").map((r) => r.name);

  async function openVersion6() {
    t = openTestDatabase();
    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 6)), 6);
    seedRecords();
  }
  /** A result as version 6 stored it: ids only, no names. */
  const version6Result = (id, key, student, classId, capturedAt) => {
    t.run('INSERT INTO results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, key, student, classId, 1, 2, 'AC-2-V2', capturedAt, capturedAt);
    t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', `${id}:1`, id, 1, 'MARKED', 'A', 'A', 'A', 1, 0, 0.9);
    t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', `${id}:2`, id, 2, 'BLANK', null, null, 'A', 0, 0, 0.8);
    t.run('INSERT INTO scan_records VALUES (?, ?, ?, ?)', `scn-${id}`, id, `scans/${id}.png`, capturedAt);
  };

  it('brings a fresh database to version 7 with the snapshot columns and the list index', async () => {
    t = openTestDatabase();
    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 7)), 7);
    assert.ok(LATEST >= 7);
    assert.deepEqual(columns('results'), RESULT_COLUMNS);
    assert.equal(t.get("SELECT strict FROM pragma_table_list WHERE name = 'results'").strict, 1);
    assert.deepEqual(indexes(), [
      'idx_results_answer_key_id_student_id',
      'idx_results_captured_at',
      'idx_results_class_id',
      'idx_results_student_id',
    ]);
  });

  it('upgrades a version-6 database: results are kept and filled from the records they point to', async () => {
    await openVersion6();
    // Maria was scanned in BSIT 1A and moved to BSIT 1B before the upgrade.
    version6Result('res-1', 'key-2', 'stu-1', 'cls-1', at(1));
    version6Result('res-2', 'key-3', 'stu-3', 'cls-2', at(2));
    t.run("UPDATE students SET class_id = 'cls-2' WHERE id = 'stu-1'");
    const untouched = ['subjects', 'classes', 'students', 'answer_keys', 'answer_key_items', 'student_answers', 'scan_records', 'class_subjects'];
    const before = Object.fromEntries(untouched.map((table) => [table, plain(t.all(`SELECT * FROM ${table} ORDER BY 1, 2`))]));

    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 7)), 7);
    reload();

    for (const table of untouched) {
      assert.deepEqual(plain(t.all(`SELECT * FROM ${table} ORDER BY 1, 2`)), before[table], table);
    }
    assert.deepEqual(plain(t.all('SELECT * FROM results ORDER BY id')), [
      {
        id: 'res-1', answer_key_id: 'key-2', student_id: 'stu-1', class_id: 'cls-1', score: 1, total: 2,
        template_id: 'AC-2-V2', captured_at: at(1), created_at: at(1),
        // The class of the scan, not the class the student is in now.
        student_name: 'Maria Santos', student_number: '2026-001', class_name: 'BSIT 1A',
        subject_name: 'Mathematics', answer_key_name: 'Finals',
      },
      {
        id: 'res-2', answer_key_id: 'key-3', student_id: 'stu-3', class_id: 'cls-2', score: 1, total: 2,
        template_id: 'AC-2-V2', captured_at: at(2), created_at: at(2),
        student_name: 'Ana Peña', student_number: '2026-003', class_name: 'BSIT 1B',
        subject_name: 'Science', answer_key_name: 'Quiz',
      },
    ]);
    assert.deepEqual(columns('results'), RESULT_COLUMNS);
    assert.deepEqual(indexes(), [
      'idx_results_answer_key_id_student_id',
      'idx_results_captured_at',
      'idx_results_class_id',
      'idx_results_student_id',
    ]);
    assert.deepEqual(t.all('PRAGMA foreign_key_check'), []);
    assert.deepEqual(plain(t.all('PRAGMA integrity_check')), [{ integrity_check: 'ok' }]);
    const leftovers = t.all("SELECT name FROM sqlite_master WHERE name LIKE 'new_%' UNION ALL SELECT name FROM sqlite_temp_master");
    assert.deepEqual(leftovers, []);
  });

  it('keeps the delete rules after the rebuild', async () => {
    await openVersion6();
    version6Result('res-1', 'key-2', 'stu-1', 'cls-1', at(1));
    await initializeDatabase(t.db);
    reload();

    for (const [table, id] of [['answer_keys', 'key-2'], ['students', 'stu-1'], ['classes', 'cls-1']]) {
      assert.throws(() => t.run(`DELETE FROM ${table} WHERE id = ?`, id), /FOREIGN KEY/, table);
    }
    t.run("DELETE FROM results WHERE id = 'res-1'");
    assert.equal(count('student_answers') + count('scan_records'), 0);
  });

  it('requires every name of a new result', async () => {
    await openSeeded();
    const insert = (names) =>
      t.run(
        'INSERT INTO results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'res-x', 'key-1', 'stu-1', 'cls-1', 1, 4, 'AC-4-V2', T0, T0, ...names
      );
    const good = ['Maria Santos', '2026-001', 'BSIT 1A', 'Mathematics', 'Midterm'];
    for (let index = 0; index < good.length; index++) {
      assert.throws(() => insert(good.map((name, at) => (at === index ? '' : name))), /CHECK/);
      assert.throws(() => insert(good.map((name, at) => (at === index ? null : name))), /NOT NULL/);
    }
    insert(good);
    assert.equal(count('results'), 1);
  });

  it('rolls back, keeping version 6 and every row, when a result cannot be given its names', async () => {
    await openVersion6();
    version6Result('res-1', 'key-2', 'stu-1', 'cls-1', at(1));
    // With foreign keys off, as on a damaged database, a result can be left pointing nowhere.
    t.raw.exec('PRAGMA foreign_keys = OFF');
    t.run("DELETE FROM students WHERE id = 'stu-1'");
    const before = plain(t.all('SELECT * FROM results'));

    await assert.rejects(initializeDatabase(t.db, MIGRATIONS.slice(0, 7)), (error) => {
      assert.equal(error.name, 'MigrationFailedError');
      assert.equal(error.version, 7);
      return true;
    });

    assert.equal(t.get('PRAGMA user_version').user_version, 6);
    assert.deepEqual(plain(t.all('SELECT * FROM results')), before);
    assert.equal(count('student_answers'), 2);
    assert.equal(count('scan_records'), 1);
  });

  it('upgrades from every earlier version, and does nothing when run again', async () => {
    for (let from = 1; from <= 6; from++) {
      t = openTestDatabase();
      await initializeDatabase(t.db, MIGRATIONS.slice(0, from));
      assert.equal(await initializeDatabase(t.db), LATEST, `from version ${from}`);
      reload();
      assert.deepEqual(columns('results'), RESULT_COLUMNS, `from version ${from}`);
      assert.deepEqual(t.all('PRAGMA foreign_key_check'), []);
      const schema = JSON.stringify(t.all('SELECT type, name, sql FROM sqlite_master ORDER BY type, name'));
      assert.equal(await initializeDatabase(t.db), LATEST);
      assert.equal(JSON.stringify(t.all('SELECT type, name, sql FROM sqlite_master ORDER BY type, name')), schema);
      if (from < 6) t.close();
    }
  });

  it('reads the list in index order, and each filter through an index', async () => {
    await openSeeded();
    const plan = (sql) => t.all(`EXPLAIN QUERY PLAN ${sql}`).map((row) => row.detail).join(' | ');

    const newestFirst = plan('SELECT id FROM results r ORDER BY r.captured_at DESC, r.created_at DESC, r.id DESC LIMIT 30');
    assert.match(newestFirst, /idx_results_captured_at/);
    assert.doesNotMatch(newestFirst, /TEMP B-TREE/);

    assert.match(plan("SELECT id FROM results WHERE student_id = 'x'"), /idx_results_student_id/);
    assert.match(plan("SELECT id FROM results WHERE class_id = 'x'"), /idx_results_class_id/);
    assert.match(plan("SELECT id FROM results WHERE answer_key_id = 'x'"), /idx_results_answer_key_id_student_id/);
    assert.match(
      plan("SELECT COUNT(*) FROM results WHERE answer_key_id = 'x' AND student_id = 'y'"),
      /idx_results_answer_key_id_student_id/
    );
    // The subject is reached through the answer key's own index.
    assert.match(plan("SELECT id FROM answer_keys WHERE subject_id = 'x'"), /idx_answer_keys_subject_id_name/);
    // Details: answers and the scan record are found by their result.
    assert.match(plan("SELECT * FROM student_answers WHERE result_id = 'x' ORDER BY question_number"), /USING INDEX/);
    assert.match(plan("SELECT image_path FROM scan_records WHERE result_id = 'x'"), /USING INDEX/);
  });
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

describe('results list', () => {
  beforeEach(openSeeded);

  it('is empty when nothing was scanned', async () => {
    const results = build();
    assert.deepEqual(await list(), { items: [], next: null });
    assert.deepEqual(await results.countResults(NO_FILTER, ''), { matching: 0, total: 0 });
    assert.deepEqual(await results.listFilterLinks(), []);
  });

  it('lists newest first by capture time, then save time, then id', async () => {
    await addResult({ id: 'res-a', capturedAt: at(1) });
    await addResult({ id: 'res-b', student: 'stu-2', capturedAt: at(5) });
    // Same capture time: the later save comes first. Same both: the higher id.
    await addResult({ id: 'res-c', student: 'stu-3', key: 'key-3', capturedAt: at(3), createdAt: at(4) });
    await addResult({ id: 'res-d', student: 'stu-2', key: 'key-2', capturedAt: at(3), createdAt: at(9) });
    await addResult({ id: 'res-e', student: 'stu-3', key: 'key-2', capturedAt: at(3), createdAt: at(9) });

    assert.deepEqual(ids(await list()), ['res-b', 'res-e', 'res-d', 'res-c', 'res-a']);
    // The same every time.
    assert.deepEqual(ids(await list()), ids(await list()));
  });

  it('shows what a row needs: names, score, and when the photo was taken', async () => {
    await addResult({ id: 'res-1', capturedAt: at(1), createdAt: at(2), finals: ['A', 'B', 'D', null] });
    assert.deepEqual((await list()).items, [
      {
        id: 'res-1', score: 2, total: 4, capturedAt: at(1), createdAt: at(2),
        studentName: 'Maria Santos', studentNumber: '2026-001', className: 'BSIT 1A',
        subjectName: 'Mathematics', answerKeyName: 'Midterm',
        attempt: { number: 1, count: 1 },
      },
    ]);
    assert.equal(percentage(2, 4), 50);
    assert.equal(percentage(8, 10), 80);
    assert.equal(percentage(1, 3), 33);
    assert.equal(percentage(0, 0), 0);
  });

  it('reads a long history a page at a time, without gaps or repeats', async () => {
    for (let index = 1; index <= 25; index++) {
      // Several share a capture time, so the page boundary falls inside a tie.
      await addResult({ id: `res-${String(index).padStart(2, '0')}`, student: `stu-${(index % 3) + 1}`, key: 'key-2', capturedAt: at(Math.floor(index / 4)) });
    }
    const results = build();
    const seen = [];
    let after = null;
    let pages = 0;
    do {
      const page = await results.listResults({ filter: NO_FILTER, search: '', limit: 10, after });
      assert.ok(page.items.length <= 10);
      seen.push(...ids(page));
      after = page.next;
      pages++;
    } while (after !== null);

    assert.equal(pages, 3);
    assert.deepEqual(seen, ids(await list({ limit: 100 })));
    assert.equal(new Set(seen).size, 25);
    // A page that ends exactly at the end says so.
    assert.equal((await list({ limit: 25 })).next, null);
    assert.notEqual((await list({ limit: 24 })).next, null);
  });

  it('issues a fixed number of statements, however many results there are', async () => {
    for (let index = 1; index <= 40; index++) {
      await addResult({ id: `res-${index}`, student: `stu-${(index % 3) + 1}`, key: 'key-2', capturedAt: at(index) });
    }
    let statements = 0;
    const counting = {
      ...t.db,
      getAllAsync: (...args) => (statements++, t.db.getAllAsync(...args)),
      getFirstAsync: (...args) => (statements++, t.db.getFirstAsync(...args)),
    };
    const results = build({ db: counting });

    assert.equal((await results.listResults({ filter: NO_FILTER, search: '', limit: 40 })).items.length, 40);
    assert.equal(statements, 1);
    statements = 0;
    await results.countResults(NO_FILTER, 'maria');
    await results.listFilterLinks();
    assert.equal(statements, 2);
    statements = 0;
    assert.equal((await results.getResult('res-7')).result.answers.length, 2);
    assert.equal(statements, 2);
  });
});

describe('results search', () => {
  beforeEach(async () => {
    await openSeeded();
    await addResult({ id: 'res-1', student: 'stu-1', key: 'key-1', capturedAt: at(1) });
    await addResult({ id: 'res-2', student: 'stu-2', key: 'key-2', capturedAt: at(2) });
    await addResult({ id: 'res-3', student: 'stu-3', key: 'key-3', capturedAt: at(3) });
  });
  const found = async (search, filter = NO_FILTER) => ids(await list({ search, filter }));

  it('finds by student name, Student ID, answer key, subject, and class, ignoring case', async () => {
    assert.deepEqual(await found('maria'), ['res-1']);
    assert.deepEqual(await found('SANTOS'), ['res-1']);
    assert.deepEqual(await found('2026-002'), ['res-2']);
    assert.deepEqual(await found('2026'), ['res-3', 'res-2', 'res-1']);
    assert.deepEqual(await found('finals'), ['res-2']);
    assert.deepEqual(await found('science'), ['res-3']);
    assert.deepEqual(await found('mathematics'), ['res-2', 'res-1']);
    assert.deepEqual(await found('bsit 1b'), ['res-3']);
    assert.deepEqual(await found('1A'), ['res-2', 'res-1']);
  });

  it('ignores case for letters outside ASCII too, and trims the query', async () => {
    assert.deepEqual(await found('peña'), ['res-3']);
    assert.deepEqual(await found('PEÑA'), ['res-3']);
    assert.deepEqual(await found('   maria  '), ['res-1']);
    assert.deepEqual(await found('   '), ['res-3', 'res-2', 'res-1']);
  });

  it('treats what is typed as text, never as a pattern or as SQL', async () => {
    assert.deepEqual(await found('%'), []);
    assert.deepEqual(await found('_'), []);
    assert.deepEqual(await found("' OR 1=1 --"), []);
    assert.deepEqual(await found('2026-00_'), []);
    assert.equal(count('results'), 3);
  });

  it('reports no match as an empty page, with the totals to explain it', async () => {
    assert.deepEqual(await list({ search: 'nobody' }), { items: [], next: null });
    assert.deepEqual(await build().countResults(NO_FILTER, 'nobody'), { matching: 0, total: 3 });
    assert.deepEqual(await build().countResults(NO_FILTER, ' maria '), { matching: 1, total: 3 });
  });

  it('searches within the filtered results only', async () => {
    const mathematics = { ...NO_FILTER, subjectId: 'sub-1' };
    assert.deepEqual(await found('2026', mathematics), ['res-2', 'res-1']);
    assert.deepEqual(await found('ana', mathematics), []);
    assert.deepEqual(await build().countResults(mathematics, 'ana'), { matching: 0, total: 3 });
  });
});

describe('results filters', () => {
  beforeEach(async () => {
    await openSeeded();
    await addResult({ id: 'res-1', student: 'stu-1', key: 'key-1', capturedAt: at(1) });
    await addResult({ id: 'res-2', student: 'stu-2', key: 'key-1', capturedAt: at(2) });
    await addResult({ id: 'res-3', student: 'stu-2', key: 'key-2', capturedAt: at(3) });
    await addResult({ id: 'res-4', student: 'stu-3', key: 'key-3', capturedAt: at(4) });
    await addResult({ id: 'res-5', student: 'stu-3', key: 'key-1', capturedAt: at(5) });
  });
  const filtered = async (filter) => ids(await list({ filter: { ...NO_FILTER, ...filter } }));
  const names = (choices) => choices.map((choice) => choice.name);

  it('filters by subject, answer key, class, and student', async () => {
    assert.deepEqual(await filtered({ subjectId: 'sub-1' }), ['res-5', 'res-3', 'res-2', 'res-1']);
    assert.deepEqual(await filtered({ subjectId: 'sub-2' }), ['res-4']);
    assert.deepEqual(await filtered({ answerKeyId: 'key-1' }), ['res-5', 'res-2', 'res-1']);
    assert.deepEqual(await filtered({ classId: 'cls-1' }), ['res-3', 'res-2', 'res-1']);
    assert.deepEqual(await filtered({ studentId: 'stu-3' }), ['res-5', 'res-4']);
  });

  it('combines filters, and counts what they leave', async () => {
    assert.deepEqual(await filtered({ subjectId: 'sub-1', classId: 'cls-1' }), ['res-3', 'res-2', 'res-1']);
    assert.deepEqual(await filtered({ subjectId: 'sub-1', answerKeyId: 'key-1', classId: 'cls-1' }), ['res-2', 'res-1']);
    assert.deepEqual(await filtered({ answerKeyId: 'key-1', classId: 'cls-1', studentId: 'stu-2' }), ['res-2']);
    assert.deepEqual(await filtered({ subjectId: 'sub-2', classId: 'cls-1' }), []);
    assert.deepEqual(
      await build().countResults({ ...NO_FILTER, subjectId: 'sub-1', classId: 'cls-1' }, ''),
      { matching: 3, total: 5 }
    );
  });

  it('filters by the class of the scan, even after the student moved', async () => {
    t.run("UPDATE students SET class_id = 'cls-2' WHERE id = 'stu-1'");
    assert.deepEqual(await filtered({ classId: 'cls-1' }), ['res-3', 'res-2', 'res-1']);
    assert.deepEqual(await filtered({ studentId: 'stu-1' }), ['res-1']);
  });

  it('pages through a filtered list', async () => {
    const results = build();
    const filter = { ...NO_FILTER, subjectId: 'sub-1' };
    const first = await results.listResults({ filter, search: '', limit: 3 });
    const second = await results.listResults({ filter, search: '', limit: 3, after: first.next });
    assert.deepEqual([ids(first), ids(second), second.next], [['res-5', 'res-3', 'res-2'], ['res-1'], null]);
  });

  it('offers only what has results, each filter narrowed by the ones above it', async () => {
    const links = await build().listFilterLinks();
    const all = filterChoices(links, NO_FILTER);
    assert.deepEqual(names(all.subjects), ['Mathematics', 'Science']);
    assert.deepEqual(names(all.answerKeys), ['Finals', 'Midterm', 'Quiz']);
    assert.deepEqual(names(all.classes), ['BSIT 1A', 'BSIT 1B']);
    assert.deepEqual(all.students.map((s) => [s.name, s.detail]), [
      ['Ana Peña', '2026-003'], ['Maria Santos', '2026-001'], ['Paolo Garcia', '2026-002'],
    ]);

    const science = filterChoices(links, { ...NO_FILTER, subjectId: 'sub-2' });
    assert.deepEqual(names(science.answerKeys), ['Quiz']);
    assert.deepEqual(names(science.classes), ['BSIT 1B']);
    assert.deepEqual(names(science.students), ['Ana Peña']);
    // Every subject stays on offer.
    assert.deepEqual(names(science.subjects), ['Mathematics', 'Science']);

    const firstClass = filterChoices(links, { ...NO_FILTER, classId: 'cls-1' });
    assert.deepEqual(names(firstClass.students), ['Maria Santos', 'Paolo Garcia']);
    const finals = filterChoices(links, { ...NO_FILTER, answerKeyId: 'key-2' });
    assert.deepEqual(names(finals.classes), ['BSIT 1A']);
    assert.deepEqual(names(finals.students), ['Paolo Garcia']);
  });

  it('clears the filters below a changed one when they no longer fit, and keeps those that do', async () => {
    const links = await build().listFilterLinks();
    const start = { subjectId: 'sub-1', answerKeyId: 'key-1', classId: 'cls-1', studentId: 'stu-2' };

    // Another subject: its keys, classes, and students are different.
    assert.deepEqual(setFilter(links, start, 'subjectId', 'sub-2'), { ...NO_FILTER, subjectId: 'sub-2' });
    // "All subjects": everything below still fits.
    assert.deepEqual(setFilter(links, start, 'subjectId', null), { ...start, subjectId: null });
    // Another key of the same subject that the class and student also have.
    assert.deepEqual(setFilter(links, start, 'answerKeyId', 'key-2'), { ...start, answerKeyId: 'key-2' });
    // Another class: the student is not in it.
    assert.deepEqual(setFilter(links, start, 'classId', 'cls-2'), { ...start, classId: 'cls-2', studentId: null });
    // A student alone, then a subject that student has no result in.
    const onlyStudent = setFilter(links, NO_FILTER, 'studentId', 'stu-1');
    assert.deepEqual(onlyStudent, { ...NO_FILTER, studentId: 'stu-1' });
    assert.deepEqual(setFilter(links, onlyStudent, 'subjectId', 'sub-2'), { ...NO_FILTER, subjectId: 'sub-2' });
    // The same value again changes nothing.
    assert.equal(setFilter(links, start, 'classId', 'cls-1'), start);

    assert.equal(hasActiveFilter(NO_FILTER), false);
    assert.equal(hasActiveFilter(onlyStudent), true);
  });

  it('drops a filter whose last result was deleted', async () => {
    const results = build();
    const filter = { ...NO_FILTER, subjectId: 'sub-2', answerKeyId: 'key-3' };
    await results.deleteResult('res-4');
    assert.deepEqual(withoutIncompatible(await results.listFilterLinks(), filter), NO_FILTER);
  });

  it('never changes a filter object it was given', async () => {
    const links = await build().listFilterLinks();
    const start = Object.freeze({ subjectId: 'sub-1', answerKeyId: 'key-1', classId: 'cls-1', studentId: 'stu-2' });
    setFilter(links, start, 'subjectId', 'sub-2');
    assert.deepEqual(start, { subjectId: 'sub-1', answerKeyId: 'key-1', classId: 'cls-1', studentId: 'stu-2' });
  });
});

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

describe('several attempts of one student with one answer key', () => {
  beforeEach(async () => {
    await openSeeded();
    await addResult({ id: 'res-1', capturedAt: at(1), finals: ['A', 'B', 'C', 'D'] });
    await addResult({ id: 'res-2', capturedAt: at(9), finals: ['B', 'B', 'C', 'D'] });
    // Photographed between the two, saved last: numbered by the photo, not by the save.
    await addResult({ id: 'res-3', capturedAt: at(5), createdAt: at(20), finals: [null, 'B', 'C', 'D'] });
    await addResult({ id: 'res-4', key: 'key-2', capturedAt: at(6) });
    await addResult({ id: 'res-5', student: 'stu-2', capturedAt: at(7) });
  });
  const attempts = async (overrides) =>
    Object.fromEntries((await list(overrides)).items.map((item) => [item.id, [item.attempt.number, item.attempt.count]]));

  it('lists every attempt separately, numbered by capture time', async () => {
    assert.deepEqual(ids(await list()), ['res-2', 'res-5', 'res-4', 'res-3', 'res-1']);
    assert.deepEqual(await attempts(), {
      'res-1': [1, 3], 'res-3': [2, 3], 'res-2': [3, 3],
      // Another key, and another student: each its own count.
      'res-4': [1, 1], 'res-5': [1, 1],
    });
    // Each attempt keeps its own score.
    const scores = Object.fromEntries((await list()).items.map((item) => [item.id, item.score]));
    assert.deepEqual([scores['res-1'], scores['res-2'], scores['res-3']], [4, 3, 3]);
  });

  it('keeps an attempt number whatever the list is narrowed to', async () => {
    assert.deepEqual(await attempts({ search: 'maria', limit: 1 }), { 'res-2': [3, 3] });
    assert.deepEqual(await attempts({ filter: { ...NO_FILTER, answerKeyId: 'key-1', studentId: 'stu-1' } }), {
      'res-1': [1, 3], 'res-3': [2, 3], 'res-2': [3, 3],
    });
    assert.deepEqual((await build().getResult('res-3')).result.attempt, { number: 2, count: 3 });
  });

  it('deletes one attempt and leaves the others, renumbered by capture time', async () => {
    const results = build();
    await results.deleteResult('res-3');

    assert.deepEqual(await attempts(), { 'res-1': [1, 2], 'res-2': [2, 2], 'res-4': [1, 1], 'res-5': [1, 1] });
    assert.equal((await results.getResult('res-1')).result.score, 4);
    assert.equal((await results.getResult('res-2')).result.score, 3);
    assert.equal(count('student_answers'), 4 + 4 + 2 + 4);
  });
});

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

describe('result details', () => {
  beforeEach(openSeeded);

  it('returns the complete result: identity, answers in order, and the scan record', async () => {
    const files = fakeFiles();
    await addResult({
      id: 'res-1',
      capturedAt: at(1),
      createdAt: at(2),
      // 1 correct; 2 wrong; 3 left blank; 4 read as unclear and set to D by the Teacher.
      finals: ['A', 'C', null, 'D'],
      detected: { 4: ['unclear', null] },
      files,
    });

    const opened = await build({ files }).getResult('res-1');
    const { answers, ...header } = opened.result;

    assert.deepEqual(header, {
      id: 'res-1', score: 2, total: 4, capturedAt: at(1), createdAt: at(2),
      studentName: 'Maria Santos', studentNumber: '2026-001', className: 'BSIT 1A',
      subjectName: 'Mathematics', answerKeyName: 'Midterm',
      attempt: { number: 1, count: 1 },
      answerKeyId: 'key-1', studentId: 'stu-1', classId: 'cls-1', templateId: 'AC-4-V2',
      imagePath: 'scans/res-1.png',
    });
    assert.deepEqual(answers, [
      { questionNumber: 1, detectedState: 'MARKED', detectedAnswer: 'A', finalAnswer: 'A', correctAnswer: 'A', isCorrect: true, manuallyCorrected: false, confidence: 0.9 },
      { questionNumber: 2, detectedState: 'MARKED', detectedAnswer: 'C', finalAnswer: 'C', correctAnswer: 'B', isCorrect: false, manuallyCorrected: false, confidence: 0.9 },
      { questionNumber: 3, detectedState: 'BLANK', detectedAnswer: null, finalAnswer: null, correctAnswer: 'C', isCorrect: false, manuallyCorrected: false, confidence: 0.9 },
      { questionNumber: 4, detectedState: 'UNCLEAR', detectedAnswer: null, finalAnswer: 'D', correctAnswer: 'D', isCorrect: true, manuallyCorrected: true, confidence: 0.9 },
    ]);
    assert.equal(opened.imageUri, `${DOCUMENTS}scans/res-1.png`);
  });

  it('sums the answers up: correct, incorrect, blank, and manually corrected', async () => {
    await addResult({
      id: 'res-1',
      finals: ['A', 'C', null, 'D'],
      detected: { 2: ['multiple', null], 4: ['marked', 'A'] },
    });
    const { result } = await build().getResult('res-1');
    const tally = tallyAnswers(result.answers);

    assert.deepEqual(tally, { total: 4, correct: 2, incorrect: 1, blank: 1, manuallyCorrected: 2 });
    assert.equal(tally.correct + tally.incorrect + tally.blank, tally.total);
    assert.equal(tally.correct, result.score);
    assert.equal(percentage(result.score, result.total), 50);

    const numbers = (view) => answersInView(result.answers, view).map((answer) => answer.questionNumber);
    assert.deepEqual(numbers('all'), [1, 2, 3, 4]);
    assert.deepEqual(numbers('incorrect'), [2]);
    assert.deepEqual(numbers('blank'), [3]);
    assert.deepEqual(numbers('corrected'), [2, 4]);
  });

  it('keeps answers in question order for a long sheet', async () => {
    const answers = Array.from({ length: 100 }, (_, index) => 'ABCD'[index % 4]);
    t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-9', 'sub-1', 'Long', 100, T0, T0);
    answers.forEach((answer, index) => t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-9', index + 1, answer));
    await addResult({ id: 'res-1', key: 'key-9' });

    const { result } = await build().getResult('res-1');
    assert.deepEqual(result.answers.map((answer) => answer.questionNumber), Array.from({ length: 100 }, (_, i) => i + 1));
    assert.equal(result.score, 100);
  });

  it('returns null for a result that does not exist', async () => {
    assert.equal(await build().getResult('nope'), null);
  });

  it('shows the result without an image when the image is missing, unreadable, or not a scan image', async () => {
    const files = fakeFiles();
    await addResult({ id: 'res-1', files });
    files.store.delete(`${DOCUMENTS}scans/res-1.png`);
    const missing = await build({ files }).getResult('res-1');
    assert.equal(missing.imageUri, null);
    assert.equal(missing.result.answers.length, 4);
    assert.equal(missing.result.score, 4);

    // The file system fails: still the result, no image.
    const broken = fakeFiles();
    broken.fileSystem.exists = async () => {
      throw new Error('EIO');
    };
    assert.equal((await build({ files: broken }).getResult('res-1')).imageUri, null);

    // A stored path that is not a scan image is never turned into a location.
    await addResult({ id: 'res-2', student: 'stu-2', imagePath: '../../databases/answer-checker.db' });
    const outside = fakeFiles({ [`${DOCUMENTS}../../databases/answer-checker.db`]: PNG });
    assert.equal((await build({ files: outside }).getResult('res-2')).imageUri, null);
  });

  it('does not change a result when it is read', async () => {
    await addResult({ id: 'res-1', finals: ['A', 'C', null, 'D'] });
    const before = JSON.stringify([t.all('SELECT * FROM results'), t.all('SELECT * FROM student_answers ORDER BY id'), t.all('SELECT * FROM scan_records')]);
    const results = build();
    await results.getResult('res-1');
    await results.listResults({ filter: NO_FILTER, search: 'maria' });
    await results.countResults(NO_FILTER, '');
    await results.listFilterLinks();
    assert.equal(JSON.stringify([t.all('SELECT * FROM results'), t.all('SELECT * FROM student_answers ORDER BY id'), t.all('SELECT * FROM scan_records')]), before);
    // There is no operation that edits a result.
    assert.deepEqual(Object.keys(results).sort(), [
      'countResults', 'deleteResult', 'getResult', 'listFilterLinks', 'listResults', 'settleInterruptedDeletions',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Historical names
// ---------------------------------------------------------------------------

describe('a result keeps the names it was saved under', () => {
  beforeEach(async () => {
    await openSeeded();
    await addResult({ id: 'res-1', capturedAt: at(1) });
  });
  const identity = async () => {
    const { studentName, studentNumber, className, subjectName, answerKeyName } = (await build().getResult('res-1')).result;
    return { studentName, studentNumber, className, subjectName, answerKeyName };
  };
  const SAVED = {
    studentName: 'Maria Santos', studentNumber: '2026-001', className: 'BSIT 1A',
    subjectName: 'Mathematics', answerKeyName: 'Midterm',
  };

  it('after the student is renamed or given another Student ID', async () => {
    t.run("UPDATE students SET full_name = 'Maria Santos-Reyes', student_number = '2027-900' WHERE id = 'stu-1'");
    assert.deepEqual(await identity(), SAVED);
    assert.deepEqual((await list()).items[0].studentName, 'Maria Santos');
  });

  it('after the student moves to another class', async () => {
    t.run("UPDATE students SET class_id = 'cls-2' WHERE id = 'stu-1'");
    assert.deepEqual(await identity(), SAVED);
    assert.equal((await build().getResult('res-1')).result.classId, 'cls-1');
  });

  it('after the class, the subject, and the answer key are renamed', async () => {
    t.run("UPDATE classes SET name = 'BSIT 2A' WHERE id = 'cls-1'");
    t.run("UPDATE subjects SET name = 'Calculus' WHERE id = 'sub-1'");
    t.run("UPDATE answer_keys SET name = 'Midterm 2026' WHERE id = 'key-1'");
    assert.deepEqual(await identity(), SAVED);
    // It is found by the names it shows.
    assert.deepEqual(ids(await list({ search: 'mathematics' })), ['res-1']);
    assert.deepEqual(ids(await list({ search: 'calculus' })), []);
    // The filters name the records as they are called now.
    const choices = filterChoices(await build().listFilterLinks(), NO_FILTER);
    assert.deepEqual(
      [choices.subjects[0].name, choices.answerKeys[0].name, choices.classes[0].name],
      ['Calculus', 'Midterm 2026', 'BSIT 2A']
    );
    assert.deepEqual(ids(await list({ filter: { ...NO_FILTER, subjectId: 'sub-1' } })), ['res-1']);
  });

  it('and a result saved after a rename carries the new names', async () => {
    t.run("UPDATE classes SET name = 'BSIT 2A' WHERE id = 'cls-1'");
    await addResult({ id: 'res-2', capturedAt: at(2) });
    assert.deepEqual((await list()).items.map((item) => item.className), ['BSIT 2A', 'BSIT 1A']);
  });

  it('writes the names in the same transaction as the result: all or nothing', async () => {
    // The scan record of res-1 exists; a second one with the same id makes the save fail at its last step.
    await assert.rejects(
      createSqliteResultRepository(t.db).save({
        id: 'res-9', answerKeyId: 'key-2', studentId: 'stu-2', classId: 'cls-1',
        studentName: 'Paolo Garcia', studentNumber: '2026-002', className: 'BSIT 1A',
        subjectName: 'Mathematics', answerKeyName: 'Finals',
        score: 0, total: 2, templateId: 'AC-2-V2', capturedAt: at(3), createdAt: at(3),
        answers: [], scanRecordId: 'scn-res-1', imagePath: 'scans/res-9.png',
      }),
      (error) => error.code === 'DATABASE_ERROR'
    );
    assert.equal(count('results'), 1);
  });
});

// ---------------------------------------------------------------------------
// The image store
// ---------------------------------------------------------------------------

describe('scan image paths', () => {
  // No database is needed; a throwaway one keeps the shared afterEach simple.
  beforeEach(() => {
    t = openTestDatabase();
  });

  it('accepts only a file directly inside the scans folder', () => {
    assert.equal(scanImageFileName('scans/res-1.png'), 'res-1.png');
    assert.equal(scanImageFileName('scans/0b1e6c2a-7d3f-4c55-9a51-1f0e8c2d4b6a.png'), '0b1e6c2a-7d3f-4c55-9a51-1f0e8c2d4b6a.png');
    for (const path of [
      '', 'scans/', 'scans/res-1.jpg', 'scans/res-1', 'res-1.png', '/scans/res-1.png',
      'scans/../res-1.png', 'scans/a/../../res-1.png', '../scans/res-1.png', 'scans/sub/res-1.png',
      'scans\\res-1.png', 'scans/res-1.png/', 'scans/..png', 'scans/.hidden.png', 'scans/a b.png',
      'file:///storage/emulated/0/DCIM/photo.png', `${DOCUMENTS}scans/res-1.png`,
      'scans-deleting/res-1.png', 'SQLite/answer-checker.db', 'scans/res-1.png\n',
    ]) {
      assert.equal(scanImageFileName(path), null, JSON.stringify(path));
    }
  });
});

describe('result image store', () => {
  beforeEach(() => {
    t = openTestDatabase();
  });
  const FINAL = `${DOCUMENTS}scans/res-1.png`;
  const STAGED = `${DOCUMENTS}scans-deleting/res-1.png`;

  it('stages, restores, and discards an image inside the app only', async () => {
    const files = fakeFiles({ [FINAL]: PNG });
    const store = createResultImageStore(files.fileSystem);

    const staged = await store.stage('scans/res-1.png');
    assert.deepEqual([...files.store.keys()], [STAGED]);
    await store.restore(staged);
    assert.deepEqual([...files.store.keys()], [FINAL]);
    await store.discard(await store.stage('scans/res-1.png'));
    assert.equal(files.store.size, 0);
    assert.deepEqual(files.log.deleted, [STAGED]);
  });

  it('has nothing to stage when the image is missing', async () => {
    const files = fakeFiles();
    assert.equal(await createResultImageStore(files.fileSystem).stage('scans/res-1.png'), null);
    assert.deepEqual([files.log.moved, files.log.deleted], [[], []]);
  });

  it('never moves, shows, or deletes a path outside the scans folder', async () => {
    const outside = {
      [`${DOCUMENTS}SQLite/answer-checker.db`]: PNG,
      [`${DOCUMENTS}../cache/Answer sheet - 10 questions.pdf`]: PNG,
      [`${CACHE}DocumentPicker/roster.csv`]: PNG,
      'file:///storage/emulated/0/DCIM/Camera/IMG_0001.jpg': PNG,
    };
    const files = fakeFiles(outside);
    const store = createResultImageStore(files.fileSystem);
    for (const path of [
      'SQLite/answer-checker.db', '../cache/Answer sheet - 10 questions.pdf', 'scans/../SQLite/answer-checker.db',
      `${CACHE}DocumentPicker/roster.csv`, 'file:///storage/emulated/0/DCIM/Camera/IMG_0001.jpg',
    ]) {
      assert.equal(await store.stage(path), null, path);
      assert.equal(await store.displayUri(path), null, path);
      await store.restore({ imagePath: path });
      await store.discard({ imagePath: path });
    }
    assert.deepEqual(Object.keys(outside), [...files.store.keys()]);
    assert.deepEqual([files.log.moved, files.log.deleted], [[], []]);
  });

  it('settles staged files: restores one whose result still exists, deletes the rest, touches nothing else', async () => {
    const files = fakeFiles({
      // Staged, and the deletion never reached the database.
      [`${DOCUMENTS}scans-deleting/kept.png`]: PNG,
      // Staged, and the result is gone.
      [`${DOCUMENTS}scans-deleting/gone.png`]: PNG,
      // Staged, but the result has its image again: the staged copy is the leftover.
      [`${DOCUMENTS}scans-deleting/both.png`]: PNG,
      [`${DOCUMENTS}scans/both.png`]: PNG,
      // Not ours to judge: an odd name, a nested file, and ordinary app files.
      [`${DOCUMENTS}scans-deleting/notes.txt`]: PNG,
      [`${DOCUMENTS}scans-deleting/sub/deep.png`]: PNG,
      [`${DOCUMENTS}scans/other.png`]: PNG,
      [`${DOCUMENTS}SQLite/answer-checker.db`]: PNG,
    });
    await createResultImageStore(files.fileSystem).settleStaged(['scans/kept.png', 'scans/both.png', 'scans/other.png']);

    assert.deepEqual([...files.store.keys()].sort(), [
      `${DOCUMENTS}SQLite/answer-checker.db`,
      `${DOCUMENTS}scans-deleting/notes.txt`,
      `${DOCUMENTS}scans-deleting/sub/deep.png`,
      `${DOCUMENTS}scans/both.png`,
      `${DOCUMENTS}scans/kept.png`,
      `${DOCUMENTS}scans/other.png`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Permanent deletion
// ---------------------------------------------------------------------------

describe('deleting a result permanently', () => {
  let files;
  beforeEach(async () => {
    await openSeeded();
    files = fakeFiles();
    await addResult({ id: 'res-1', capturedAt: at(1), files });
    await addResult({ id: 'res-2', student: 'stu-2', capturedAt: at(2), files });
    await addResult({ id: 'res-3', capturedAt: at(3), files });
  });
  const image = (id) => `${DOCUMENTS}scans/${id}.png`;
  const rowsOf = (id) => [
    t.get('SELECT COUNT(*) AS n FROM results WHERE id = ?', id).n,
    t.get('SELECT COUNT(*) AS n FROM student_answers WHERE result_id = ?', id).n,
    t.get('SELECT COUNT(*) AS n FROM scan_records WHERE result_id = ?', id).n,
  ];

  it('removes the result, its answers, its scan record, and its image, and nothing else', async () => {
    await build({ files }).deleteResult('res-1');

    assert.deepEqual(rowsOf('res-1'), [0, 0, 0]);
    assert.deepEqual([rowsOf('res-2'), rowsOf('res-3')], [[1, 4, 1], [1, 4, 1]]);
    assert.deepEqual([...files.store.keys()].sort(), [image('res-2'), image('res-3')]);
    // Physically gone: no flag, no copy, no row left anywhere.
    assert.equal(JSON.stringify(t.all('SELECT * FROM results')).includes('res-1'), false);
    assert.deepEqual(files.log.deleted, [`${DOCUMENTS}scans-deleting/res-1.png`]);
    assert.equal(await build({ files }).getResult('res-1'), null);
    assert.deepEqual(ids(await build({ files }).listResults({ filter: NO_FILTER, search: '' })), ['res-3', 'res-2']);
    assert.deepEqual(t.all('PRAGMA foreign_key_check'), []);
  });

  it('deletes a result whose image is already missing', async () => {
    files.store.delete(image('res-1'));
    await build({ files }).deleteResult('res-1');
    assert.deepEqual(rowsOf('res-1'), [0, 0, 0]);
    assert.deepEqual([files.log.moved, files.log.deleted], [[], []]);
  });

  it('deletes a result whose stored path is not a scan image, and leaves that file alone', async () => {
    const database = `${DOCUMENTS}../databases/answer-checker.db`;
    files.store.set(database, PNG);
    await addResult({ id: 'res-9', student: 'stu-3', key: 'key-3', imagePath: '../databases/answer-checker.db' });

    await build({ files }).deleteResult('res-9');

    assert.deepEqual(rowsOf('res-9'), [0, 0, 0]);
    assert.ok(files.store.has(database));
    assert.deepEqual([files.log.moved, files.log.deleted], [[], []]);
  });

  it('reports a result that does not exist, and deletes nothing', async () => {
    await assert.rejects(build({ files }).deleteResult('nope'), (error) => {
      assert.ok(error instanceof ResultNotFoundError);
      assert.equal(error.code, 'NOT_FOUND');
      return true;
    });
    assert.equal(count('results'), 3);
    assert.equal(files.store.size, 3);
  });

  it('survives a double submission: the second finds nothing and harms nothing', async () => {
    const results = build({ files });
    const outcomes = await Promise.allSettled([results.deleteResult('res-1'), results.deleteResult('res-1')]);
    assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ['fulfilled', 'rejected']);
    assert.ok(outcomes.find((outcome) => outcome.status === 'rejected').reason instanceof ResultNotFoundError);
    await assert.rejects(results.deleteResult('res-1'), ResultNotFoundError);

    assert.deepEqual([rowsOf('res-2'), rowsOf('res-3')], [[1, 4, 1], [1, 4, 1]]);
    assert.deepEqual([...files.store.keys()].sort(), [image('res-2'), image('res-3')]);
  });

  it('changes nothing when the image cannot be set aside', async () => {
    const stuck = fakeFiles(Object.fromEntries(files.store), { failMove: () => true });
    await assert.rejects(build({ files: stuck }).deleteResult('res-1'), (error) => {
      assert.ok(error instanceof ResultImageError);
      assert.equal(error.code, 'FILE_ERROR');
      // The device's own message does not reach the Teacher.
      assert.doesNotMatch(error.message, /EXDEV|raw/);
      return true;
    });
    assert.deepEqual(rowsOf('res-1'), [1, 4, 1]);
    assert.ok(stuck.store.has(image('res-1')));
    assert.equal(stuck.store.size, 3);
  });

  it('puts the image back when the database deletion fails', async () => {
    const failing = {
      ...t.db,
      runAsync: async (sql, params) => {
        if (/^DELETE FROM results/.test(sql)) throw new Error('disk I/O error');
        return t.db.runAsync(sql, params);
      },
    };
    await assert.rejects(build({ files, db: failing }).deleteResult('res-1'), (error) => {
      assert.equal(error.code, 'DATABASE_ERROR');
      assert.doesNotMatch(error.message, /disk I\/O/);
      return true;
    });

    // The answers and scan record deleted before the failure are back: one transaction.
    assert.deepEqual(rowsOf('res-1'), [1, 4, 1]);
    assert.deepEqual([...files.store.keys()].sort(), [image('res-1'), image('res-2'), image('res-3')]);
    assert.deepEqual(files.log.moved, [
      [image('res-1'), `${DOCUMENTS}scans-deleting/res-1.png`],
      [`${DOCUMENTS}scans-deleting/res-1.png`, image('res-1')],
    ]);
    // And it can be deleted afterwards.
    await build({ files }).deleteResult('res-1');
    assert.deepEqual(rowsOf('res-1'), [0, 0, 0]);
  });

  it('when even the restore fails, the next settling gives the result its image back', async () => {
    let moves = 0;
    const flaky = fakeFiles(Object.fromEntries(files.store), { failMove: () => ++moves === 2 });
    const failing = {
      ...t.db,
      runAsync: async (sql, params) => {
        if (/^DELETE FROM results/.test(sql)) throw new Error('disk I/O error');
        return t.db.runAsync(sql, params);
      },
    };
    await assert.rejects(build({ files: flaky, db: failing }).deleteResult('res-1'), (error) => error.code === 'DATABASE_ERROR');
    assert.deepEqual(rowsOf('res-1'), [1, 4, 1]);
    assert.ok(flaky.store.has(`${DOCUMENTS}scans-deleting/res-1.png`));
    // Meanwhile the result is complete and shown without its image.
    assert.equal((await build({ files: flaky }).getResult('res-1')).imageUri, null);

    await build({ files: flaky }).settleInterruptedDeletions();

    assert.ok(flaky.store.has(image('res-1')));
    assert.equal((await build({ files: flaky }).getResult('res-1')).imageUri, image('res-1'));
  });

  it('keeps the result deleted when the staged image cannot be destroyed, and removes it next time', async () => {
    let failing = true;
    const sticky = fakeFiles(Object.fromEntries(files.store), { failDelete: () => failing });

    await build({ files: sticky }).deleteResult('res-1');

    assert.deepEqual(rowsOf('res-1'), [0, 0, 0]);
    const leftover = `${DOCUMENTS}scans-deleting/res-1.png`;
    assert.ok(sticky.store.has(leftover));
    assert.ok(!sticky.store.has(image('res-1')));

    // Settling never throws, even while the file still cannot be deleted.
    await build({ files: sticky }).settleInterruptedDeletions();
    assert.ok(sticky.store.has(leftover));
    failing = false;
    await build({ files: sticky }).settleInterruptedDeletions();
    assert.deepEqual([...sticky.store.keys()].sort(), [image('res-2'), image('res-3')]);
    // The result was never brought back.
    assert.equal(count('results'), 2);
  });

  it('settling does nothing when nothing was interrupted, and never fails', async () => {
    await build({ files }).settleInterruptedDeletions();
    assert.equal(files.store.size, 3);
    assert.deepEqual([files.log.moved, files.log.deleted], [[], []]);

    const broken = fakeFiles();
    broken.fileSystem.listFiles = async () => {
      throw new Error('EIO');
    };
    await build({ files: broken }).settleInterruptedDeletions();
  });
});

// ---------------------------------------------------------------------------
// What a deletion releases
// ---------------------------------------------------------------------------

describe('deleting results releases the records they blocked', () => {
  let results;
  let students;
  let keys;
  let classes;
  let subjects;

  beforeEach(async () => {
    await openSeeded();
    // The only student of BSIT 1B, scanned twice with the only key of Science.
    await addResult({ id: 'res-1', student: 'stu-3', key: 'key-3', capturedAt: at(1) });
    await addResult({ id: 'res-2', student: 'stu-3', key: 'key-3', capturedAt: at(2) });
    results = build();
    students = createSqliteStudentRepository(t.db);
    keys = createSqliteAnswerKeyRepository(t.db);
    classes = createSqliteClassRepository(t.db);
    subjects = createSqliteSubjectRepository(t.db);
  });

  it('keeps the student, the answer key, and the class blocked while one result remains', async () => {
    await results.deleteResult('res-1');

    await assert.rejects(students.delete('stu-3'), (error) => {
      assert.ok(error instanceof StudentInUseError);
      assert.equal(error.resultCount, 1);
      return true;
    });
    await assert.rejects(keys.delete('key-3'), (error) => {
      assert.ok(error instanceof AnswerKeyInUseError);
      assert.equal(error.resultCount, 1);
      return true;
    });
    await assert.rejects(classes.delete('cls-2'), (error) => {
      assert.ok(error instanceof ClassInUseError);
      assert.deepEqual([error.studentCount, error.resultCount], [1, 1]);
      return true;
    });
  });

  it('releases them, in order, once the last result is gone', async () => {
    await results.deleteResult('res-1');
    await results.deleteResult('res-2');

    // The class is still blocked by its student, and by nothing else.
    await assert.rejects(classes.delete('cls-2'), (error) => {
      assert.ok(error instanceof ClassInUseError);
      assert.deepEqual([error.studentCount, error.resultCount], [1, 0]);
      return true;
    });
    // The subject is blocked by its answer key, as before: results never blocked it directly.
    await assert.rejects(subjects.delete('sub-2'), (error) => {
      assert.ok(error instanceof SubjectInUseError);
      assert.equal(error.answerKeyCount, 1);
      return true;
    });

    await students.delete('stu-3');
    await classes.delete('cls-2');
    await keys.delete('key-3');
    await subjects.delete('sub-2');
    assert.deepEqual(
      [count('students'), count('classes'), count('answer_keys'), count('subjects')],
      [2, 1, 2, 1]
    );
  });

  it('releases a class by the class of the scan, not by where the student is now', async () => {
    // Maria is scanned in BSIT 1A, then moves to BSIT 1B with Paolo.
    await addResult({ id: 'res-3', student: 'stu-1', key: 'key-1', capturedAt: at(3) });
    t.run("UPDATE students SET class_id = 'cls-2' WHERE id IN ('stu-1', 'stu-2')");

    await assert.rejects(classes.delete('cls-1'), (error) => {
      assert.ok(error instanceof ClassInUseError);
      assert.deepEqual([error.studentCount, error.resultCount], [0, 1]);
      return true;
    });
    await results.deleteResult('res-3');
    await classes.delete('cls-1');
    assert.equal(count('classes'), 1);
  });

  it('unlocks the answer key for editing again', async () => {
    assert.equal(await keys.countResults('key-3'), 2);
    await results.deleteResult('res-1');
    await results.deleteResult('res-2');
    assert.equal(await keys.countResults('key-3'), 0);
  });
});
