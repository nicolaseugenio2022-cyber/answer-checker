// Verifies Home's read model: the counts, "scanned today" on the phone's local
// day, the recent results and answer keys, the "Continue scanning" session,
// where each Home control leads, and that only the newest reading is kept.
// Uses Node's built-in SQLite on disposable databases; nothing here touches a
// device.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { initializeDatabase } from '../../src/core/infrastructure/database/initialize-database.ts';
import { createLatestRequest } from '../../src/core/presentation/lib/latest-request.ts';
import { requestIntent, takeIntent } from '../../src/core/presentation/navigation/screen-intent.ts';
import { createSqliteAnswerKeyRepository } from '../../src/features/answer-keys/infrastructure/sqlite-answer-key-repository.ts';
import { createSqliteClassSubjectRepository } from '../../src/features/class-subjects/infrastructure/sqlite-class-subject-repository.ts';
import { createSqliteClassRepository } from '../../src/features/classes/infrastructure/sqlite-class-repository.ts';
import { createDashboardUseCases } from '../../src/features/dashboard/application/dashboard-use-cases.ts';
import { RECENT_LIMIT, localDayRange } from '../../src/features/dashboard/domain/dashboard.ts';
import { createSqliteDashboardRepository } from '../../src/features/dashboard/infrastructure/sqlite-dashboard-repository.ts';
import {
  HOME_LINKS,
  openResultIntent,
  viewAnswerKeyIntent,
} from '../../src/features/dashboard/presentation/home-links.ts';
import { createResultsUseCases } from '../../src/features/results/application/results-use-cases.ts';
import { createSqliteResultsRepository } from '../../src/features/results/infrastructure/sqlite-results-repository.ts';
import { createScanUseCases } from '../../src/features/scan/application/scan-use-cases.ts';
import { EMPTY_SELECTION } from '../../src/features/scan/domain/selection.ts';
import { createSqliteResultRepository } from '../../src/features/scan/infrastructure/sqlite-result-repository.ts';
import { createStudentUseCases } from '../../src/features/students/application/student-use-cases.ts';
import { createSqliteStudentRepository } from '../../src/features/students/infrastructure/sqlite-student-repository.ts';
import { createSqliteSubjectRepository } from '../../src/features/subjects/infrastructure/sqlite-subject-repository.ts';
import { openTestDatabase } from '../database/test-database.mjs';

// Noon on the phone, whatever its time zone, so the local day is unambiguous.
const NOW = new Date(2026, 9, 2, 12, 0, 0);
const TODAY = localDayRange(NOW);
const T0 = NOW.toISOString();
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

let t;

beforeEach(async () => {
  t = openTestDatabase();
  await initializeDatabase(t.db);
});

afterEach(() => {
  t.close();
});

const count = (table) => t.get(`SELECT COUNT(*) AS n FROM ${table}`).n;

function build({ db = t.db, now = () => NOW } = {}) {
  return createDashboardUseCases({ repository: createSqliteDashboardRepository(db), now });
}

/**
 * Mathematics (sub-1) with Midterm (key-1) and Finals (key-2); Science (sub-2)
 * with Quiz (key-3). BSIT 1A (cls-1): Maria, Paolo. BSIT 1B (cls-2): Ana.
 * Mathematics is taught to both classes, Science to BSIT 1B.
 */
function seedRecords() {
  for (const [id, name] of [['sub-1', 'Mathematics'], ['sub-2', 'Science']]) {
    t.run('INSERT INTO subjects VALUES (?, ?, ?, ?)', id, name, T0, T0);
  }
  for (const [id, name] of [['cls-1', 'BSIT 1A'], ['cls-2', 'BSIT 1B']]) {
    t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', id, name, T0, T0);
  }
  for (const [classId, subjectId] of [['cls-1', 'sub-1'], ['cls-2', 'sub-1'], ['cls-2', 'sub-2']]) {
    t.run('INSERT INTO class_subjects VALUES (?, ?, ?)', classId, subjectId, T0);
  }
  for (const [id, classId, number, name] of [
    ['stu-1', 'cls-1', '2026-001', 'Maria Santos'],
    ['stu-2', 'cls-1', '2026-002', 'Paolo Garcia'],
    ['stu-3', 'cls-2', '2026-003', 'Ana Reyes'],
  ]) {
    t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', id, classId, number, name, T0, T0);
  }
  addKey('key-1', 'sub-1', 'Midterm', ['A', 'B', 'C', 'D'], minutesAgo(300));
  addKey('key-2', 'sub-1', 'Finals', ['A', 'A'], minutesAgo(200));
  addKey('key-3', 'sub-2', 'Quiz', ['B', 'C'], minutesAgo(100));
}

