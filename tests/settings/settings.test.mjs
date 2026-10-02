// Verifies Settings: migration 8, the stored preferences, the storage summary,
// temporary-file cleanup, and "Delete all academic data" with its file
// handling. Uses Node's built-in SQLite on disposable databases and an
// in-memory file system; nothing here touches a device.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { initializeDatabase } from '../../src/core/infrastructure/database/initialize-database.ts';
import { MIGRATIONS } from '../../src/core/infrastructure/database/migrations.ts';
import { createAnswerKeyUseCases } from '../../src/features/answer-keys/application/answer-key-use-cases.ts';
import { createSqliteAnswerKeyRepository } from '../../src/features/answer-keys/infrastructure/sqlite-answer-key-repository.ts';
import { createDashboardUseCases } from '../../src/features/dashboard/application/dashboard-use-cases.ts';
import { greetingForHour } from '../../src/features/dashboard/presentation/greeting-text.ts';
import { createSqliteDashboardRepository } from '../../src/features/dashboard/infrastructure/sqlite-dashboard-repository.ts';
import { createDemoDataUseCases } from '../../src/features/demo-data/application/demo-data-use-cases.ts';
import { createSqliteDemoDataRepository } from '../../src/features/demo-data/infrastructure/sqlite-demo-data-repository.ts';
import {
  CleanupError,
  ConfirmationPhraseError,
  InvalidTeacherNameError,
  createSettingsUseCases,
} from '../../src/features/settings/application/settings-use-cases.ts';
import {
  DELETE_ALL_PHRASE,
  TEACHER_NAME_MAX_LENGTH,
  cameraPermissionState,
  describeVersion,
  formatBytes,
  isDeleteAllPhrase,
  normalizeTeacherName,
  parseAppearance,
} from '../../src/features/settings/domain/settings.ts';
import { createAppFiles } from '../../src/features/settings/infrastructure/app-files.ts';
import { createSqliteAcademicDataRepository } from '../../src/features/settings/infrastructure/sqlite-academic-data-repository.ts';
import { createSqlitePreferenceStore } from '../../src/features/settings/infrastructure/sqlite-preference-store.ts';
import { createSqliteSubjectRepository } from '../../src/features/subjects/infrastructure/sqlite-subject-repository.ts';
import { createSubjectUseCases } from '../../src/features/subjects/application/subject-use-cases.ts';
import { openTestDatabase } from '../database/test-database.mjs';

const NOW = '2026-10-03T08:00:00.000Z';
const DOCUMENTS = 'file:///data/user/0/app/files/';
const CACHE = 'file:///data/user/0/app/cache/';
const ACADEMIC_TABLES = [
  'subjects', 'classes', 'class_subjects', 'students', 'answer_keys', 'answer_key_items',
  'results', 'student_answers', 'scan_records',
];
const bytes = (length) => new Uint8Array(length);

let t;

beforeEach(async () => {
  t = openTestDatabase();
  await initializeDatabase(t.db);
});

afterEach(() => {
  t.close();
});

const count = (table) => t.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
const academicCounts = () => Object.fromEntries(ACADEMIC_TABLES.map((table) => [table, count(table)]));
const reload = () => t.all('SELECT name FROM sqlite_master LIMIT 1');

/** An in-memory device: a cache folder, a documents folder, and everything else. */
function fakeFiles(files = {}, { failDelete = () => false, failList = false } = {}) {
  const store = new Map(Object.entries(files));
  const log = { deleted: [], moved: [] };
  return {
    store,
    log,
    fileSystem: {
      cacheDirectory: () => CACHE,
      documentDirectory: () => DOCUMENTS,
      listFiles: async (directory) => {
        if (failList) throw new Error('EIO: raw device message');
        return [...store.keys()].filter(
          (uri) => uri.startsWith(directory) && !uri.slice(directory.length).includes('/')
        );
      },
      size: async (uri) => store.get(uri)?.length ?? 0,
      exists: async (uri) => store.has(uri),
      move: async (from, to) => {
        store.set(to, store.get(from));
        store.delete(from);
        log.moved.push([from, to]);
      },
      delete: async (uri) => {
        if (failDelete(uri)) throw new Error('EBUSY: raw device message');
        log.deleted.push(uri);
        store.delete(uri);
      },
    },
  };
}

