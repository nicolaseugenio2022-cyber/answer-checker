// Verifies the development demo data: that the whole set is stored validly,
// that adding it twice adds it once, and that removing it deletes exactly the
// demo records and what hangs under them, leaving the Teacher's own records.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { initializeDatabase } from '../../src/core/infrastructure/database/initialize-database.ts';
import {
  DemoDataConflictError,
  createDemoDataUseCases,
} from '../../src/features/demo-data/application/demo-data-use-cases.ts';
import { DEMO_ID_PREFIX, buildDemoData } from '../../src/features/demo-data/domain/demo-data.ts';
import { createSqliteDemoDataRepository } from '../../src/features/demo-data/infrastructure/sqlite-demo-data-repository.ts';
import { createResultsUseCases } from '../../src/features/results/application/results-use-cases.ts';
import { NO_FILTER } from '../../src/features/results/domain/result-filter.ts';
import { tallyAnswers } from '../../src/features/results/domain/result.ts';
import { createSqliteResultsRepository } from '../../src/features/results/infrastructure/sqlite-results-repository.ts';
import { openTestDatabase } from '../database/test-database.mjs';

const NOW = '2026-10-02T12:00:00.000Z';
const TABLES = [
  'subjects', 'classes', 'class_subjects', 'students', 'answer_keys', 'answer_key_items',
  'results', 'student_answers', 'scan_records',
];

let t;
let demo;

beforeEach(async () => {
  t = openTestDatabase();
  await initializeDatabase(t.db);
  demo = createDemoDataUseCases({
    repository: createSqliteDemoDataRepository(t.db),
    clock: { now: () => NOW },
  });
});

afterEach(() => {
  t.close();
});

const counts = () =>
  Object.fromEntries(TABLES.map((table) => [table, t.get(`SELECT COUNT(*) AS n FROM ${table}`).n]));
const snapshot = () => JSON.stringify(TABLES.map((table) => t.all(`SELECT * FROM ${table} ORDER BY 1, 2`)));

/** A subject, class, student, answer key, and result of the Teacher's own. */
function seedOwn() {
  t.run('INSERT INTO subjects VALUES (?, ?, ?, ?)', 'sub-own', 'Filipino', NOW, NOW);
  t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', 'cls-own', 'BSCS 2B', NOW, NOW);
  t.run('INSERT INTO class_subjects VALUES (?, ?, ?)', 'cls-own', 'sub-own', NOW);
  t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', 'stu-own', 'cls-own', '2026-001', 'Rosa Cruz', NOW, NOW);
  t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-own', 'sub-own', 'Quiz', 1, NOW, NOW);
  t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-own', 1, 'A');
  t.run(
    'INSERT INTO results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'res-own', 'key-own', 'stu-own', 'cls-own', 1, 1, 'AC-1-V2', NOW, NOW,
    'Rosa Cruz', '2026-001', 'BSCS 2B', 'Filipino', 'Quiz'
  );
  t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 'res-own:1', 'res-own', 1, 'MARKED', 'A', 'A', 'A', 1, 0, 0.9);
  t.run('INSERT INTO scan_records VALUES (?, ?, ?, ?)', 'scn-own', 'res-own', 'scans/res-own.png', NOW);
}