function addKey(id, subjectId, name, answers, updatedAt, createdAt = updatedAt) {
  t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', id, subjectId, name, answers.length, createdAt, updatedAt);
  answers.forEach((answer, index) => t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', id, index + 1, answer));
}

/** Saves a result the way Scan does, with the names its records have right now. */
async function addResult({ id, key = 'key-1', student = 'stu-1', capturedAt = T0, createdAt = capturedAt, score }) {
  const row = t.get(
    `SELECT st.full_name, st.student_number, st.class_id, c.name AS class_name, s.name AS subject_name, k.name AS key_name
       FROM students st JOIN classes c ON c.id = st.class_id, answer_keys k JOIN subjects s ON s.id = k.subject_id
      WHERE st.id = ? AND k.id = ?`,
    student,
    key
  );
  const correct = t.all('SELECT correct_answer FROM answer_key_items WHERE answer_key_id = ? ORDER BY question_number', key).map((r) => r.correct_answer);
  const right = score ?? correct.length;
  const answers = correct.map((correctAnswer, index) => ({
    questionNumber: index + 1,
    detectedState: index < right ? 'marked' : 'blank',
    detectedAnswer: index < right ? correctAnswer : null,
    finalAnswer: index < right ? correctAnswer : null,
    correctAnswer,
    isCorrect: index < right,
    wasCorrected: false,
    confidence: 0.9,
  }));
  await createSqliteResultRepository(t.db).save({
    id, answerKeyId: key, studentId: student, classId: row.class_id,
    studentName: row.full_name, studentNumber: row.student_number, className: row.class_name,
    subjectName: row.subject_name, answerKeyName: row.key_name,
    score: right, total: answers.length, templateId: `AC-${answers.length}-V2`,
    capturedAt, createdAt, answers, scanRecordId: `scn-${id}`, imagePath: `scans/${id}.png`,
  });
}

const results = () =>
  createResultsUseCases({
    repository: createSqliteResultsRepository(t.db),
    images: { displayUri: async () => null, stage: async () => null, restore: async () => {}, discard: async () => {}, settleStaged: async () => {} },
  });

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

describe('dashboard counts', () => {
  it('are all zero on an empty database, with nothing recent', async () => {
    assert.deepEqual(await build().getDashboard(), {
      counts: { students: 0, classes: 0, answerKeys: 0, results: 0, scannedToday: 0 },
      recentResults: [],
      recentAnswerKeys: [],
      lastScan: null,
      isIncomplete: false,
    });
  });

  it('count the students, classes, answer keys, and results that are stored', async () => {
    seedRecords();
    await addResult({ id: 'res-1', capturedAt: minutesAgo(10) });
    await addResult({ id: 'res-2', student: 'stu-2', capturedAt: minutesAgo(5) });

    assert.deepEqual((await build().getDashboard()).counts, {
      students: 3, classes: 2, answerKeys: 3, results: 2, scannedToday: 2,
    });
  });

  it('count every attempt of one student as a separate result', async () => {
    seedRecords();
    await addResult({ id: 'res-1', capturedAt: minutesAgo(30) });
    await addResult({ id: 'res-2', capturedAt: minutesAgo(20) });
    await addResult({ id: 'res-3', capturedAt: minutesAgo(10) });
    const { counts } = await build().getDashboard();
    assert.deepEqual([counts.results, counts.scannedToday], [3, 3]);
  });

  it('follow an imported roster', async () => {
    seedRecords();
    let ids = 0;
    const students = createStudentUseCases({
      repository: createSqliteStudentRepository(t.db),
      classRepository: createSqliteClassRepository(t.db),
      rosterFilePicker: { pick: async () => null },
      clock: { now: () => T0 },
      idGenerator: { newId: () => `new-${++ids}` },
    });
    await students.importStudents([
      { studentNumber: '2026-101', fullName: 'Liza Mendoza', classId: 'cls-1' },
      { studentNumber: '2026-102', fullName: 'Jose Dela Cruz', classId: 'cls-2' },
    ]);
    assert.equal((await build().getDashboard()).counts.students, 5);
  });

  it('drop a record as soon as it is permanently deleted', async () => {
    seedRecords();
    await addResult({ id: 'res-1', student: 'stu-3', key: 'key-3', capturedAt: minutesAgo(5) });
    const home = build();
    assert.deepEqual((await home.getDashboard()).counts, { students: 3, classes: 2, answerKeys: 3, results: 1, scannedToday: 1 });

    await results().deleteResult('res-1');
    assert.deepEqual((await home.getDashboard()).counts, { students: 3, classes: 2, answerKeys: 3, results: 0, scannedToday: 0 });

    await createSqliteStudentRepository(t.db).delete('stu-3');
    await createSqliteClassRepository(t.db).delete('cls-2');
    await createSqliteAnswerKeyRepository(t.db).delete('key-3');
    assert.deepEqual((await home.getDashboard()).counts, { students: 2, classes: 1, answerKeys: 2, results: 0, scannedToday: 0 });
  });

  it('handle large numbers', async () => {
    seedRecords();
    t.raw.exec('BEGIN');
    const insert = t.raw.prepare('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)');
    for (let index = 0; index < 2500; index++) insert.run(`bulk-${index}`, 'cls-1', `B-${index}`, `Student ${index}`, T0, T0);
    t.raw.exec('COMMIT');
    assert.equal((await build().getDashboard()).counts.students, 2503);
  });
});

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

describe('scanned today', () => {
  it('is the local calendar day: from local midnight to the next local midnight', () => {
    for (const now of [NOW, new Date(2026, 0, 1, 0, 0, 0), new Date(2026, 11, 31, 23, 59, 59, 999), new Date(2026, 2, 8, 3, 30)]) {
      const { start, end } = localDayRange(now);
      const from = new Date(start);
      const to = new Date(end);
      // Both ends are midnight on the phone's clock, on consecutive dates.
      assert.deepEqual([from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds()], [0, 0, 0, 0]);
      assert.deepEqual([to.getHours(), to.getMinutes(), to.getSeconds(), to.getMilliseconds()], [0, 0, 0, 0]);
      assert.deepEqual([from.getFullYear(), from.getMonth(), from.getDate()], [now.getFullYear(), now.getMonth(), now.getDate()]);
      assert.ok(from <= now && now < to);
      const hours = (to - from) / 3_600_000;
      assert.ok(hours >= 23 && hours <= 25, `${hours} hours`);
      // Stored form: UTC ISO-8601, as every timestamp in the database.
      assert.match(start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    // The last instant of a day and the first of the next are different days.
    const late = localDayRange(new Date(2026, 9, 2, 23, 59, 59, 999));
    const early = localDayRange(new Date(2026, 9, 3, 0, 0, 0, 0));
    assert.equal(late.end, early.start);
  });

  it('counts a result from the first instant of the day to the last, and no other', async () => {
    seedRecords();
    const start = Date.parse(TODAY.start);
    const end = Date.parse(TODAY.end);
    const at = (ms) => new Date(ms).toISOString();
    await addResult({ id: 'yesterday-last', student: 'stu-1', key: 'key-1', capturedAt: at(start - 1) });
    await addResult({ id: 'today-first', student: 'stu-2', key: 'key-1', capturedAt: at(start) });
    await addResult({ id: 'today-last', student: 'stu-3', key: 'key-1', capturedAt: at(end - 1) });
    await addResult({ id: 'tomorrow-first', student: 'stu-1', key: 'key-2', capturedAt: at(end) });

    const { counts } = await build().getDashboard();
    assert.deepEqual([counts.results, counts.scannedToday], [4, 2]);
  });

  it('goes by when the photo was taken, not when the result was saved', async () => {
    seedRecords();
    const yesterday = new Date(Date.parse(TODAY.start) - 60_000).toISOString();
    await addResult({ id: 'res-1', capturedAt: yesterday, createdAt: T0 });
    assert.equal((await build().getDashboard()).counts.scannedToday, 0);
  });

  it('moves on when the day does', async () => {
    seedRecords();
    await addResult({ id: 'res-1', capturedAt: minutesAgo(5) });
    assert.equal((await build().getDashboard()).counts.scannedToday, 1);
    const tomorrow = new Date(2026, 9, 3, 8, 0, 0);
    assert.equal((await build({ now: () => tomorrow }).getDashboard()).counts.scannedToday, 0);
    assert.equal((await build({ now: () => tomorrow }).getDashboard()).counts.results, 1);
  });
});

// ---------------------------------------------------------------------------
// Recent results
// ---------------------------------------------------------------------------

describe('recent results', () => {
  beforeEach(seedRecords);

  it('are the three newest, newest first by capture time, then save time, then id', async () => {
    await addResult({ id: 'res-a', student: 'stu-1', key: 'key-1', capturedAt: minutesAgo(50) });
    await addResult({ id: 'res-b', student: 'stu-2', key: 'key-1', capturedAt: minutesAgo(10) });
    await addResult({ id: 'res-c', student: 'stu-3', key: 'key-1', capturedAt: minutesAgo(30), createdAt: minutesAgo(29) });
    await addResult({ id: 'res-d', student: 'stu-2', key: 'key-2', capturedAt: minutesAgo(30), createdAt: minutesAgo(20) });
    await addResult({ id: 'res-e', student: 'stu-3', key: 'key-2', capturedAt: minutesAgo(30), createdAt: minutesAgo(20) });

    const { recentResults } = await build().getDashboard();
    assert.equal(RECENT_LIMIT, 3);
    assert.deepEqual(recentResults.map((result) => result.id), ['res-b', 'res-e', 'res-d']);
  });

  it('show the names the result was saved under, the score, and the capture time', async () => {
    await addResult({ id: 'res-1', capturedAt: minutesAgo(10), createdAt: minutesAgo(9), score: 3 });
    assert.deepEqual((await build().getDashboard()).recentResults, [
      {
        id: 'res-1', studentName: 'Maria Santos', studentNumber: '2026-001', answerKeyName: 'Midterm',
        score: 3, total: 4, capturedAt: minutesAgo(10), attempt: { number: 1, count: 1 },
      },
    ]);
  });

  it('number attempts by capture time and keep them separate', async () => {
    await addResult({ id: 'res-1', capturedAt: minutesAgo(40), score: 1 });
    await addResult({ id: 'res-2', capturedAt: minutesAgo(20), score: 4 });
    await addResult({ id: 'res-3', student: 'stu-2', capturedAt: minutesAgo(30) });
    const { recentResults } = await build().getDashboard();
    assert.deepEqual(
      recentResults.map((result) => [result.id, result.attempt.number, result.attempt.count, result.score]),
      [['res-2', 2, 2, 4], ['res-3', 1, 1, 4], ['res-1', 1, 2, 1]]
    );
  });

  it('keep their names when the student moves or records are renamed', async () => {
    await addResult({ id: 'res-1', capturedAt: minutesAgo(10) });
    t.run("UPDATE students SET class_id = 'cls-2', full_name = 'Maria S. Reyes', student_number = '2027-900' WHERE id = 'stu-1'");
    t.run("UPDATE answer_keys SET name = 'Midterm 2026' WHERE id = 'key-1'");
    t.run("UPDATE classes SET name = 'BSIT 2A' WHERE id = 'cls-1'");
    t.run("UPDATE subjects SET name = 'Calculus' WHERE id = 'sub-1'");

    const home = await build().getDashboard();
    const [recent] = home.recentResults;
    assert.deepEqual([recent.studentName, recent.studentNumber, recent.answerKeyName], ['Maria Santos', '2026-001', 'Midterm']);
    // The class a result shows is the one stored with it, unchanged by the move.
    assert.equal((await results().getResult('res-1')).result.className, 'BSIT 1A');
    // "Continue scanning" names the records as they are called now, and the class of the scan.
    assert.deepEqual(home.lastScan, {
      subjectId: 'sub-1', subjectName: 'Calculus', answerKeyId: 'key-1', answerKeyName: 'Midterm 2026',
      classId: 'cls-1', className: 'BSIT 2A',
    });
  });

  it('lose a result that is permanently deleted, and bring the next one in', async () => {
    for (const [index, student] of ['stu-1', 'stu-2', 'stu-3'].entries()) {
      await addResult({ id: `res-${index + 1}`, student, capturedAt: minutesAgo(40 - index * 10) });
    }
    await addResult({ id: 'res-4', student: 'stu-1', key: 'key-2', capturedAt: minutesAgo(5) });
    const home = build();
    assert.deepEqual((await home.getDashboard()).recentResults.map((r) => r.id), ['res-4', 'res-3', 'res-2']);

    await results().deleteResult('res-3');

    const after = await home.getDashboard();
    assert.deepEqual(after.recentResults.map((r) => r.id), ['res-4', 'res-2', 'res-1']);
    assert.equal(after.counts.results, 3);
  });

  it('do not read answers or images', async () => {
    await addResult({ id: 'res-1', capturedAt: minutesAgo(10) });
    const statements = [];
    const recording = {
      ...t.db,
      getAllAsync: (sql, params) => (statements.push(sql), t.db.getAllAsync(sql, params)),
      getFirstAsync: (sql, params) => (statements.push(sql), t.db.getFirstAsync(sql, params)),
    };
    await build({ db: recording }).getDashboard();
    assert.ok(statements.every((sql) => !/student_answers|scan_records|image_path/.test(sql)));
  });
});

// ---------------------------------------------------------------------------
// Recent answer keys
// ---------------------------------------------------------------------------

describe('recent answer keys', () => {
  beforeEach(seedRecords);

  it('are the three created or changed most recently, newest first', async () => {
    addKey('key-4', 'sub-2', 'Unit test', ['A'], minutesAgo(400));
    const { recentAnswerKeys } = await build().getDashboard();
    assert.deepEqual(recentAnswerKeys, [
      { id: 'key-3', name: 'Quiz', subjectName: 'Science', questionCount: 2, updatedAt: minutesAgo(100) },
      { id: 'key-2', name: 'Finals', subjectName: 'Mathematics', questionCount: 2, updatedAt: minutesAgo(200) },
      { id: 'key-1', name: 'Midterm', subjectName: 'Mathematics', questionCount: 4, updatedAt: minutesAgo(300) },
    ]);
  });

  it('move a key to the top when it is edited', async () => {
    let ticks = 0;
    const { createAnswerKeyUseCases } = await import('../../src/features/answer-keys/application/answer-key-use-cases.ts');
    const keys = createAnswerKeyUseCases({
      repository: createSqliteAnswerKeyRepository(t.db),
      clock: { now: () => new Date(NOW.getTime() + 1000 * ++ticks).toISOString() },
      idGenerator: { newId: () => `key-new-${ticks}` },
    });
    await keys.updateAnswerKey('key-1', { name: 'Midterm (revised)', subjectId: 'sub-1', questionCount: 4, answers: ['A', 'B', 'C', 'D'] });
    assert.deepEqual((await build().getDashboard()).recentAnswerKeys.map((key) => key.name), ['Midterm (revised)', 'Quiz', 'Finals']);

    await keys.createAnswerKey({ name: 'Brand new', subjectId: 'sub-2', questionCount: 1, answers: ['D'] });
    assert.deepEqual((await build().getDashboard()).recentAnswerKeys.map((key) => key.name), ['Brand new', 'Midterm (revised)', 'Quiz']);
  });

  it('break a tie by creation time, then id, the same way every time', async () => {
    t.run('DELETE FROM answer_key_items');
    t.run('DELETE FROM answer_keys');
    addKey('key-b', 'sub-1', 'B', ['A'], T0, minutesAgo(10));
    addKey('key-a', 'sub-1', 'A', ['A'], T0, minutesAgo(10));
    addKey('key-c', 'sub-1', 'C', ['A'], T0, minutesAgo(5));
    const order = async () => (await build().getDashboard()).recentAnswerKeys.map((key) => key.id);
    assert.deepEqual(await order(), ['key-c', 'key-b', 'key-a']);
    assert.deepEqual(await order(), await order());
  });

  it('lose a key that is permanently deleted', async () => {
    await createSqliteAnswerKeyRepository(t.db).delete('key-3');
    const home = await build().getDashboard();
    assert.deepEqual(home.recentAnswerKeys.map((key) => key.id), ['key-2', 'key-1']);
    assert.equal(home.counts.answerKeys, 2);
  });

  it('show the subject as it is called now', async () => {
    t.run("UPDATE subjects SET name = 'General Science' WHERE id = 'sub-2'");
    assert.equal((await build().getDashboard()).recentAnswerKeys[0].subjectName, 'General Science');
  });
});

// ---------------------------------------------------------------------------
// Cost and failure
// ---------------------------------------------------------------------------

describe('reading the dashboard', () => {
  beforeEach(seedRecords);

  function counting() {
    const log = [];
    return {
      log,
      db: {
        ...t.db,
        getAllAsync: (sql, params) => (log.push(sql), t.db.getAllAsync(sql, params)),
        getFirstAsync: (sql, params) => (log.push(sql), t.db.getFirstAsync(sql, params)),
      },
    };
  }

  it('takes four statements, however much is stored', async () => {
    const few = counting();
    await build({ db: few.db }).getDashboard();
    assert.equal(few.log.length, 4);

    for (let index = 0; index < 40; index++) {
      await addResult({ id: `res-${index}`, student: `stu-${(index % 3) + 1}`, key: 'key-2', capturedAt: minutesAgo(index) });
    }
    const many = counting();
    const home = await build({ db: many.db }).getDashboard();
    assert.equal(many.log.length, 4);
    assert.equal(home.counts.results, 40);
    assert.equal(home.recentResults.length, 3);
    // Lists are limited by SQLite, and counted by SQLite.
    assert.equal(many.log.filter((sql) => /LIMIT \?|LIMIT 1/.test(sql)).length, 3);
    assert.equal(many.log.filter((sql) => /COUNT\(\*\) FROM students/.test(sql)).length, 1);
  });

  it('reads the newest results and today through the capture-time index', () => {
    const plan = (sql) => t.all(`EXPLAIN QUERY PLAN ${sql}`).map((row) => row.detail).join(' | ');
    const newest = plan('SELECT id FROM results r ORDER BY r.captured_at DESC, r.created_at DESC, r.id DESC LIMIT 3');
    assert.match(newest, /idx_results_captured_at/);
    assert.doesNotMatch(newest, /TEMP B-TREE/);
    assert.match(plan("SELECT COUNT(*) FROM results WHERE captured_at >= 'a' AND captured_at < 'b'"), /idx_results_captured_at/);
  });

  it('still returns what it could read when one part fails, and says it is incomplete', async () => {
    await addResult({ id: 'res-1', capturedAt: minutesAgo(10) });
    const real = createSqliteDashboardRepository(t.db);
    const home = createDashboardUseCases({
      repository: { ...real, recentResults: async () => { throw new Error('disk I/O error'); } },
      now: () => NOW,
    });
    const reading = await home.getDashboard();
    assert.equal(reading.isIncomplete, true);
    assert.equal(reading.recentResults, null);
    assert.equal(reading.counts.results, 1);
    assert.equal(reading.recentAnswerKeys.length, 3);
    assert.equal(reading.lastScan.answerKeyId, 'key-1');
  });

  it('never throws, and only typed errors leave the repository', async () => {
    const broken = {
      ...t.db,
      getAllAsync: async () => { throw new Error('no such table: results'); },
      getFirstAsync: async () => { throw new Error('no such table: results'); },
    };
    assert.deepEqual(await build({ db: broken }).getDashboard(), {
      counts: null, recentResults: null, recentAnswerKeys: null, lastScan: null, isIncomplete: true,
    });
    await assert.rejects(createSqliteDashboardRepository(broken).counts(TODAY), (error) => {
      assert.equal(error.code, 'DATABASE_ERROR');
      assert.doesNotMatch(error.message, /no such table/);
      return true;
    });
  });

  it('changes nothing', async () => {
    await addResult({ id: 'res-1', capturedAt: minutesAgo(10) });
    const tables = ['subjects', 'classes', 'students', 'answer_keys', 'results', 'student_answers', 'scan_records'];
    const snapshot = () => JSON.stringify(tables.map((table) => t.all(`SELECT * FROM ${table} ORDER BY 1`)));
    const before = snapshot();
    await build().getDashboard();
    assert.equal(snapshot(), before);
  });
});

// ---------------------------------------------------------------------------
// Continue scanning
// ---------------------------------------------------------------------------

describe('continue scanning', () => {
  beforeEach(seedRecords);

  const scan = () =>
    createScanUseCases({
      subjects: createSqliteSubjectRepository(t.db),
      answerKeys: createSqliteAnswerKeyRepository(t.db),
      classSubjects: createSqliteClassSubjectRepository(t.db),
      students: createSqliteStudentRepository(t.db),
      results: createSqliteResultRepository(t.db),
      reader: { read: () => ({ ok: false, problem: 'TOO_BLURRY' }) },
      images: {},
      clock: { now: () => T0 },
      idGenerator: { newId: () => 'id' },
    });
  const SESSION = { subjectId: 'sub-1', answerKeyId: 'key-1', classId: 'cls-1' };

  it('is offered from the newest result: its subject, answer key, and class of the scan', async () => {
    assert.equal((await build().getDashboard()).lastScan, null);
    await addResult({ id: 'res-1', student: 'stu-3', key: 'key-3', capturedAt: minutesAgo(30) });
    await addResult({ id: 'res-2', student: 'stu-1', key: 'key-1', capturedAt: minutesAgo(10) });
    assert.deepEqual((await build().getDashboard()).lastScan, {
      subjectId: 'sub-1', subjectName: 'Mathematics', answerKeyId: 'key-1', answerKeyName: 'Midterm',
      classId: 'cls-1', className: 'BSIT 1A',
    });
    // The class of the scan, even after the student moved away.
    t.run("UPDATE students SET class_id = 'cls-2' WHERE id = 'stu-1'");
    assert.equal((await build().getDashboard()).lastScan.classId, 'cls-1');
  });

  it('starts with the subject, answer key, and class, and never a student', async () => {
    assert.deepEqual(await scan().resumeSession(SESSION), { ...SESSION, studentId: null });
    // Even if a caller passes one, it is not carried over.
    assert.deepEqual(await scan().resumeSession({ ...SESSION, studentId: 'stu-1' }), { ...SESSION, studentId: null });
  });

  it('starts clean when the session no longer holds', async () => {
    const changes = [
      ['the answer key moved to another subject', "UPDATE answer_keys SET subject_id = 'sub-2' WHERE id = 'key-1'"],
      ['the class no longer takes the subject', "DELETE FROM class_subjects WHERE class_id = 'cls-1' AND subject_id = 'sub-1'"],
      ['the answer key is too long for one sheet', "UPDATE answer_keys SET question_count = 150 WHERE id = 'key-1'"],
    ];
    for (const [label, sql] of changes) {
      t.close();
      t = openTestDatabase();
      await initializeDatabase(t.db);
      seedRecords();
      t.run(sql);
      assert.deepEqual(await scan().resumeSession(SESSION), EMPTY_SELECTION, label);
    }
    assert.deepEqual(await scan().resumeSession({ ...SESSION, subjectId: 'gone' }), EMPTY_SELECTION);
    assert.deepEqual(await scan().resumeSession({ ...SESSION, answerKeyId: 'gone' }), EMPTY_SELECTION);
    assert.deepEqual(await scan().resumeSession({ ...SESSION, classId: 'gone' }), EMPTY_SELECTION);
    // A class that exists but takes another subject only.
    assert.deepEqual(await scan().resumeSession({ subjectId: 'sub-2', answerKeyId: 'key-3', classId: 'cls-1' }), EMPTY_SELECTION);
  });

  it('starts clean, without throwing, when the database cannot be read', async () => {
    const broken = createScanUseCases({
      subjects: { getById: async () => { throw new Error('disk I/O error'); } },
      answerKeys: {}, classSubjects: {}, students: {}, results: {}, reader: {}, images: {},
      clock: { now: () => T0 }, idGenerator: { newId: () => 'id' },
    });
    assert.deepEqual(await broken.resumeSession(SESSION), EMPTY_SELECTION);
  });

  it('a resumed session passes the same checks a scan makes, once a student is chosen', async () => {
    const resumed = await scan().resumeSession(SESSION);
    const target = await scan().validateSelection({ ...resumed, studentId: 'stu-2' });
    assert.equal(target.student.fullName, 'Paolo Garcia');
  });
});

// ---------------------------------------------------------------------------
// Where Home leads
// ---------------------------------------------------------------------------

describe('Home navigation', () => {
  it('sends every control to its screen', () => {
    const routes = Object.fromEntries(Object.entries(HOME_LINKS).map(([name, link]) => [name, link.route]));
    assert.deepEqual(routes, {
      scan: '/scan',
      createAnswerKey: '/keys',
      addStudent: '/students',
      viewResults: '/results',
      students: '/students',
      classes: '/classes',
      answerKeys: '/keys',
      results: '/results',
      subjects: '/subjects',
      settings: '/settings',
    });
    // Only tabs and the three secondary screens: nothing leads to a placeholder or an exam.
    const known = ['/scan', '/keys', '/students', '/results', '/classes', '/subjects', '/settings'];
    assert.ok(Object.values(routes).every((route) => known.includes(route)));
  });

  it('opens the create forms directly, and only those', () => {
    assert.deepEqual(HOME_LINKS.createAnswerKey.intent, { type: 'create' });
    assert.deepEqual(HOME_LINKS.addStudent.intent, { type: 'add' });
    const others = Object.entries(HOME_LINKS).filter(([name]) => !['createAnswerKey', 'addStudent'].includes(name));
    assert.ok(others.every(([, link]) => link.intent === null));
    assert.deepEqual(openResultIntent('res-7'), { type: 'open', resultId: 'res-7' });
    assert.deepEqual(viewAnswerKeyIntent('key-7'), { type: 'view', answerKeyId: 'key-7' });
  });

  it('hands an intent to a screen exactly once', () => {
    assert.equal(takeIntent('results'), null);
    requestIntent('results', openResultIntent('res-1'));
    requestIntent('keys', viewAnswerKeyIntent('key-1'));
    assert.deepEqual(takeIntent('results'), { type: 'open', resultId: 'res-1' });
    // Taken: a later visit to the screen does not open it again.
    assert.equal(takeIntent('results'), null);
    // Each screen has its own.
    assert.deepEqual(takeIntent('keys'), { type: 'view', answerKeyId: 'key-1' });
    assert.equal(takeIntent('keys'), null);
  });

  it('keeps only the newest intent for a screen', () => {
    requestIntent('keys', { type: 'create' });
    requestIntent('keys', viewAnswerKeyIntent('key-2'));
    assert.deepEqual(takeIntent('keys'), { type: 'view', answerKeyId: 'key-2' });
    assert.equal(takeIntent('keys'), null);
    assert.equal(takeIntent('students'), null);
    assert.equal(takeIntent('scan'), null);
  });
});

// ---------------------------------------------------------------------------
// Refreshing
// ---------------------------------------------------------------------------

describe('keeping only the newest reading', () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const settle = () => new Promise((done) => setImmediate(done));

  it('delivers a reading that finishes while it is the newest', async () => {
    const latest = createLatestRequest();
    const seen = [];
    latest.run(async () => 'first', (value) => seen.push(value));
    await settle();
    latest.run(async () => 'second', (value) => seen.push(value));
    await settle();
    assert.deepEqual(seen, ['first', 'second']);
  });

  it('ignores an older reading that finishes after a newer one', async () => {
    const latest = createLatestRequest();
    const seen = [];
    const slow = deferred();
    const fast = deferred();
    latest.run(() => slow.promise, (value) => seen.push(value));
    latest.run(() => fast.promise, (value) => seen.push(value));
    fast.resolve('newer');
    await settle();
    slow.resolve('older');
    await settle();
    assert.deepEqual(seen, ['newer']);
  });

  it('ignores an older reading that finishes first, too', async () => {
    const latest = createLatestRequest();
    const seen = [];
    const slow = deferred();
    const fast = deferred();
    latest.run(() => slow.promise, (value) => seen.push(value));
    latest.run(() => fast.promise, (value) => seen.push(value));
    slow.resolve('older');
    await settle();
    assert.deepEqual(seen, []);
    fast.resolve('newer');
    await settle();
    assert.deepEqual(seen, ['newer']);
  });

  it('delivers nothing after the screen is left', async () => {
    const latest = createLatestRequest();
    const seen = [];
    const reading = deferred();
    latest.run(() => reading.promise, (value) => seen.push(value));
    latest.cancel();
    reading.resolve('late');
    await settle();
    assert.deepEqual(seen, []);
    // And works again on the next visit.
    latest.run(async () => 'back', (value) => seen.push(value));
    await settle();
    assert.deepEqual(seen, ['back']);
  });

  it('a dashboard read while another is under way shows the newer state', async () => {
    seedRecords();
    const home = build();
    const latest = createLatestRequest();
    let shown = null;
    latest.run(() => home.getDashboard(), (reading) => (shown = reading));
    await addResult({ id: 'res-1', capturedAt: minutesAgo(1) });
    latest.run(() => home.getDashboard(), (reading) => (shown = reading));
    await settle();
    await new Promise((done) => setTimeout(done, 50));
    assert.equal(shown.counts.results, 1);
  });
});
