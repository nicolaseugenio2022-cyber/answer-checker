// Verifies migration 6, the scan use cases, result persistence, and the scan
// image lifecycle. Uses real SQLite on disposable databases, the real sheet
// reader on generated photos, and an in-memory file system; it touches no real
// camera, photo, or user file.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  DatabaseError,
} from '../../src/core/infrastructure/database/database-error.ts';
import { initializeDatabase } from '../../src/core/infrastructure/database/initialize-database.ts';
import { MIGRATIONS } from '../../src/core/infrastructure/database/migrations.ts';
import { AnswerKeyInUseError } from '../../src/features/answer-keys/application/answer-key-repository.ts';
import { createAnswerKeyUseCases } from '../../src/features/answer-keys/application/answer-key-use-cases.ts';
import { createSqliteAnswerKeyRepository } from '../../src/features/answer-keys/infrastructure/sqlite-answer-key-repository.ts';
import { createSqliteClassSubjectRepository } from '../../src/features/class-subjects/infrastructure/sqlite-class-subject-repository.ts';
import { ClassInUseError } from '../../src/features/classes/application/class-repository.ts';
import { createSqliteClassRepository } from '../../src/features/classes/infrastructure/sqlite-class-repository.ts';
import {
  AnswerKeyChangedError,
  CaptureRejectedError,
  DuplicateAttemptError,
  IncompleteReviewError,
  ScanImageError,
  ScanSelectionError,
} from '../../src/features/scan/application/scan-ports.ts';
import { createScanUseCases } from '../../src/features/scan/application/scan-use-cases.ts';
import { setReviewAnswer } from '../../src/features/scan/domain/detection.ts';
import { selectClass, selectSubject } from '../../src/features/scan/domain/selection.ts';
import { sheetTemplate } from '../../src/features/scan/domain/template.ts';
import { decodePngToGray, encodeGrayToPng } from '../../src/features/scan/infrastructure/omr/png.ts';
import { createScanImageStore } from '../../src/features/scan/infrastructure/scan-image-store.ts';
import { createSqliteResultRepository } from '../../src/features/scan/infrastructure/sqlite-result-repository.ts';
import { typescriptSheetReader } from '../../src/features/scan/infrastructure/typescript-sheet-reader.ts';
import { StudentInUseError } from '../../src/features/students/application/student-repository.ts';
import { createSqliteStudentRepository } from '../../src/features/students/infrastructure/sqlite-student-repository.ts';
import { SubjectInUseError } from '../../src/features/subjects/application/subject-repository.ts';
import { createSqliteSubjectRepository } from '../../src/features/subjects/infrastructure/sqlite-subject-repository.ts';
import { openTestDatabase } from '../database/test-database.mjs';
import { drawSheet, photograph } from './sheet-renderer.mjs';

const T0 = '2026-10-02T08:30:00.000Z';
const LATEST = MIGRATIONS.length;
const CACHE = 'file:///data/user/0/app/cache/';
const DOCUMENTS = 'file:///data/user/0/app/files/';
const CAPTURE = `${CACHE}Camera/capture-1.jpg`;
const GALLERY_PHOTO = 'file:///storage/emulated/0/DCIM/Camera/IMG_0001.jpg';

let t;

afterEach(() => {
  t.close();
});

const count = (table) => t.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
const plain = (rows) => rows.map((row) => ({ ...row }));

// The answer key used throughout: ten questions.
const KEY = ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'B'];

/** A photo of a sheet with the given marks, stored where the camera would put it. */
const photoCache = new Map();
function photoBytes(marks, options = {}, questionCount = KEY.length) {
  // The sheet generated for the answer key: exactly its questions.
  const template = sheetTemplate(questionCount);
  // A function (a lighting model) cannot be part of a cache key; such photos are drawn each time.
  if (Object.values(options).some((value) => typeof value === "function")) {
    return encodeGrayToPng(photograph(drawSheet(template, marks), template, options));
  }
  const cacheKey = JSON.stringify([marks, options, questionCount]);
  if (!photoCache.has(cacheKey)) {
    photoCache.set(cacheKey, encodeGrayToPng(photograph(drawSheet(template, marks), template, options)));
  }
  return photoCache.get(cacheKey);
}
const marksOf = (letters) => Object.fromEntries(letters.map((letter, index) => [index + 1, letter]));
const PERFECT = marksOf(KEY);
/** The first questions answered correctly, on a sheet of any length. */
const PERFECT_ON_ANY = PERFECT;

/** An in-memory file system that records what was deleted and moved. */
function fakeFileSystem(files = {}, { failMove = false, failWrite = false } = {}) {
  const store = new Map(Object.entries(files));
  const log = { deleted: [], moved: [], resized: [] };
  let made = 0;
  return {
    store,
    log,
    fileSystem: {
      cacheDirectory: () => CACHE,
      documentDirectory: () => DOCUMENTS,
      // The fake "resize" copies the bytes: the test photos are already PNGs of working size.
      resizeToPng: async (sourceUri) => {
        if (!store.has(sourceUri)) throw new Error('ENOENT');
        const uri = `${CACHE}ImageManipulator/resized-${++made}.png`;
        store.set(uri, store.get(sourceUri));
        log.resized.push(sourceUri);
        return uri;
      },
      readBytes: async (uri) => {
        if (!store.has(uri)) throw new Error('ENOENT');
        return store.get(uri);
      },
      writeBytes: async (uri, bytes) => {
        if (failWrite) throw new Error('ENOSPC');
        store.set(uri, bytes);
      },
      move: async (from, to) => {
        if (failMove) throw new Error('EXDEV');
        store.set(to, store.get(from));
        store.delete(from);
        log.moved.push([from, to]);
      },
      delete: async (uri) => {
        log.deleted.push(uri);
        store.delete(uri);
      },
      ensureDirectory: async () => undefined,
      listFiles: async (directory) => [...store.keys()].filter((uri) => uri.startsWith(directory)),
    },
  };
}