describe('demo data', () => {
  it('is a fixed set whose ids and names mark it as demo data', () => {
    const data = buildDemoData(NOW);
    const ids = [
      ...data.subjects, ...data.classes, ...data.students, ...data.answerKeys, ...data.results,
    ].map((record) => record.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => id.startsWith(DEMO_ID_PREFIX) && /^[0-9a-f-]{36}$/.test(id)));
    assert.ok(
      [...data.subjects, ...data.classes, ...data.answerKeys].every((record) => record.name.startsWith('Demo '))
    );
    assert.ok(data.students.every((student) => student.studentNumber.startsWith('DEMO-')));
    // The same every time, and dated before the moment it is added.
    assert.deepEqual(buildDemoData(NOW), data);
    assert.ok(data.results.every((result) => result.capturedAt < NOW));
    // Each score is what its answers add up to.
    for (const result of data.results) {
      assert.equal(result.score, result.answers.filter((answer) => answer.isCorrect).length);
      assert.equal(result.total, result.answers.length);
    }
  });

  it('is stored whole and valid, and shows up in Results', async () => {
    assert.equal(await demo.hasDemoData(), false);
    assert.equal(await demo.addDemoData(), true);
    assert.equal(await demo.hasDemoData(), true);

    assert.deepEqual(counts(), {
      subjects: 2, classes: 2, class_subjects: 3, students: 8, answer_keys: 3, answer_key_items: 55,
      results: 16, student_answers: 8 * 10 + 4 * 30 + 3 * 15 + 10, scan_records: 16,
    });
    assert.deepEqual(t.all('PRAGMA foreign_key_check'), []);

    const results = createResultsUseCases({
      repository: createSqliteResultsRepository(t.db),
      images: {
        displayUri: async () => null,
        stage: async () => null,
        restore: async () => {},
        discard: async () => {},
        settleStaged: async () => {},
      },
    });
    const page = await results.listResults({ filter: NO_FILTER, search: '', limit: 50 });
    assert.equal(page.items.length, 16);
    // Two attempts of one student with one answer key, numbered by capture time.
    const attempts = page.items
      .filter((item) => item.attempt.count === 2)
      .map((item) => item.attempt.number)
      .sort();
    assert.deepEqual(attempts, [1, 2]);
    // Every kind of answer the detail screen distinguishes occurs.
    const tallies = await Promise.all(
      page.items.map(async (item) => tallyAnswers((await results.getResult(item.id)).result.answers))
    );
    for (const kind of ['correct', 'incorrect', 'blank', 'manuallyCorrected']) {
      assert.ok(tallies.some((tally) => tally[kind] > 0), kind);
    }
    assert.equal((await results.getResult(page.items[0].id)).imageUri, null);
  });

  it('is added once: a second request adds nothing', async () => {
    await demo.addDemoData();
    const before = snapshot();
    assert.equal(await demo.addDemoData(), false);
    assert.equal(snapshot(), before);
  });

  it('is added beside the records already there and removed without touching them', async () => {
    seedOwn();
    const own = snapshot();
    const ownCounts = counts();

    await demo.addDemoData();
    assert.equal(counts().subjects, 3);
    assert.deepEqual(await demo.removeDemoData(), { results: 16, students: 8, answerKeys: 3 });

    assert.equal(snapshot(), own);
    assert.deepEqual(counts(), ownCounts);
    assert.equal(await demo.hasDemoData(), false);
    // And it can be added again.
    assert.equal(await demo.addDemoData(), true);
  });

  it('removes what was saved under demo records too', async () => {
    seedOwn();
    await demo.addDemoData();
    const data = buildDemoData(NOW);
    // A student added to a demo class, a key added to a demo subject, and a
    // student who is not demo data scanned with that key.
    t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', 'stu-x', data.classes[0].id, '2026-777', 'New Student', NOW, NOW);
    t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-x', data.subjects[0].id, 'My key', 1, NOW, NOW);
    t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-x', 1, 'B');
    t.run(
      'INSERT INTO results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      'res-x', 'key-x', 'stu-own', 'cls-own', 0, 1, 'AC-1-V2', NOW, NOW,
      'Rosa Cruz', '2026-001', 'BSCS 2B', 'Demo Mathematics', 'My key'
    );
    t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 'res-x:1', 'res-x', 1, 'BLANK', null, null, 'B', 0, 0, 0.9);
    t.run('INSERT INTO scan_records VALUES (?, ?, ?, ?)', 'scn-x', 'res-x', 'scans/res-x.png', NOW);

    assert.deepEqual(await demo.removeDemoData(), { results: 17, students: 9, answerKeys: 4 });

    assert.deepEqual(counts(), {
      subjects: 1, classes: 1, class_subjects: 1, students: 1, answer_keys: 1, answer_key_items: 1,
      results: 1, student_answers: 1, scan_records: 1,
    });
    assert.deepEqual(t.all('PRAGMA foreign_key_check'), []);
  });

  it('adds nothing when a demo name is already taken', async () => {
    t.run('INSERT INTO subjects VALUES (?, ?, ?, ?)', 'sub-own', 'demo mathematics', NOW, NOW);
    const before = snapshot();
    await assert.rejects(demo.addDemoData(), (error) => {
      assert.ok(error instanceof DemoDataConflictError);
      return true;
    });
    assert.equal(snapshot(), before);
    assert.equal(await demo.hasDemoData(), false);
  });

  it('removing when there is none changes nothing', async () => {
    seedOwn();
    const before = snapshot();
    assert.deepEqual(await demo.removeDemoData(), { results: 0, students: 0, answerKeys: 0 });
    assert.equal(snapshot(), before);
  });
});