function build({ files = fakeFiles(), db = t.db } = {}) {
  return createSettingsUseCases({
    preferences: createSqlitePreferenceStore(db),
    academicData: createSqliteAcademicDataRepository(db),
    files: createAppFiles(files.fileSystem),
  });
}

/** The demo set: 2 subjects, 2 classes, 8 students, 3 answer keys, 16 results. */
async function seedAcademicData() {
  await createDemoDataUseCases({
    repository: createSqliteDemoDataRepository(t.db),
    clock: { now: () => NOW },
  }).addDemoData();
}

/** The image of every saved result, as files in the scans folder. */
function scanImagesOf(size = 1000) {
  return Object.fromEntries(
    t.all('SELECT image_path FROM scan_records').map((row) => [`${DOCUMENTS}${row.image_path}`, bytes(size)])
  );
}

// ---------------------------------------------------------------------------
// Migration 8
// ---------------------------------------------------------------------------

describe('migration 8: the app settings table', () => {
  it('brings a fresh database to version 8 with an empty settings table', async () => {
    assert.equal(MIGRATIONS.length, 8);
    assert.equal(t.get('PRAGMA user_version').user_version, 8);
    assert.deepEqual(
      t.all("SELECT name, type, pk, \"notnull\" FROM pragma_table_info('app_settings')").map((c) => ({ ...c })),
      [
        { name: 'key', type: 'TEXT', pk: 1, notnull: 1 },
        { name: 'value', type: 'TEXT', pk: 0, notnull: 1 },
      ]
    );
    assert.equal(t.get("SELECT strict FROM pragma_table_list WHERE name = 'app_settings'").strict, 1);
    assert.equal(count('app_settings'), 0);
  });

  it('upgrades a version-7 database and keeps every academic row exactly', async () => {
    t.close();
    t = openTestDatabase();
    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 7)), 7);
    await seedAcademicData();
    const dump = () => JSON.stringify(ACADEMIC_TABLES.map((table) => t.all(`SELECT * FROM ${table} ORDER BY 1, 2`)));
    const before = dump();

    assert.equal(await initializeDatabase(t.db), 8);
    reload();

    assert.equal(dump(), before);
    assert.equal(count('app_settings'), 0);
    assert.deepEqual(t.all('PRAGMA foreign_key_check'), []);
    assert.deepEqual(t.all('PRAGMA integrity_check').map((r) => ({ ...r })), [{ integrity_check: 'ok' }]);
  });

  it('upgrades from every earlier version, and does nothing when run again', async () => {
    for (let from = 1; from <= 7; from++) {
      t.close();
      t = openTestDatabase();
      await initializeDatabase(t.db, MIGRATIONS.slice(0, from));
      assert.equal(await initializeDatabase(t.db), 8, `from version ${from}`);
      reload();
      const schema = JSON.stringify(t.all('SELECT type, name, sql FROM sqlite_master ORDER BY type, name'));
      assert.equal(await initializeDatabase(t.db), 8);
      assert.equal(JSON.stringify(t.all('SELECT type, name, sql FROM sqlite_master ORDER BY type, name')), schema);
      assert.deepEqual(t.all('PRAGMA foreign_key_check'), []);
    }
  });

  it('keeps foreign keys on and the journal in WAL after initialization', () => {
    assert.equal(t.get('PRAGMA foreign_keys').foreign_keys, 1);
    assert.equal(t.get('PRAGMA journal_mode').journal_mode, 'wal');
  });

  it('holds preferences only: no account, credential, or academic column', () => {
    const columns = t.all("SELECT name FROM pragma_table_info('app_settings')").map((c) => c.name);
    assert.deepEqual(columns, ['key', 'value']);
    assert.deepEqual(t.all("SELECT * FROM pragma_foreign_key_list('app_settings')"), []);
    assert.throws(() => t.run("INSERT INTO app_settings VALUES ('', 'x')"), /CHECK/);
    assert.throws(() => t.run("INSERT INTO app_settings VALUES ('a', NULL)"), /NOT NULL/);
  });
});

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