/** Use cases over the real repositories, reader, and image store. */
function build({ fake = fakeFileSystem(), db = t.db, resultsDb = db, printableSheet } = {}) {
  let ids = 0;
  let ticks = 0;
  let names = 0;
  return createScanUseCases({
    subjects: createSqliteSubjectRepository(db),
    answerKeys: createSqliteAnswerKeyRepository(db),
    classSubjects: createSqliteClassSubjectRepository(db),
    students: createSqliteStudentRepository(db),
    results: createSqliteResultRepository(resultsDb),
    reader: typescriptSheetReader,
    printableSheet,
    images: createScanImageStore({ fileSystem: fake.fileSystem, newName: () => `preview-${++names}` }),
    idGenerator: { newId: () => `id-${++ids}` },
    clock: { now: () => new Date(Date.parse(T0) + 1000 * ticks++).toISOString() },
  });
}

const SELECTION = { subjectId: 'sub-1', answerKeyId: 'key-1', classId: 'cls-1', studentId: 'stu-1' };

/**
 * Two subjects, three classes, students, and answer keys:
 *   Mathematics (sub-1) is taught to BSIT 1A (cls-1) and BSIT 1B (cls-2);
 *   Science (sub-2) is taught to BSIT 1B only; cls-3 takes nothing.
 */
async function openSeeded() {
  t = openTestDatabase();
  await initializeDatabase(t.db);
  for (const [id, name] of [['sub-1', 'Mathematics'], ['sub-2', 'Science']]) {
    t.run('INSERT INTO subjects VALUES (?, ?, ?, ?)', id, name, T0, T0);
  }
  for (const [id, name] of [['cls-1', 'BSIT 1A'], ['cls-2', 'BSIT 1B'], ['cls-3', 'BSCS 2B']]) {
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
  const key = (id, subjectId, name, answers) => {
    t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', id, subjectId, name, answers.length, T0, T0);
    answers.forEach((answer, index) => t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', id, index + 1, answer));
  };
  key('key-1', 'sub-1', 'Midterm', KEY);
  key('key-2', 'sub-1', 'Long test', Array.from({ length: 120 }, (_, i) => 'ABCD'[i % 4]));
  key('key-3', 'sub-2', 'Quiz', ['A', 'B']);
}

/** Reads a sheet and returns the draft, with the fake that holds its files. */
async function draftOf(marks = PERFECT, options = {}) {
  const fake = fakeFileSystem({ [CAPTURE]: photoBytes(marks, options) });
  const scan = build({ fake });
  const draft = await scan.readCapture(CAPTURE, SELECTION);
  return { fake, scan, draft };
}

// ---------------------------------------------------------------------------
// Migration 6
// ---------------------------------------------------------------------------

describe('migration 6: results as a scan saves them', () => {
  async function openVersion5() {
    t = openTestDatabase();
    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 5)), 5);
    t.run('INSERT INTO subjects VALUES (?, ?, ?, ?)', 'sub-1', 'Mathematics', T0, T0);
    t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', 'cls-1', 'BSIT 1A', T0, T0);
    t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', 'stu-1', 'cls-1', '2026-001', 'Maria Santos', T0, T0);
    t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', 'key-1', 'sub-1', 'Midterm', 3, T0, T0);
    for (const [number, answer] of [[1, 'B'], [2, 'D'], [3, 'A']]) {
      t.run('INSERT INTO answer_key_items VALUES (?, ?, ?)', 'key-1', number, answer);
    }
  }
  const legacyResult = () => {
    t.run('INSERT INTO results VALUES (?, ?, ?, ?, ?, ?)', 'res-1', 'key-1', 'stu-1', 1, 3, T0);
    t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)', 'ans-1', 'res-1', 1, 'SELECTED', 'B', 1, 0);
    t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)', 'ans-2', 'res-1', 2, 'UNCERTAIN', null, 0, 1);
    t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)', 'ans-3', 'res-1', 3, 'BLANK', null, 0, 0);
    t.run('INSERT INTO scan_records VALUES (?, ?, ?, ?)', 'scn-1', 'res-1', 'scans/res-1.png', T0);
  };
  const reload = () => t.all('SELECT name FROM sqlite_master LIMIT 1');

  it('brings a fresh database to version 6 with the new result columns', async () => {
    t = openTestDatabase();
    assert.equal(await initializeDatabase(t.db), 6);
    assert.equal(LATEST, 6);
    const columns = (table) => t.all(`SELECT name FROM pragma_table_info('${table}')`).map((c) => c.name);
    assert.deepEqual(columns('results'), [
      'id', 'answer_key_id', 'student_id', 'class_id', 'score', 'total', 'template_id', 'captured_at', 'created_at',
    ]);
    assert.deepEqual(columns('student_answers'), [
      'id', 'result_id', 'question_number', 'detected_state', 'detected_answer', 'final_answer',
      'correct_answer', 'is_correct', 'manually_corrected', 'confidence',
    ]);
    assert.deepEqual(columns('scan_records'), ['id', 'result_id', 'image_path', 'scanned_at']);
    for (const table of ['results', 'student_answers', 'scan_records']) {
      assert.equal(t.get('SELECT strict FROM pragma_table_list WHERE name = ?', table).strict, 1);
    }
  });

  it('upgrades a version-5 database and converts its results and answers', async () => {
    await openVersion5();
    legacyResult();
    const untouched = ['subjects', 'classes', 'students', 'answer_keys', 'answer_key_items', 'scan_records'];
    const before = Object.fromEntries(untouched.map((table) => [table, plain(t.all(`SELECT * FROM ${table} ORDER BY 1, 2`))]));

    assert.equal(await initializeDatabase(t.db), 6);
    reload();

    for (const table of untouched) {
      assert.deepEqual(plain(t.all(`SELECT * FROM ${table} ORDER BY 1, 2`)), before[table], table);
    }
    assert.deepEqual(plain(t.all('SELECT * FROM results')), [
      {
        id: 'res-1', answer_key_id: 'key-1', student_id: 'stu-1', class_id: 'cls-1', score: 1, total: 3,
        template_id: 'UNKNOWN', captured_at: T0, created_at: T0,
      },
    ]);
    assert.deepEqual(plain(t.all('SELECT * FROM student_answers ORDER BY question_number')), [
      { id: 'ans-1', result_id: 'res-1', question_number: 1, detected_state: 'MARKED', detected_answer: 'B', final_answer: 'B', correct_answer: 'B', is_correct: 1, manually_corrected: 0, confidence: null },
      { id: 'ans-2', result_id: 'res-1', question_number: 2, detected_state: 'UNCLEAR', detected_answer: null, final_answer: null, correct_answer: 'D', is_correct: 0, manually_corrected: 1, confidence: null },
      { id: 'ans-3', result_id: 'res-1', question_number: 3, detected_state: 'BLANK', detected_answer: null, final_answer: null, correct_answer: 'A', is_correct: 0, manually_corrected: 0, confidence: null },
    ]);
    assert.deepEqual(t.all('PRAGMA foreign_key_check'), []);
    assert.deepEqual(plain(t.all('PRAGMA integrity_check')), [{ integrity_check: 'ok' }]);
    const leftovers = t.all("SELECT name FROM sqlite_master WHERE name LIKE 'new_%' UNION ALL SELECT name FROM sqlite_temp_master");
    assert.deepEqual(leftovers, []);
  });

  it('keeps the delete rules: answers and scan record go with a result, parents are protected', async () => {
    await openVersion5();
    legacyResult();
    await initializeDatabase(t.db);
    reload();

    for (const [table, id] of [['answer_keys', 'key-1'], ['students', 'stu-1'], ['classes', 'cls-1']]) {
      assert.throws(() => t.run(`DELETE FROM ${table} WHERE id = ?`, id), /FOREIGN KEY/, table);
    }
    t.run('DELETE FROM results WHERE id = ?', 'res-1');
    assert.equal(count('student_answers') + count('scan_records'), 0);
  });

  it('rolls back when a saved answer has no correct answer to snapshot', async () => {
    await openVersion5();
    legacyResult();
    t.run('INSERT INTO student_answers VALUES (?, ?, ?, ?, ?, ?, ?)', 'ans-9', 'res-1', 9, 'BLANK', null, 0, 0);
    const before = plain(t.all('SELECT * FROM student_answers ORDER BY id'));

    await assert.rejects(initializeDatabase(t.db), (error) => {
      assert.equal(error.name, 'MigrationFailedError');
      assert.equal(error.version, 6);
      return true;
    });

    assert.equal(t.get('PRAGMA user_version').user_version, 5);
    assert.deepEqual(plain(t.all('SELECT * FROM student_answers ORDER BY id')), before);
    assert.equal(count('results'), 1);
  });

  it('does nothing when run again', async () => {
    await openVersion5();
    legacyResult();
    await initializeDatabase(t.db);
    reload();
    const schema = JSON.stringify(t.all('SELECT type, name, sql FROM sqlite_master ORDER BY type, name'));
    assert.equal(await initializeDatabase(t.db), 6);
    assert.equal(JSON.stringify(t.all('SELECT type, name, sql FROM sqlite_master ORDER BY type, name')), schema);
    assert.equal(count('student_answers'), 3);
  });
});