describe('appearance preference', () => {
  it('follows the phone on a fresh install', async () => {
    assert.deepEqual(await build().getPreferences(), { appearance: 'system', teacherName: '' });
  });

  it('stores System, Light, and Dark, and returns the last one chosen', async () => {
    const settings = build();
    for (const appearance of ['dark', 'light', 'system', 'dark']) {
      await settings.setAppearance(appearance);
      assert.equal((await settings.getPreferences()).appearance, appearance);
    }
    // One row, whatever was chosen along the way.
    assert.deepEqual(t.all('SELECT * FROM app_settings').map((r) => ({ ...r })), [{ key: 'appearance', value: 'dark' }]);
  });

  it('is still there after the app is opened again', async () => {
    await build().setAppearance('dark');
    // A new set of use cases over the same database file, and the migrations run again.
    await initializeDatabase(t.db);
    assert.equal((await build().getPreferences()).appearance, 'dark');
  });

  it('falls back to the phone for a value it does not know, and never fails to read', async () => {
    t.run("INSERT INTO app_settings VALUES ('appearance', 'sepia')");
    assert.equal((await build().getPreferences()).appearance, 'system');
    for (const value of [null, undefined, '', 'Dark', 'DARK', 'auto']) assert.equal(parseAppearance(value), 'system');
    for (const value of ['system', 'light', 'dark']) assert.equal(parseAppearance(value), value);
    await build().setAppearance('neon');
    assert.equal(t.get("SELECT value FROM app_settings WHERE key = 'appearance'").value, 'system');
  });
});

describe('teacher display name', () => {
  it('is optional: empty by default, and the greeting says Teacher', async () => {
    assert.equal((await build().getPreferences()).teacherName, '');
    assert.equal(greetingForHour(8, ''), 'Good morning, Teacher');
    assert.equal(greetingForHour(8), 'Good morning, Teacher');
    assert.equal(greetingForHour(13, '   '), 'Good afternoon, Teacher');
  });

  it('is stored trimmed and used in the greeting', async () => {
    const settings = build();
    assert.equal(await settings.setTeacherName('   Ms.   Alex  Reyes '), 'Ms. Alex Reyes');
    assert.equal((await settings.getPreferences()).teacherName, 'Ms. Alex Reyes');
    assert.equal(greetingForHour(8, 'Alex'), 'Good morning, Alex');
    assert.equal(greetingForHour(12, 'Alex'), 'Good afternoon, Alex');
    assert.equal(greetingForHour(19, 'Alex'), 'Good evening, Alex');
  });

  it('can be cleared again', async () => {
    const settings = build();
    await settings.setTeacherName('Alex');
    assert.equal(await settings.setTeacherName('   '), '');
    assert.equal((await settings.getPreferences()).teacherName, '');
  });

  it('has a maximum length, counted in characters', async () => {
    const longest = 'ñ'.repeat(TEACHER_NAME_MAX_LENGTH);
    assert.deepEqual(normalizeTeacherName(longest), { ok: true, name: longest });
    assert.deepEqual(normalizeTeacherName(`${longest}x`), { ok: false, problem: 'TOO_LONG' });
    await assert.rejects(build().setTeacherName('x'.repeat(TEACHER_NAME_MAX_LENGTH + 1)), (error) => {
      assert.ok(error instanceof InvalidTeacherNameError);
      assert.equal(error.code, 'VALIDATION_ERROR');
      return true;
    });
    assert.equal(count('app_settings'), 0);
  });

  it('is kept as text, never run as SQL', async () => {
    const name = "Bo'); DROP TABLE students;--";
    assert.equal(await build().setTeacherName(name), name);
    assert.equal(count('students'), 0);
    assert.equal((await build().getPreferences()).teacherName, name);
  });
});

// ---------------------------------------------------------------------------
// Small rules
// ---------------------------------------------------------------------------

describe('settings rules', () => {
  it('names the camera permission states without asking for anything', () => {
    assert.equal(cameraPermissionState({ status: 'undetermined', canAskAgain: true }), 'NOT_REQUESTED');
    assert.equal(cameraPermissionState({ status: 'granted', canAskAgain: true }), 'ALLOWED');
    assert.equal(cameraPermissionState({ status: 'denied', canAskAgain: true }), 'DENIED');
    assert.equal(cameraPermissionState({ status: 'denied', canAskAgain: false }), 'DENIED_PERMANENTLY');
  });

  it('shows the version from the app configuration, with a build number when there is one', () => {
    assert.equal(describeVersion('1.0.0'), 'Version 1.0.0');
    assert.equal(describeVersion('1.2.3', 7), 'Version 1.2.3 (build 7)');
    assert.equal(describeVersion('1.2.3', '42'), 'Version 1.2.3 (build 42)');
    assert.equal(describeVersion('1.2.3', null), 'Version 1.2.3');
    assert.equal(describeVersion(undefined), 'Version unknown');
    // The version is written once, in the app configuration; the screen reads it from there.
    const app = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')).expo;
    const screen = readFileSync(new URL('../../src/features/settings/presentation/settings-screen.tsx', import.meta.url), 'utf8');
    assert.match(app.version, /^\d+\.\d+\.\d+$/);
    assert.match(screen, /Constants\.expoConfig/);
    assert.ok(!screen.includes(`'${app.version}'`) && !screen.includes(`"${app.version}"`));
  });

  it('formats sizes for people', () => {
    assert.deepEqual(
      [0, -5, 1, 512, 1023, 1024, 1536, 150_000, 1_048_576, 5_500_000, 3 * 1024 ** 3].map(formatBytes),
      ['0 B', '0 B', '1 B', '512 B', '1023 B', '1.0 KB', '1.5 KB', '146 KB', '1.0 MB', '5.2 MB', '3.0 GB']
    );
  });

  it('accepts the delete phrase only when typed exactly', () => {
    assert.equal(DELETE_ALL_PHRASE, 'DELETE ALL DATA');
    assert.equal(isDeleteAllPhrase('DELETE ALL DATA'), true);
    for (const typed of ['', 'delete all data', 'Delete All Data', 'DELETE ALL DATA ', ' DELETE ALL DATA', 'DELETE  ALL DATA', 'DELETE ALL', 'DELETE ALL DATA.']) {
      assert.equal(isDeleteAllPhrase(typed), false, JSON.stringify(typed));
    }
  });

  it('uses no network: no fetch, socket, or remote address in the settings code', () => {
    for (const file of [
      'application/settings-use-cases.ts', 'domain/settings.ts', 'infrastructure/app-files.ts',
      'infrastructure/expo-app-file-system.ts', 'infrastructure/sqlite-preference-store.ts',
      'infrastructure/sqlite-academic-data-repository.ts', 'presentation/settings-screen.tsx',
      'presentation/preferences-context.tsx',
    ]) {
      const source = readFileSync(new URL(`../../src/features/settings/${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|https?:\/\//, file);
    }
  });
});

// ---------------------------------------------------------------------------
// Storage summary
// ---------------------------------------------------------------------------

describe('storage summary', () => {
  it('is all zeros on an empty app', async () => {
    assert.deepEqual(await build().getStorageSummary(), {
      counts: { students: 0, classes: 0, subjects: 0, answerKeys: 0, results: 0 },
      scanImageBytes: 0,
      temporaryBytes: 0,
    });
  });

  it('counts the records and measures scan images and temporary files separately', async () => {
    await seedAcademicData();
    const files = fakeFiles({
      ...scanImagesOf(1000),
      [`${CACHE}scan-previews/p.png`]: bytes(300),
      [`${CACHE}Camera/c.jpg`]: bytes(200),
      [`${CACHE}ImageManipulator/m.png`]: bytes(100),
      [`${CACHE}DocumentPicker/roster.csv`]: bytes(50),
      [`${CACHE}Answer sheet - 10 questions.pdf`]: bytes(25),
      [`${DOCUMENTS}scans/orphan.png`]: bytes(7),
      [`${DOCUMENTS}scans-deleting/gone.png`]: bytes(3),
    });
    assert.deepEqual(await build({ files }).getStorageSummary(), {
      counts: { students: 8, classes: 2, subjects: 2, answerKeys: 3, results: 16 },
      // Every image in the scans folder, including the one no result refers to...
      scanImageBytes: 16 * 1000 + 7,
      // ...which is also counted as removable, with the rest of the leftovers.
      temporaryBytes: 300 + 200 + 100 + 50 + 25 + 7 + 3,
    });
    assert.deepEqual([files.log.deleted, files.log.moved], [[], []]);
  });

  it('still reports what it can when the files or the database cannot be read', async () => {
    await seedAcademicData();
    const noFiles = await build({ files: fakeFiles({}, { failList: true }) }).getStorageSummary();
    assert.deepEqual(noFiles, {
      counts: { students: 8, classes: 2, subjects: 2, answerKeys: 3, results: 16 },
      scanImageBytes: null,
      temporaryBytes: null,
    });
    const broken = { ...t.db, getFirstAsync: async () => { throw new Error('disk I/O error'); } };
    const noCounts = await build({ db: broken }).getStorageSummary();
    assert.equal(noCounts.counts, null);
    assert.equal(noCounts.scanImageBytes, 0);
  });
});

// ---------------------------------------------------------------------------
// Temporary-file cleanup
// ---------------------------------------------------------------------------

describe('cleaning temporary files', () => {
  /** Things the app must never remove. */
  const OUTSIDE = {
    'file:///storage/emulated/0/Download/class-list.csv': bytes(900),
    'file:///storage/emulated/0/DCIM/Camera/IMG_0001.jpg': bytes(900),
    [`${DOCUMENTS}SQLite/answer-checker.db`]: bytes(900),
    [`${DOCUMENTS}SQLite/answer-checker.db-wal`]: bytes(900),
    [`${CACHE}some-other-library/data.bin`]: bytes(900),
    [`${CACHE}notes.txt`]: bytes(900),
    [`${CACHE}Report - 10 questions.pdf`]: bytes(900),
    [`${CACHE}scan-previews/nested/deep.png`]: bytes(900),
    [`${DOCUMENTS}scans/sub/folder.png`]: bytes(900),
    [`${DOCUMENTS}scans/readme.txt`]: bytes(900),
    'file:///data/user/0/other.app/cache/scan-previews/x.png': bytes(900),
  };
  const TEMPORARY = {
    [`${CACHE}scan-previews/p.png`]: bytes(300),
    [`${CACHE}Camera/c.jpg`]: bytes(200),
    [`${CACHE}ImageManipulator/m.png`]: bytes(100),
    [`${CACHE}DocumentPicker/roster.csv`]: bytes(50),
    [`${CACHE}Answer sheet - 10 questions.pdf`]: bytes(25),
    [`${CACHE}Answer sheet - 1 question.pdf`]: bytes(5),
    [`${DOCUMENTS}scans/orphan.png`]: bytes(7),
    [`${DOCUMENTS}scans-deleting/gone.png`]: bytes(3),
  };

  it('removes the app\'s own leftovers, reports the bytes freed, and nothing else', async () => {
    await seedAcademicData();
    const images = scanImagesOf(1000);
    const files = fakeFiles({ ...images, ...TEMPORARY, ...OUTSIDE });

    const freed = await build({ files }).cleanTemporaryFiles();

    assert.equal(freed, 300 + 200 + 100 + 50 + 25 + 5 + 7 + 3);
    assert.deepEqual([...files.store.keys()].sort(), [...Object.keys(images), ...Object.keys(OUTSIDE)].sort());
    assert.deepEqual(files.log.deleted.sort(), Object.keys(TEMPORARY).sort());
    // Every result still has its image, and no record was touched.
    assert.equal(count('results'), 16);
    assert.equal(count('scan_records'), 16);
  });

  it('is idempotent: a second run removes nothing', async () => {
    await seedAcademicData();
    const files = fakeFiles({ ...scanImagesOf(), ...TEMPORARY });
    const settings = build({ files });
    assert.ok((await settings.cleanTemporaryFiles()) > 0);
    const after = [...files.store.keys()].sort();
    assert.equal(await settings.cleanTemporaryFiles(), 0);
    assert.equal(await settings.cleanTemporaryFiles(), 0);
    assert.deepEqual([...files.store.keys()].sort(), after);
    assert.equal((await settings.getStorageSummary()).temporaryBytes, 0);
  });

  it('removes nothing on an app with no leftovers', async () => {
    const files = fakeFiles({ ...OUTSIDE });
    assert.equal(await build({ files }).cleanTemporaryFiles(), 0);
    assert.equal(files.log.deleted.length, 0);
  });

  it('gives a staged image back to a result that still exists, and removes one whose result is gone', async () => {
    await seedAcademicData();
    const images = scanImagesOf();
    const [kept] = Object.keys(images);
    const name = kept.slice(`${DOCUMENTS}scans/`.length);
    // Its deletion was interrupted before the rows were deleted: the image waits in staging.
    const store = { ...images, [`${DOCUMENTS}scans-deleting/${name}`]: images[kept], [`${DOCUMENTS}scans-deleting/gone.png`]: bytes(3) };
    delete store[kept];
    const files = fakeFiles(store);

    // What can be removed does not include the image that belongs to a result.
    assert.equal((await build({ files }).getStorageSummary()).temporaryBytes, 3);
    assert.equal(await build({ files }).cleanTemporaryFiles(), 3);

    assert.ok(files.store.has(kept));
    assert.deepEqual(files.log.moved, [[`${DOCUMENTS}scans-deleting/${name}`, kept]]);
    assert.deepEqual(files.log.deleted, [`${DOCUMENTS}scans-deleting/gone.png`]);
  });

  it('removes a staged copy when the result already has its image back', async () => {
    await seedAcademicData();
    const images = scanImagesOf();
    const [kept] = Object.keys(images);
    const name = kept.slice(`${DOCUMENTS}scans/`.length);
    const files = fakeFiles({ ...images, [`${DOCUMENTS}scans-deleting/${name}`]: bytes(9) });
    assert.equal(await build({ files }).cleanTemporaryFiles(), 9);
    assert.ok(files.store.has(kept));
  });

  it('cleans nothing when the saved images cannot be told from the leftovers', async () => {
    await seedAcademicData();
    const files = fakeFiles({ ...scanImagesOf(), ...TEMPORARY });
    const broken = { ...t.db, getAllAsync: async () => { throw new Error('disk I/O error'); } };
    await assert.rejects(build({ files, db: broken }).cleanTemporaryFiles(), (error) => {
      assert.ok(error instanceof CleanupError);
      assert.equal(error.code, 'FILE_ERROR');
      assert.doesNotMatch(error.message, /disk I\/O/);
      return true;
    });
    assert.equal(files.log.deleted.length, 0);
  });

  it('reports a failure, without a raw device message, when nothing could be removed', async () => {
    const files = fakeFiles({ ...TEMPORARY }, { failDelete: () => true });
    await assert.rejects(build({ files }).cleanTemporaryFiles(), (error) => {
      assert.ok(error instanceof CleanupError);
      assert.doesNotMatch(error.message, /EBUSY|raw/);
      return true;
    });
    assert.equal(files.store.size, Object.keys(TEMPORARY).length);
  });

  it('frees what it can when one file is stuck, and gets the rest next time', async () => {
    let stuck = true;
    const files = fakeFiles({ ...TEMPORARY }, { failDelete: (uri) => stuck && uri.endsWith('c.jpg') });
    assert.equal(await build({ files }).cleanTemporaryFiles(), 300 + 100 + 50 + 25 + 5 + 7 + 3);
    stuck = false;
    assert.equal(await build({ files }).cleanTemporaryFiles(), 200);
    assert.equal(files.store.size, 0);
  });
});

// ---------------------------------------------------------------------------
// Delete all academic data
// ---------------------------------------------------------------------------

describe('deleting all academic data', () => {
  const OUTSIDE = {
    'file:///storage/emulated/0/Download/class-list.csv': bytes(900),
    [`${DOCUMENTS}SQLite/answer-checker.db`]: bytes(900),
    [`${CACHE}some-other-library/data.bin`]: bytes(900),
    [`${DOCUMENTS}notes.txt`]: bytes(900),
  };
  const LEFTOVERS = {
    [`${CACHE}scan-previews/p.png`]: bytes(300),
    [`${CACHE}DocumentPicker/roster.csv`]: bytes(50),
    [`${CACHE}Answer sheet - 10 questions.pdf`]: bytes(25),
    [`${DOCUMENTS}scans-deleting/gone.png`]: bytes(3),
  };

  beforeEach(seedAcademicData);

  it('requires the exact phrase, and deletes nothing without it', async () => {
    const files = fakeFiles({ ...scanImagesOf() });
    const before = academicCounts();
    for (const typed of ['', 'delete all data', 'DELETE ALL', 'DELETE ALL DATA ', 'yes']) {
      await assert.rejects(build({ files }).deleteAllAcademicData(typed), (error) => {
        assert.ok(error instanceof ConfirmationPhraseError);
        assert.equal(error.code, 'VALIDATION_ERROR');
        return true;
      });
    }
    await assert.rejects(build({ files }).deleteAllAcademicData(), ConfirmationPhraseError);
    assert.deepEqual(academicCounts(), before);
    assert.equal(files.store.size, 16);
  });

  it('empties every academic table and removes every scan image and leftover, and nothing else', async () => {
    const files = fakeFiles({ ...scanImagesOf(), ...LEFTOVERS, ...OUTSIDE });

    assert.deepEqual(await build({ files }).deleteAllAcademicData(DELETE_ALL_PHRASE), { filesRemoved: true });

    assert.deepEqual(academicCounts(), Object.fromEntries(ACADEMIC_TABLES.map((table) => [table, 0])));
    assert.deepEqual([...files.store.keys()].sort(), Object.keys(OUTSIDE).sort());
    assert.deepEqual(t.all('PRAGMA foreign_key_check'), []);
    assert.deepEqual(t.all('PRAGMA integrity_check').map((r) => ({ ...r })), [{ integrity_check: 'ok' }]);
    // Physically gone: no flag, no hidden copy, no table holding the old rows.
    const tables = t.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name).sort();
    assert.deepEqual(tables, [...ACADEMIC_TABLES, 'app_settings'].sort());
  });

  it('keeps the schema version and the app preferences', async () => {
    const settings = build();
    await settings.setAppearance('dark');
    await settings.setTeacherName('Alex');

    await settings.deleteAllAcademicData(DELETE_ALL_PHRASE);

    assert.equal(t.get('PRAGMA user_version').user_version, MIGRATIONS.length);
    assert.deepEqual(await settings.getPreferences(), { appearance: 'dark', teacherName: 'Alex' });
  });

  it('leaves Home and the storage summary at zero', async () => {
    const files = fakeFiles({ ...scanImagesOf(), ...LEFTOVERS });
    const settings = build({ files });
    await settings.deleteAllAcademicData(DELETE_ALL_PHRASE);

    assert.deepEqual(await settings.getStorageSummary(), {
      counts: { students: 0, classes: 0, subjects: 0, answerKeys: 0, results: 0 },
      scanImageBytes: 0,
      temporaryBytes: 0,
    });
    const home = await createDashboardUseCases({ repository: createSqliteDashboardRepository(t.db) }).getDashboard();
    assert.deepEqual(home, {
      counts: { students: 0, classes: 0, answerKeys: 0, results: 0, scannedToday: 0 },
      recentResults: [], recentAnswerKeys: [], lastScan: null, isIncomplete: false,
    });
  });

  it('stays empty after the app is opened again, and new records can be created', async () => {
    await build().deleteAllAcademicData(DELETE_ALL_PHRASE);

    assert.equal(await initializeDatabase(t.db), MIGRATIONS.length);
    assert.deepEqual(academicCounts(), Object.fromEntries(ACADEMIC_TABLES.map((table) => [table, 0])));

    let ids = 0;
    const idGenerator = { newId: () => `new-${++ids}` };
    const clock = { now: () => NOW };
    const subject = await createSubjectUseCases({ repository: createSqliteSubjectRepository(t.db), clock, idGenerator }).addSubject('Mathematics');
    const key = await createAnswerKeyUseCases({ repository: createSqliteAnswerKeyRepository(t.db), clock, idGenerator })
      .createAnswerKey({ name: 'Quiz', subjectId: subject.id, questionCount: 2, answers: ['A', 'B'] });
    assert.equal(key.name, 'Quiz');
    assert.deepEqual([count('subjects'), count('answer_keys'), count('answer_key_items')], [1, 1, 2]);
    // The demo set, whose names were used before, fits again too.
    await seedAcademicData();
    assert.equal(count('results'), 16);
  });

  it('deletes nothing at all when the database fails: rows and files stay as they were', async () => {
    const files = fakeFiles({ ...scanImagesOf(), ...LEFTOVERS });
    const before = academicCounts();
    const failing = {
      ...t.db,
      runAsync: async (sql, params) => {
        // The last table of the transaction fails, after eight succeeded.
        if (/^DELETE FROM subjects/.test(sql)) throw new Error('disk I/O error');
        return t.db.runAsync(sql, params);
      },
    };
    await assert.rejects(build({ files, db: failing }).deleteAllAcademicData(DELETE_ALL_PHRASE), (error) => {
      assert.equal(error.code, 'DATABASE_ERROR');
      assert.doesNotMatch(error.message, /disk I\/O/);
      return true;
    });

    assert.deepEqual(academicCounts(), before);
    assert.equal(files.store.size, 16 + Object.keys(LEFTOVERS).length);
    assert.deepEqual(files.log.deleted, []);
    // Every result still has its image.
    for (const row of t.all('SELECT image_path FROM scan_records')) assert.ok(files.store.has(`${DOCUMENTS}${row.image_path}`));
  });

  it('keeps the rows deleted when a file cannot be removed, and the next cleanup removes it', async () => {
    let stuck = true;
    const files = fakeFiles({ ...scanImagesOf(), ...LEFTOVERS }, { failDelete: (uri) => stuck && uri.includes('/scans/') });
    const settings = build({ files });

    assert.deepEqual(await settings.deleteAllAcademicData(DELETE_ALL_PHRASE), { filesRemoved: false });

    assert.equal(count('results') + count('students') + count('subjects'), 0);
    // What stayed behind belongs to no record: it is an orphan the cleanup knows.
    assert.equal(files.store.size, 16);
    assert.equal((await settings.getStorageSummary()).temporaryBytes, 16 * 1000);
    stuck = false;
    assert.equal(await settings.cleanTemporaryFiles(), 16 * 1000);
    assert.equal(files.store.size, 0);
  });

  it('survives a double submission', async () => {
    const files = fakeFiles({ ...scanImagesOf() });
    const settings = build({ files });
    const outcomes = await Promise.allSettled([
      settings.deleteAllAcademicData(DELETE_ALL_PHRASE),
      settings.deleteAllAcademicData(DELETE_ALL_PHRASE),
    ]);
    assert.deepEqual(outcomes.map((outcome) => outcome.status), ['fulfilled', 'fulfilled']);
    assert.equal(count('results'), 0);
    assert.equal(files.store.size, 0);
  });

  it('works on an already empty app', async () => {
    await build().deleteAllAcademicData(DELETE_ALL_PHRASE);
    assert.deepEqual(await build().deleteAllAcademicData(DELETE_ALL_PHRASE), { filesRemoved: true });
  });
});