// ---------------------------------------------------------------------------
// Selection and relationships
// ---------------------------------------------------------------------------

describe('scan selection against the database', () => {
  beforeEach(openSeeded);

  const names = (options) => options.map((option) => option.name);

  it('offers every subject, and nothing under it until one is chosen', async () => {
    const options = await build().listOptions({ subjectId: null, answerKeyId: null, classId: null, studentId: null });
    assert.deepEqual(names(options.subjects), ['Mathematics', 'Science']);
    assert.deepEqual([options.answerKeys, options.classes, options.students], [[], [], []]);
    assert.equal(options.maxSheetQuestions, 100);
  });

  it('offers only the answer keys and the classes of the chosen subject', async () => {
    const math = await build().listOptions({ ...SELECTION, answerKeyId: null, classId: null, studentId: null });
    assert.deepEqual(names(math.answerKeys), ['Long test', 'Midterm']);
    assert.deepEqual(names(math.classes), ['BSIT 1A', 'BSIT 1B']);

    const science = await build().listOptions({ subjectId: 'sub-2', answerKeyId: null, classId: null, studentId: null });
    assert.deepEqual(names(science.answerKeys), ['Quiz']);
    assert.deepEqual(names(science.classes), ['BSIT 1B']);
  });

  it('offers only the students of the chosen class', async () => {
    const first = await build().listOptions({ ...SELECTION, studentId: null });
    assert.deepEqual(first.students.map((s) => [s.name, s.studentNumber, s.scanCount]), [
      ['Maria Santos', '2026-001', 0],
      ['Paolo Garcia', '2026-002', 0],
    ]);
    const second = await build().listOptions({ ...SELECTION, classId: 'cls-2', studentId: null });
    assert.deepEqual(names(second.students), ['Ana Reyes']);
  });

  it('marks an answer key with more questions than one sheet holds as not scannable', async () => {
    const options = await build().listOptions({ ...SELECTION, answerKeyId: null });
    assert.deepEqual(options.answerKeys.map((key) => [key.name, key.questionCount, key.fitsSheet]), [
      ['Long test', 120, false],
      ['Midterm', 10, true],
    ]);
  });

  it('clears the key, class, and student when the new subject is not taught to the class', async () => {
    const scan = build();
    const next = selectSubject(SELECTION, 'sub-2', await scan.classIdsOfSubject('sub-2'));
    assert.deepEqual(next, { subjectId: 'sub-2', answerKeyId: null, classId: null, studentId: null });
    // A class that takes both subjects is kept, with its student; the key never is.
    const fromOneB = { ...SELECTION, classId: 'cls-2', studentId: 'stu-3' };
    assert.deepEqual(selectSubject(fromOneB, 'sub-2', await scan.classIdsOfSubject('sub-2')), {
      subjectId: 'sub-2',
      answerKeyId: null,
      classId: 'cls-2',
      studentId: 'stu-3',
    });
    assert.deepEqual(selectClass(SELECTION, 'cls-2'), { ...SELECTION, classId: 'cls-2', studentId: null });
  });

  it('accepts a selection whose four records fit together, and names them', async () => {
    const target = await build().validateSelection(SELECTION);
    assert.equal(target.subjectName, 'Mathematics');
    assert.equal(target.className, 'BSIT 1A');
    assert.deepEqual(target.student, { id: 'stu-1', fullName: 'Maria Santos', studentNumber: '2026-001' });
    assert.deepEqual(target.answerKey, { id: 'key-1', name: 'Midterm', questionCount: 10, answers: KEY });
  });

  it('rejects every broken relationship with a typed reason', async () => {
    const scan = build();
    const cases = [
      [{ ...SELECTION, studentId: null }, 'INCOMPLETE'],
      [{ ...SELECTION, subjectId: 'missing' }, 'SUBJECT_MISSING'],
      [{ ...SELECTION, answerKeyId: 'missing' }, 'ANSWER_KEY_MISSING'],
      [{ ...SELECTION, answerKeyId: 'key-3' }, 'ANSWER_KEY_NOT_OF_SUBJECT'],
      [{ ...SELECTION, answerKeyId: 'key-2' }, 'ANSWER_KEY_TOO_LONG'],
      [{ ...SELECTION, classId: 'missing' }, 'CLASS_MISSING'],
      [{ ...SELECTION, classId: 'cls-3' }, 'CLASS_NOT_ASSIGNED'],
      [{ ...SELECTION, studentId: 'missing' }, 'STUDENT_MISSING'],
      [{ ...SELECTION, studentId: 'stu-3' }, 'STUDENT_NOT_IN_CLASS'],
      // A subject and class that fit each other, with a key of another subject.
      [{ subjectId: 'sub-2', answerKeyId: 'key-1', classId: 'cls-2', studentId: 'stu-3' }, 'ANSWER_KEY_NOT_OF_SUBJECT'],
    ];
    for (const [selection, problem] of cases) {
      await assert.rejects(scan.validateSelection(selection), (error) => {
        assert.ok(error instanceof ScanSelectionError, problem);
        assert.equal(error.code, 'VALIDATION_ERROR');
        assert.equal(error.problem, problem);
        return true;
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Reading a capture
// ---------------------------------------------------------------------------

describe('reading a captured photo', () => {
  beforeEach(openSeeded);

  it('reads the sheet generated for the answer key, reviews its questions, and keeps one preview', async () => {
    const { fake, draft } = await draftOf();

    assert.equal(draft.templateId, 'AC-10-V2');
    assert.equal(draft.template.questionCount, 10);
    assert.deepEqual(draft.template, sheetTemplate(10));
    assert.equal(draft.capturedAt, T0);
    assert.equal(draft.review.length, 10);
    assert.deepEqual(draft.review.map((item) => item.finalAnswer), KEY);
    assert.ok(draft.review.every((item) => item.isResolved));
    assert.equal(draft.target.student.fullName, 'Maria Santos');

    // The capture and the resized copy are gone; only the preview remains, in the cache.
    assert.deepEqual([...fake.store.keys()], [draft.previewUri]);
    assert.ok(draft.previewUri.startsWith(`${CACHE}scan-previews/`));
    const preview = decodePngToGray(fake.store.get(draft.previewUri));
    assert.deepEqual([preview.width, preview.height], [840, 1188]);
  });

  it('reads the sheet of each answer key by that key\'s own question count', async () => {
    const fake = fakeFileSystem({ [CAPTURE]: photoBytes({ 1: 'A', 2: 'B' }, {}, 2) });
    const draft = await build({ fake }).readCapture(CAPTURE, {
      subjectId: 'sub-2', answerKeyId: 'key-3', classId: 'cls-2', studentId: 'stu-3',
    });
    assert.equal(draft.templateId, 'AC-2-V2');
    assert.deepEqual(draft.review.map((item) => item.finalAnswer), ['A', 'B']);
  });

  it('refuses a sheet printed for another number of questions, with both counts, and makes no draft', async () => {
    for (const printed of [40, 12, 9]) {
      const fake = fakeFileSystem({ [CAPTURE]: photoBytes(PERFECT_ON_ANY, {}, printed) });
      await assert.rejects(build({ fake }).readCapture(CAPTURE, SELECTION), (error) => {
        assert.ok(error instanceof CaptureRejectedError);
        assert.equal(error.problem, 'WRONG_SHEET');
        assert.equal(error.sheetQuestionCount, printed);
        assert.equal(error.expectedQuestionCount, 10);
        return true;
      });
      assert.equal(fake.store.size, 0, `${printed}-question sheet`);
    }
    assert.equal(count('results'), 0);
  });

  it('does not trust a reader that returns another sheet than the one expected', async () => {
    const fake = fakeFileSystem({ [CAPTURE]: photoBytes(PERFECT) });
    const scan = createScanUseCases({
      subjects: createSqliteSubjectRepository(t.db),
      answerKeys: createSqliteAnswerKeyRepository(t.db),
      classSubjects: createSqliteClassSubjectRepository(t.db),
      students: createSqliteStudentRepository(t.db),
      results: createSqliteResultRepository(t.db),
      // A reader that ignores the expected template and reads 40 questions.
      reader: { read: (image) => typescriptSheetReader.read(image, sheetTemplate(10)).ok
        ? { ok: true, templateId: 'AC-40-V2', detections: [], rectified: image }
        : { ok: false, problem: 'TOO_BLURRY' } },
      images: createScanImageStore({ fileSystem: fake.fileSystem, newName: () => 'preview-1' }),
      idGenerator: { newId: () => 'id-1' },
      clock: { now: () => T0 },
    });
    await assert.rejects(scan.readCapture(CAPTURE, SELECTION), (error) => {
      assert.ok(error instanceof CaptureRejectedError);
      assert.equal(error.problem, 'UNSUPPORTED_TEMPLATE');
      return true;
    });
    assert.equal(fake.store.size, 0);
  });

  it('refuses an unreadable photo with a typed reason, makes no draft, and deletes the capture', async () => {
    for (const [options, problem] of [
      [{ blurRadius: 5 }, 'TOO_BLURRY'],
      [{ corners: [[0.06, -0.12], [0.94, -0.12], [0.94, 0.9], [0.06, 0.9]] }, 'MARKERS_NOT_FOUND'],
      [{ light: () => 0.25 }, 'BAD_LIGHTING'],
    ]) {
      const fake = fakeFileSystem({ [CAPTURE]: photoBytes(PERFECT, options) });
      await assert.rejects(build({ fake }).readCapture(CAPTURE, SELECTION), (error) => {
        assert.ok(error instanceof CaptureRejectedError);
        assert.equal(error.code, 'CAPTURE_REJECTED');
        assert.equal(error.problem, problem);
        return true;
      });
      assert.equal(fake.store.size, 0, problem);
      assert.ok(fake.log.deleted.includes(CAPTURE));
    }
    assert.equal(count('results'), 0);
  });

  it('refuses to read for an invalid selection, and still deletes the capture', async () => {
    const fake = fakeFileSystem({ [CAPTURE]: photoBytes(PERFECT) });
    await assert.rejects(
      build({ fake }).readCapture(CAPTURE, { ...SELECTION, studentId: 'stu-3' }),
      ScanSelectionError
    );
    assert.equal(fake.store.size, 0);
    assert.deepEqual(fake.log.resized, []);
  });

  it('reports a capture that cannot be loaded as a file error, with no raw message', async () => {
    const fake = fakeFileSystem({ [CAPTURE]: Uint8Array.from([1, 2, 3]) });
    await assert.rejects(build({ fake }).readCapture(CAPTURE, SELECTION), (error) => {
      assert.ok(error instanceof ScanImageError);
      assert.equal(error.code, 'FILE_ERROR');
      assert.doesNotMatch(error.message, /PNG|ENOENT/);
      return true;
    });
    assert.equal(fake.store.size, 0);
  });

  it('deletes the capture when the preview cannot be written', async () => {
    const fake = fakeFileSystem({ [CAPTURE]: photoBytes(PERFECT) }, { failWrite: true });
    await assert.rejects(build({ fake }).readCapture(CAPTURE, SELECTION), ScanImageError);
    assert.equal(fake.store.size, 0);
  });

  it('never deletes a file outside the app, such as a gallery photo', async () => {
    const fake = fakeFileSystem({ [GALLERY_PHOTO]: photoBytes(PERFECT) });
    const scan = build({ fake });
    const draft = await scan.readCapture(GALLERY_PHOTO, SELECTION);
    await scan.discardCapture(GALLERY_PHOTO);
    assert.ok(fake.store.has(GALLERY_PHOTO));
    assert.ok(!fake.log.deleted.includes(GALLERY_PHOTO));
    await scan.discardDraft(draft);
    assert.deepEqual([...fake.store.keys()], [GALLERY_PHOTO]);
  });

  it('deletes the capture on Retake or Cancel, and the preview when a draft is thrown away', async () => {
    const fake = fakeFileSystem({ [CAPTURE]: photoBytes(PERFECT) });
    await build({ fake }).discardCapture(CAPTURE);
    assert.equal(fake.store.size, 0);

    const { fake: second, scan, draft } = await draftOf();
    await scan.discardDraft(draft);
    assert.equal(second.store.size, 0);
    assert.equal(count('results'), 0);
  });
});

// ---------------------------------------------------------------------------
// Saving a result
// ---------------------------------------------------------------------------

describe('saving a result', () => {
  beforeEach(openSeeded);

  it('saves the result, every answer, and one scan record, and moves the image to its private place', async () => {
    const { fake, scan, draft } = await draftOf(marksOf(['A', 'B', 'C', 'D', 'B', 'B', 'C', 'D', 'A', 'A']));

    const saved = await scan.saveResult(draft, draft.review);

    assert.deepEqual(saved, { id: 'id-1', score: 8, total: 10, imagePath: 'scans/id-1.png' });
    assert.deepEqual(plain(t.all('SELECT * FROM results')), [
      {
        id: 'id-1', answer_key_id: 'key-1', student_id: 'stu-1', class_id: 'cls-1', score: 8, total: 10,
        template_id: 'AC-10-V2', captured_at: T0, created_at: '2026-10-02T08:30:01.000Z',
      },
    ]);
    const answers = plain(t.all('SELECT * FROM student_answers ORDER BY question_number'));
    assert.equal(answers.length, 10);
    assert.deepEqual(answers.map((a) => a.question_number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(answers.map((a) => a.correct_answer), KEY);
    assert.deepEqual(answers.map((a) => a.final_answer), ['A', 'B', 'C', 'D', 'B', 'B', 'C', 'D', 'A', 'A']);
    assert.deepEqual(answers.map((a) => a.is_correct), [1, 1, 1, 1, 0, 1, 1, 1, 1, 0]);
    assert.ok(answers.every((a) => a.detected_state === 'MARKED' && a.manually_corrected === 0));
    assert.ok(answers.every((a) => a.confidence > 0.5 && a.confidence <= 1));
    assert.deepEqual(plain(t.all('SELECT * FROM scan_records')), [
      { id: 'id-2', result_id: 'id-1', image_path: 'scans/id-1.png', scanned_at: T0 },
    ]);

    // One file remains: the final image, named by the result's id, in the app's documents.
    assert.deepEqual([...fake.store.keys()], [`${DOCUMENTS}scans/id-1.png`]);
    assert.equal(scan.imageUri(saved.imagePath), `${DOCUMENTS}scans/id-1.png`);
    assert.doesNotMatch(saved.imagePath, /Maria|Santos|2026/);
    // The image is a file, never a database value.
    assert.ok(!JSON.stringify(t.all('SELECT * FROM scan_records')).includes('PNG'));
  });

  it('scores a perfect sheet, a sheet with everything wrong, and stores the range correctly', async () => {
    const perfect = await draftOf();
    assert.equal((await perfect.scan.saveResult(perfect.draft, perfect.draft.review)).score, 10);

    t.run('DELETE FROM results');
    const wrong = await draftOf(marksOf(['B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'B', 'C']));
    assert.deepEqual(await wrong.scan.saveResult(wrong.draft, wrong.draft.review), {
      id: 'id-1', score: 0, total: 10, imagePath: 'scans/id-1.png',
    });
  });

  it('requires blank, multiple, and unclear questions to be resolved, then stores what was decided', async () => {
    const marks = { ...PERFECT, 2: undefined, 3: 'AC', 4: { D: 0.25 } };
    const { fake, scan, draft } = await draftOf(marks);
    assert.deepEqual(draft.review.slice(1, 4).map((item) => item.detection.state), ['blank', 'multiple', 'unclear']);

    await assert.rejects(scan.saveResult(draft, draft.review), (error) => {
      assert.ok(error instanceof IncompleteReviewError);
      assert.equal(error.unresolvedCount, 3);
      return true;
    });
    assert.equal(count('results'), 0);
    // The preview is still there for the Teacher to keep reviewing.
    assert.deepEqual([...fake.store.keys()], [draft.previewUri]);

    let review = setReviewAnswer(draft.review, 2, null); // confirmed blank
    review = setReviewAnswer(review, 3, 'C'); // the right letter of the two
    review = setReviewAnswer(review, 4, 'D'); // the faint mark was meant
    const saved = await scan.saveResult(draft, review);
    assert.equal(saved.score, 9);

    const stored = plain(t.all('SELECT question_number, detected_state, detected_answer, final_answer, is_correct, manually_corrected FROM student_answers WHERE question_number BETWEEN 2 AND 4 ORDER BY question_number'));
    assert.deepEqual(stored, [
      { question_number: 2, detected_state: 'BLANK', detected_answer: null, final_answer: null, is_correct: 0, manually_corrected: 0 },
      { question_number: 3, detected_state: 'MULTIPLE', detected_answer: null, final_answer: 'C', is_correct: 1, manually_corrected: 1 },
      { question_number: 4, detected_state: 'UNCLEAR', detected_answer: null, final_answer: 'D', is_correct: 1, manually_corrected: 1 },
    ]);
  });

  it('stores a manual correction of a confidently read answer', async () => {
    const { scan, draft } = await draftOf();
    const review = setReviewAnswer(draft.review, 1, 'D');
    assert.equal((await scan.saveResult(draft, review)).score, 9);
    assert.deepEqual({ ...t.get('SELECT detected_state, detected_answer, final_answer, manually_corrected FROM student_answers WHERE question_number = 1') }, {
      detected_state: 'MARKED', detected_answer: 'A', final_answer: 'D', manually_corrected: 1,
    });
  });

  it('keeps the class of the scan when the student is moved later', async () => {
    const { scan, draft } = await draftOf();
    await scan.saveResult(draft, draft.review);
    t.run('UPDATE students SET class_id = ? WHERE id = ?', 'cls-2', 'stu-1');
    assert.equal(t.get('SELECT class_id FROM results').class_id, 'cls-1');
  });

  it('keeps the correct answers of the scan when the answer key is renamed', async () => {
    const { scan, draft } = await draftOf();
    await scan.saveResult(draft, draft.review);
    const keys = createAnswerKeyUseCases({
      repository: createSqliteAnswerKeyRepository(t.db),
      clock: { now: () => T0 },
      idGenerator: { newId: () => 'x' },
    });
    await keys.updateAnswerKey('key-1', { name: 'Midterm 2026', subjectId: 'sub-1', questionCount: 10, answers: KEY });
    assert.deepEqual(t.all('SELECT correct_answer FROM student_answers ORDER BY question_number').map((r) => r.correct_answer), KEY);
    assert.equal(t.get('SELECT score FROM results').score, 10);
  });
});

describe('saving a result: checks made again at save time', () => {
  beforeEach(openSeeded);

  const assertNothingSaved = (fake, draft) => {
    assert.equal(count('results') + count('student_answers') + count('scan_records'), 0);
    assert.deepEqual([...fake.store.keys()], [draft.previewUri]);
  };

  it('rejects the save when the answer key was edited after the sheet was read', async () => {
    const { fake, scan, draft } = await draftOf();
    t.run("UPDATE answer_key_items SET correct_answer = 'D' WHERE answer_key_id = 'key-1' AND question_number = 1");

    await assert.rejects(scan.saveResult(draft, draft.review), (error) => {
      assert.ok(error instanceof AnswerKeyChangedError);
      assert.equal(error.code, 'ANSWER_KEY_CHANGED');
      return true;
    });
    assertNothingSaved(fake, draft);
  });

  it('rejects the save when the answer key lost or gained questions', async () => {
    const { fake, scan, draft } = await draftOf();
    t.run("DELETE FROM answer_key_items WHERE answer_key_id = 'key-1' AND question_number = 10");
    t.run("UPDATE answer_keys SET question_count = 9 WHERE id = 'key-1'");
    await assert.rejects(scan.saveResult(draft, draft.review), AnswerKeyChangedError);
    assertNothingSaved(fake, draft);
  });

  it('rejects the save when a relationship changed during the review', async () => {
    const changes = [
      ["UPDATE students SET class_id = 'cls-2' WHERE id = 'stu-1'", 'STUDENT_NOT_IN_CLASS'],
      ["DELETE FROM class_subjects WHERE class_id = 'cls-1' AND subject_id = 'sub-1'", 'CLASS_NOT_ASSIGNED'],
      ["UPDATE answer_keys SET subject_id = 'sub-2' WHERE id = 'key-1'", 'ANSWER_KEY_NOT_OF_SUBJECT'],
      ["DELETE FROM students WHERE id = 'stu-1'", 'STUDENT_MISSING'],
    ];
    for (const [sql, problem] of changes) {
      t.close();
      await openSeeded();
      const { fake, scan, draft } = await draftOf();
      t.run(sql);
      await assert.rejects(scan.saveResult(draft, draft.review), (error) => {
        assert.ok(error instanceof ScanSelectionError, problem);
        assert.equal(error.problem, problem);
        return true;
      });
      assertNothingSaved(fake, draft);
    }
  });

  it('rejects a review that does not cover the questions of the key', async () => {
    const { fake, scan, draft } = await draftOf();
    await assert.rejects(scan.saveResult(draft, draft.review.slice(0, 9)), AnswerKeyChangedError);
    assertNothingSaved(fake, draft);
  });
});

describe('saving a result: all or nothing', () => {
  beforeEach(openSeeded);

  /** A connection that carries out a matching write and then reports it as failed. */
  const failingOn = (pattern) => ({
    ...t.db,
    runAsync: async (sql, params = []) => {
      const result = await t.db.runAsync(sql, params);
      if (pattern.test(sql.trim())) throw new Error('disk I/O error');
      return result;
    },
  });

  for (const [what, pattern] of [
    ['an answer insert', /^INSERT INTO student_answers/],
    ['the scan record insert', /^INSERT INTO scan_records/],
    ['the result insert', /^INSERT INTO results/],
  ]) {
    it(`rolls back every row and deletes the final image when ${what} fails`, async () => {
      const fake = fakeFileSystem({ [CAPTURE]: photoBytes(PERFECT) });
      const scan = build({ fake, resultsDb: failingOn(pattern) });
      const draft = await scan.readCapture(CAPTURE, SELECTION);

      await assert.rejects(scan.saveResult(draft, draft.review), (error) => {
        assert.ok(error instanceof DatabaseError);
        assert.equal(error.code, 'DATABASE_ERROR');
        assert.doesNotMatch(error.message, /disk I\/O/);
        return true;
      });

      assert.equal(count('results') + count('student_answers') + count('scan_records'), 0);
      // The image had been moved to its final place; it was deleted again.
      assert.deepEqual(fake.log.moved.map(([, to]) => to), [`${DOCUMENTS}scans/id-1.png`]);
      assert.ok(fake.log.deleted.includes(`${DOCUMENTS}scans/id-1.png`));
      assert.equal(fake.store.size, 0);
    });
  }

  it('writes no row when the image cannot be moved to its final place', async () => {
    const fake = fakeFileSystem({ [CAPTURE]: photoBytes(PERFECT) });
    const draft = await build({ fake }).readCapture(CAPTURE, SELECTION);
    const stuck = fakeFileSystem(Object.fromEntries(fake.store), { failMove: true });

    await assert.rejects(build({ fake: stuck }).saveResult(draft, draft.review), (error) => {
      assert.ok(error instanceof ScanImageError);
      assert.equal(error.code, 'FILE_ERROR');
      return true;
    });
    assert.equal(count('results') + count('student_answers') + count('scan_records'), 0);
  });

  it('keeps working after a failed save', async () => {
    const fake = fakeFileSystem({ [CAPTURE]: photoBytes(PERFECT) });
    const broken = build({ fake, resultsDb: failingOn(/^INSERT INTO scan_records/) });
    const draft = await broken.readCapture(CAPTURE, SELECTION);
    await assert.rejects(broken.saveResult(draft, draft.review), DatabaseError);

    const again = await draftOf();
    assert.equal((await again.scan.saveResult(again.draft, again.draft.review)).score, 10);
    assert.equal(count('results'), 1);
  });
});

describe('a second scan of the same student and answer key', () => {
  beforeEach(openSeeded);

  it('labels the students already scanned with the chosen answer key, and only with that key', async () => {
    const first = await draftOf();
    await first.scan.saveResult(first.draft, first.draft.review);

    const counts = async (selection) =>
      Object.fromEntries((await build().listOptions(selection)).students.map((s) => [s.id, s.scanCount]));
    assert.deepEqual(await counts(SELECTION), { 'stu-1': 1, 'stu-2': 0 });
    // No key chosen, or another key: nobody counts as scanned.
    assert.deepEqual(await counts({ ...SELECTION, answerKeyId: null }), { 'stu-1': 0, 'stu-2': 0 });
    assert.deepEqual(await counts({ ...SELECTION, answerKeyId: 'key-2' }), { 'stu-1': 0, 'stu-2': 0 });
  });

  it('shares a printable sheet made for exactly the questions of the answer key', async () => {
    const shared = [];
    const printableSheet = { share: async (pdf, fileName) => (shared.push({ pdf, fileName }), true) };
    const scan = build({ printableSheet });

    await scan.sharePrintableSheet(10);
    await scan.sharePrintableSheet(1);

    assert.deepEqual(shared.map((item) => item.fileName), [
      'Answer sheet - 10 questions.pdf',
      'Answer sheet - 1 question.pdf',
    ]);
    const text = Buffer.from(shared[0].pdf).toString('latin1');
    const labels = [...text.matchAll(/\((\d+)\) Tj/g)].map((match) => Number(match[1]));
    assert.deepEqual(labels, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.match(text, /\(10 questions\) Tj/);
    assert.match(text, /AC-10-V2/);
    // The shared sheet and the reader use one template: a photo of that sheet is read.
    const draft = (await draftOf()).draft;
    assert.equal(draft.templateId, 'AC-10-V2');
  });

  it('reports a printable sheet that cannot be shared with a typed error', async () => {
    const reasonOf = (promise) =>
      promise.then(
        () => assert.fail('was shared'),
        (error) => {
          assert.equal(error.name, 'SheetShareError');
          assert.equal(error.code, 'FILE_ERROR');
          return error.reason;
        }
      );
    // No sharing on the device.
    assert.equal(await reasonOf(build().sharePrintableSheet(10)), 'UNAVAILABLE');
    assert.equal(await reasonOf(build({ printableSheet: { share: async () => false } }).sharePrintableSheet(10)), 'UNAVAILABLE');
    // The device failed.
    const failing = { share: async () => { throw new Error('ENOSPC: raw device message'); } };
    assert.equal(await reasonOf(build({ printableSheet: failing }).sharePrintableSheet(10)), 'FAILED');
    // No sheet exists for a key longer than one page, or for a nonsense count.
    let calls = 0;
    const counting = { share: async () => (calls++, true) };
    for (const questionCount of [101, 120, 0, -3, 2.5]) {
      assert.equal(await reasonOf(build({ printableSheet: counting }).sharePrintableSheet(questionCount)), 'TOO_LONG');
    }
    assert.equal(calls, 0);
  });

  it('is refused until confirmed, reports the earlier result, and never replaces it', async () => {
    const first = await draftOf();
    const original = await first.scan.saveResult(first.draft, first.draft.review);
    assert.deepEqual(await first.scan.previousAttempts(SELECTION), [
      { id: original.id, score: 10, total: 10, createdAt: '2026-10-02T08:30:01.000Z' },
    ]);

    const second = await draftOf(marksOf(['B', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'B']));
    await assert.rejects(second.scan.saveResult(second.draft, second.draft.review), (error) => {
      assert.ok(error instanceof DuplicateAttemptError);
      assert.equal(error.code, 'DUPLICATE_ATTEMPT');
      assert.deepEqual(error.previous.map((attempt) => [attempt.id, attempt.score, attempt.total]), [[original.id, 10, 10]]);
      return true;
    });
    assert.equal(count('results'), 1);
    assert.deepEqual([...second.fake.store.keys()], [second.draft.previewUri]);

    // Another student is not a duplicate.
    assert.deepEqual(await second.scan.previousAttempts({ ...SELECTION, studentId: 'stu-2' }), []);
  });

  it('saves a confirmed second attempt as a separate result with its own id and image', async () => {
    const first = await draftOf();
    await first.scan.saveResult(first.draft, first.draft.review);

    const fake = fakeFileSystem({
      [CAPTURE]: photoBytes(marksOf(['B', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'B'])),
      ...Object.fromEntries(first.fake.store),
    });
    let ids = 10;
    const scan = createScanUseCases({
      subjects: createSqliteSubjectRepository(t.db),
      answerKeys: createSqliteAnswerKeyRepository(t.db),
      classSubjects: createSqliteClassSubjectRepository(t.db),
      students: createSqliteStudentRepository(t.db),
      results: createSqliteResultRepository(t.db),
      reader: typescriptSheetReader,
      images: createScanImageStore({ fileSystem: fake.fileSystem, newName: () => 'preview-second' }),
      idGenerator: { newId: () => `id-${++ids}` },
      clock: { now: () => '2026-10-03T09:00:00.000Z' },
    });
    const draft = await scan.readCapture(CAPTURE, SELECTION);
    const saved = await scan.saveResult(draft, draft.review, { confirmDuplicate: true });

    assert.equal(saved.id, 'id-11');
    assert.equal(saved.score, 9);
    assert.deepEqual(plain(t.all('SELECT id, score FROM results ORDER BY id')), [
      { id: 'id-1', score: 10 },
      { id: 'id-11', score: 9 },
    ]);
    assert.equal(count('student_answers'), 20);
    assert.equal(count('scan_records'), 2);
    assert.deepEqual([...fake.store.keys()].sort(), [`${DOCUMENTS}scans/id-1.png`, `${DOCUMENTS}scans/id-11.png`]);
    const attempts = await scan.previousAttempts(SELECTION);
    assert.deepEqual(attempts.map((attempt) => attempt.id), ['id-11', 'id-1']);
  });
});

// ---------------------------------------------------------------------------
// Scan files
// ---------------------------------------------------------------------------

describe('scan file cleanup', () => {
  beforeEach(openSeeded);

  it('removes leftover captures and previews and orphaned final images, and nothing else', async () => {
    const first = await draftOf();
    const saved = await first.scan.saveResult(first.draft, first.draft.review);
    const kept = `${DOCUMENTS}${saved.imagePath}`;

    const fake = fakeFileSystem({
      [kept]: first.fake.store.get(kept),
      [`${CACHE}Camera/abandoned.jpg`]: new Uint8Array(4),
      [`${CACHE}ImageManipulator/abandoned.png`]: new Uint8Array(4),
      [`${CACHE}scan-previews/abandoned.png`]: new Uint8Array(4),
      [`${DOCUMENTS}scans/orphan.png`]: new Uint8Array(4),
      [`${DOCUMENTS}SQLite/answer-checker.db`]: new Uint8Array(4),
      [`${CACHE}DocumentPicker/roster.csv`]: new Uint8Array(4),
      [GALLERY_PHOTO]: new Uint8Array(4),
    });

    await build({ fake }).cleanUpScanFiles();

    assert.deepEqual([...fake.store.keys()].sort(), [
      `${CACHE}DocumentPicker/roster.csv`,
      `${DOCUMENTS}SQLite/answer-checker.db`,
      kept,
      GALLERY_PHOTO,
    ].sort());
  });

  it('refuses to delete a final image by a path that leaves the scans folder', async () => {
    const fake = fakeFileSystem({ [`${DOCUMENTS}SQLite/answer-checker.db`]: new Uint8Array(4) });
    const store = createScanImageStore({ fileSystem: fake.fileSystem, newName: () => 'p' });
    await store.deleteFinal('scans/../SQLite/answer-checker.db');
    await store.deleteFinal('SQLite/answer-checker.db');
    await store.deleteFinal('/etc/passwd');
    assert.deepEqual(fake.log.deleted, []);
    await assert.rejects(store.keepPreview(GALLERY_PHOTO, 'id-1'), /Not a scan preview/);
  });

  it('never fails a scan because cleanup failed', async () => {
    const fake = fakeFileSystem();
    fake.fileSystem.listFiles = async () => {
      throw new Error('EACCES');
    };
    await build({ fake }).cleanUpScanFiles();
  });
});

// ---------------------------------------------------------------------------
// Deletion restrictions once results exist
// ---------------------------------------------------------------------------

describe('deleting records that results depend on', () => {
  beforeEach(async () => {
    await openSeeded();
    const { scan, draft } = await draftOf();
    await scan.saveResult(draft, draft.review);
  });

  it('blocks deleting the student, the answer key, and the subject, with counts', async () => {
    await assert.rejects(createSqliteStudentRepository(t.db).delete('stu-1'), (error) => {
      assert.ok(error instanceof StudentInUseError);
      assert.equal(error.resultCount, 1);
      return true;
    });
    await assert.rejects(createSqliteAnswerKeyRepository(t.db).delete('key-1'), (error) => {
      assert.ok(error instanceof AnswerKeyInUseError);
      assert.equal(error.resultCount, 1);
      return true;
    });
    await assert.rejects(createSqliteSubjectRepository(t.db).delete('sub-1'), (error) => {
      assert.ok(error instanceof SubjectInUseError);
      assert.equal(error.answerKeyCount, 2);
      return true;
    });
    assert.equal(count('results'), 1);
    assert.equal(count('student_answers'), 10);
  });

  it('blocks deleting the class of the scan, even after its students have moved away', async () => {
    const classes = createSqliteClassRepository(t.db);
    await assert.rejects(classes.delete('cls-1'), (error) => {
      assert.ok(error instanceof ClassInUseError);
      assert.equal(error.code, 'IN_USE');
      assert.deepEqual([error.studentCount, error.resultCount], [2, 1]);
      return true;
    });

    t.run("UPDATE students SET class_id = 'cls-2' WHERE class_id = 'cls-1'");
    await assert.rejects(classes.delete('cls-1'), (error) => {
      assert.deepEqual([error.studentCount, error.resultCount], [0, 1]);
      return true;
    });
    assert.equal(count('results'), 1);

    // A class without students or results can still be deleted.
    await classes.delete('cls-3');
    assert.equal(count('classes'), 2);
  });

  it('locks the scoring of the answer key that was used', async () => {
    const keys = createAnswerKeyUseCases({
      repository: createSqliteAnswerKeyRepository(t.db),
      clock: { now: () => T0 },
      idGenerator: { newId: () => 'x' },
    });
    await assert.rejects(
      keys.updateAnswerKey('key-1', { name: 'Midterm', subjectId: 'sub-1', questionCount: 10, answers: [...KEY.slice(0, 9), 'D'] }),
      (error) => error.code === 'ANSWER_KEY_LOCKED'
    );
  });
});
