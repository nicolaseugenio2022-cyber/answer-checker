// Verifies migration 3, the Student rules, the SQLite student repository, the
// CSV roster reader, the import use cases, and the temporary-file lifecycle.
// Uses real SQLite on disposable databases and fakes for the file system; it
// never touches a real user file.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { RecordNotFoundError } from '../../src/core/application/errors.ts';
import { parseCsv } from '../../src/core/domain/csv.ts';
import { DatabaseError } from '../../src/core/infrastructure/database/database-error.ts';
import { initializeDatabase } from '../../src/core/infrastructure/database/initialize-database.ts';
import { MIGRATIONS } from '../../src/core/infrastructure/database/migrations.ts';
import { ClassNotFoundError } from '../../src/features/classes/application/class-repository.ts';
import { createSqliteClassRepository } from '../../src/features/classes/infrastructure/sqlite-class-repository.ts';
import {
  ROSTER_FILE_MAX_BYTES,
  RosterFileError,
  initialRosterSelection,
  resolveRoster,
} from '../../src/features/students/application/roster-import.ts';
import {
  DuplicateStudentIdError,
  InvalidStudentError,
  StudentInUseError,
} from '../../src/features/students/application/student-repository.ts';
import { createStudentUseCases } from '../../src/features/students/application/student-use-cases.ts';
import { readRoster, suggestClassForGroup } from '../../src/features/students/domain/roster.ts';
import {
  STUDENT_ID_MAX_LENGTH,
  STUDENT_NAME_MAX_LENGTH,
} from '../../src/features/students/domain/student.ts';
import { createRosterFilePicker } from '../../src/features/students/infrastructure/roster-file-picker.ts';
import { createSqliteStudentRepository } from '../../src/features/students/infrastructure/sqlite-student-repository.ts';
import { openTestDatabase } from './test-database.mjs';

const T0 = '2026-10-02T08:30:00.000Z';

let t;

afterEach(() => {
  t.close();
});

const userVersion = () => t.get('PRAGMA user_version').user_version;
const studentRows = () => t.all('SELECT * FROM students ORDER BY id').map((row) => ({ ...row }));
const studentCount = () => t.get('SELECT COUNT(*) AS n FROM students').n;

function insertClass(id, name) {
  t.run('INSERT INTO classes VALUES (?, ?, ?, ?)', id, name, T0, T0);
}

function insertStudent(id, classId, studentNumber, fullName) {
  t.run('INSERT INTO students VALUES (?, ?, ?, ?, ?, ?)', id, classId, studentNumber, fullName, T0, T0);
}

/** A subject, an answer key, and one saved result for the student. */
function insertResultFor(studentId, classId, resultId = `res-${studentId}`) {
  t.run('INSERT OR IGNORE INTO subjects VALUES (?, ?, ?, ?)', 'sub-1', 'Mathematics', T0, T0);
  t.run('INSERT INTO answer_keys VALUES (?, ?, ?, ?, ?, ?)', `key-${resultId}`, 'sub-1', `Quiz ${resultId}`, 5, T0, T0);
  t.run("INSERT INTO results (id, answer_key_id, student_id, class_id, score, total, template_id, captured_at, created_at) VALUES (?1, ?2, ?3, (SELECT class_id FROM students WHERE id = ?3), ?4, ?5, 'AC-40-V1', ?6, ?6)", resultId, `key-${resultId}`, studentId, 3, 5, T0);
}

/** A picker that never opens; for use cases that do not touch files. */
const noFiles = {
  pick: async () => null,
  cleanUpStale: async () => undefined,
};

/** Use cases with ids id-1, id-2, ... and a clock that advances one second per reading. */
function build({ db = t.db, rosterFilePicker = noFiles } = {}) {
  let ids = 0;
  let ticks = 0;
  return createStudentUseCases({
    repository: createSqliteStudentRepository(db),
    classRepository: createSqliteClassRepository(db),
    rosterFilePicker,
    idGenerator: { newId: () => `id-${++ids}` },
    clock: { now: () => new Date(Date.parse(T0) + 1000 * ticks++).toISOString() },
  });
}

/** A connection whose matching write is carried out and then reported as failed. */
function failingAfterWrite(db, pattern, onNth = 1) {
  let seen = 0;
  return {
    ...db,
    runAsync: async (sql, params = []) => {
      const result = await db.runAsync(sql, params);
      if (pattern.test(sql.trim()) && ++seen === onNth) throw new Error('disk I/O error');
      return result;
    },
  };
}

async function openMigrated() {
  t = openTestDatabase();
  await initializeDatabase(t.db);
  insertClass('cls-a', 'BSIT 1A');
  insertClass('cls-b', 'Grade 11 STEM-A');
}

describe('migration 3: Student ID unique across classes', () => {
  it('brings a fresh database to the latest version with the unique index', async () => {
    t = openTestDatabase();
    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 3)), 3);
    assert.ok(MIGRATIONS.length >= 3);
    assert.equal(userVersion(), 3);
    const index = t.get("SELECT sql FROM sqlite_master WHERE name = 'idx_students_student_number'");
    assert.match(index.sql, /UNIQUE INDEX .* \(student_number COLLATE NOCASE\)/);
  });

  it('upgrades a version-2 database and keeps its classes, subjects, assignments, and students', async () => {
    t = openTestDatabase();
    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 2)), 2);
    insertClass('cls-a', 'BSIT 1A');
    insertClass('cls-b', 'BSIT 1B');
    t.run('INSERT INTO subjects VALUES (?, ?, ?, ?)', 'sub-1', 'Programming 1', T0, T0);
    t.run('INSERT INTO class_subjects VALUES (?, ?, ?)', 'cls-a', 'sub-1', T0);
    insertStudent('stu-1', 'cls-a', '2026-001', 'Maria Santos');
    insertStudent('stu-2', 'cls-b', '2026-002', 'Paolo Garcia');
    const tables = ['classes', 'subjects', 'class_subjects', 'students'];
    const before = Object.fromEntries(
      tables.map((table) => [table, t.all(`SELECT * FROM ${table} ORDER BY 1, 2`)])
    );

    assert.equal(await initializeDatabase(t.db, MIGRATIONS.slice(0, 3)), 3);

    assert.equal(userVersion(), 3);
    for (const table of tables) {
      assert.deepEqual(t.all(`SELECT * FROM ${table} ORDER BY 1, 2`), before[table], table);
    }
    await assert.rejects(
      build().addStudent({ studentNumber: '2026-001', fullName: 'Other', classId: 'cls-b' }),
      DuplicateStudentIdError
    );
  });

  it('rejects the same Student ID in another class, ignoring letter case, at the database level', async () => {
    await openMigrated();
    insertStudent('stu-1', 'cls-a', 'shs-001', 'Maria Santos');
    assert.throws(
      () => insertStudent('stu-2', 'cls-b', 'SHS-001', 'Paolo Garcia'),
      /UNIQUE constraint failed/
    );
  });
});

describe('students: create, read, and list', () => {
  beforeEach(openMigrated);

  it('creates a student with the injected id and timestamp and reads it back with its class name', async () => {
    const students = build();
    const created = await students.addStudent({
      studentNumber: '2026-001',
      fullName: 'Maria Santos',
      classId: 'cls-a',
    });

    assert.deepEqual(created, {
      id: 'id-1',
      studentNumber: '2026-001',
      fullName: 'Maria Santos',
      classId: 'cls-a',
      createdAt: T0,
      updatedAt: T0,
    });
    assert.deepEqual(studentRows(), [
      {
        id: 'id-1',
        class_id: 'cls-a',
        student_number: '2026-001',
        full_name: 'Maria Santos',
        created_at: T0,
        updated_at: T0,
      },
    ]);
    assert.deepEqual(await students.getStudent('id-1'), { ...created, className: 'BSIT 1A' });
    assert.equal(await students.getStudent('missing'), null);
  });

  it('trims surrounding whitespace from every field', async () => {
    const created = await build().addStudent({
      studentNumber: '  2026-001\t',
      fullName: '\n Maria  Santos  ',
      classId: ' cls-a ',
    });
    assert.equal(created.studentNumber, '2026-001');
    assert.equal(created.fullName, 'Maria  Santos');
    assert.equal(created.classId, 'cls-a');
  });

  it('keeps Unicode names exactly and counts their characters, not UTF-16 units', async () => {
    const students = build();
    const name = 'José Ñuñez Peñaranda 😀';
    assert.equal((await students.addStudent({ studentNumber: 'A1', fullName: name, classId: 'cls-a' })).fullName, name);

    const longest = '😀'.repeat(STUDENT_NAME_MAX_LENGTH);
    assert.ok(longest.length > STUDENT_NAME_MAX_LENGTH);
    await students.addStudent({ studentNumber: 'A2', fullName: longest, classId: 'cls-a' });
    await assert.rejects(
      students.addStudent({ studentNumber: 'A3', fullName: `${longest}😀`, classId: 'cls-a' }),
      InvalidStudentError
    );
  });

  it('lists by class name, then full name ignoring case, then Student ID, then id', async () => {
    insertClass('cls-c', 'abm 12');
    insertStudent('s1', 'cls-b', '300', 'zara Cruz');
    insertStudent('s2', 'cls-a', '200', 'maria Santos');
    insertStudent('s3', 'cls-a', '100', 'Maria Santos');
    insertStudent('s4', 'cls-a', '900', 'Ana Reyes');
    insertStudent('s5', 'cls-c', '500', 'Bea Lim');
    insertStudent('s6', 'cls-b', '250', 'Ana Reyes');

    const listed = await build().listStudents();

    assert.deepEqual(
      listed.map((student) => `${student.className} / ${student.fullName} / ${student.studentNumber}`),
      [
        'abm 12 / Bea Lim / 500',
        'BSIT 1A / Ana Reyes / 900',
        'BSIT 1A / Maria Santos / 100',
        'BSIT 1A / maria Santos / 200',
        'Grade 11 STEM-A / Ana Reyes / 250',
        'Grade 11 STEM-A / zara Cruz / 300',
      ]
    );
    assert.deepEqual(await build().listStudents(), listed);
  });

  it('filters by class', async () => {
    insertStudent('s1', 'cls-a', '100', 'Ana Reyes');
    insertStudent('s2', 'cls-b', '200', 'Bea Lim');
    insertStudent('s3', 'cls-a', '300', 'Carl Uy');

    const students = build();
    assert.deepEqual((await students.listStudents({ classId: 'cls-a' })).map((s) => s.id), ['s1', 's3']);
    assert.deepEqual((await students.listStudents({ classId: 'cls-b' })).map((s) => s.id), ['s2']);
    assert.deepEqual(await students.listStudents({ classId: 'cls-none' }), []);
    assert.equal((await students.listStudents({ classId: null })).length, 3);
  });

  it('searches by Student ID and by name, ignoring letter case, within the class filter', async () => {
    insertStudent('s1', 'cls-a', 'SHS-001', 'Maria Santos');
    insertStudent('s2', 'cls-b', 'COL-001', 'Paolo Garcia');
    insertStudent('s3', 'cls-a', 'SHS-002', 'José Ñuñez');

    const students = build();
    const ids = async (filter) => (await students.listStudents(filter)).map((s) => s.id);

    assert.deepEqual(await ids({ search: 'shs-00' }), ['s3', 's1']);
    assert.deepEqual(await ids({ search: 'COL' }), ['s2']);
    assert.deepEqual(await ids({ search: '  santos ' }), ['s1']);
    assert.deepEqual(await ids({ search: 'ñUÑEZ' }), ['s3']);
    assert.deepEqual(await ids({ search: '001' }), ['s1', 's2']);
    assert.deepEqual(await ids({ search: '001', classId: 'cls-b' }), ['s2']);
    assert.deepEqual(await ids({ search: 'nobody' }), []);
    assert.deepEqual(await ids({ search: '%' }), []);
    assert.equal((await ids({ search: '   ' })).length, 3);
  });
});

describe('students: validation and duplicates', () => {
  beforeEach(openMigrated);

  const problemsOf = async (promise) => {
    let problems;
    await assert.rejects(promise, (error) => {
      assert.ok(error instanceof InvalidStudentError);
      assert.equal(error.code, 'VALIDATION_ERROR');
      problems = error.problems;
      return true;
    });
    return problems;
  };

  it('requires a Student ID, a full name, and a class, and reports every problem', async () => {
    const problems = await problemsOf(
      build().addStudent({ studentNumber: '  ', fullName: '', classId: ' ' })
    );
    assert.deepEqual(problems, [
      { field: 'studentNumber', problem: 'EMPTY' },
      { field: 'fullName', problem: 'EMPTY' },
      { field: 'classId', problem: 'EMPTY' },
    ]);
    assert.equal(studentCount(), 0);
  });

  it('accepts values of exactly the maximum length and rejects one character more', async () => {
    const students = build();
    const id = 'x'.repeat(STUDENT_ID_MAX_LENGTH);
    const name = 'y'.repeat(STUDENT_NAME_MAX_LENGTH);
    await students.addStudent({ studentNumber: id, fullName: name, classId: 'cls-a' });

    assert.deepEqual(
      await problemsOf(students.addStudent({ studentNumber: `${id}x`, fullName: `${name}y`, classId: 'cls-a' })),
      [
        { field: 'studentNumber', problem: 'TOO_LONG', maxLength: STUDENT_ID_MAX_LENGTH },
        { field: 'fullName', problem: 'TOO_LONG', maxLength: STUDENT_NAME_MAX_LENGTH },
      ]
    );
    assert.equal(studentCount(), 1);
  });

  it('rejects a Student ID that another student has, in any class and any letter case', async () => {
    const students = build();
    await students.addStudent({ studentNumber: 'shs-001', fullName: 'Maria Santos', classId: 'cls-a' });

    for (const duplicate of ['shs-001', 'SHS-001', '  Shs-001 ']) {
      await assert.rejects(
        students.addStudent({ studentNumber: duplicate, fullName: 'Someone Else', classId: 'cls-b' }),
        (error) => {
          assert.ok(error instanceof DuplicateStudentIdError);
          assert.equal(error.code, 'DUPLICATE_STUDENT_ID');
          return true;
        }
      );
    }
    assert.equal(studentCount(), 1);
  });

  it('treats ids that differ only in the case of a non-ASCII letter as duplicates', async () => {
    const students = build();
    await students.addStudent({ studentNumber: 'ÑU-1', fullName: 'A', classId: 'cls-a' });
    await assert.rejects(
      students.addStudent({ studentNumber: 'ñu-1', fullName: 'B', classId: 'cls-a' }),
      DuplicateStudentIdError
    );
  });

  it('reports the UNIQUE index itself as a duplicate when the earlier check is bypassed', async () => {
    insertStudent('s1', 'cls-a', 'SHS-001', 'Maria Santos');
    const blind = {
      ...t.db,
      getAllAsync: async (sql, params) =>
        sql.startsWith('SELECT id, student_number') ? [] : t.db.getAllAsync(sql, params),
    };
    await assert.rejects(
      build({ db: blind }).addStudent({ studentNumber: 'shs-001', fullName: 'B', classId: 'cls-b' }),
      DuplicateStudentIdError
    );
    assert.equal(studentCount(), 1);
  });

  it('rejects a class that does not exist', async () => {
    await assert.rejects(
      build().addStudent({ studentNumber: '1', fullName: 'A', classId: 'missing' }),
      (error) => {
        assert.ok(error instanceof ClassNotFoundError);
        assert.equal(error.code, 'NOT_FOUND');
        assert.equal(error.id, 'missing');
        return true;
      }
    );
    assert.equal(studentCount(), 0);
  });
});

describe('students: update and move', () => {
  beforeEach(async () => {
    await openMigrated();
    insertStudent('s1', 'cls-a', 'SHS-001', 'Maria Santos');
    insertStudent('s2', 'cls-a', 'SHS-002', 'Paolo Garcia');
  });

  const input = (changes) => ({
    studentNumber: 'SHS-001',
    fullName: 'Maria Santos',
    classId: 'cls-a',
    ...changes,
  });

  it('changes the name and updated_at and keeps the id and created_at', async () => {
    const updated = await build().updateStudent('s1', input({ fullName: '  Maria S. Cruz ' }));
    assert.deepEqual(updated, {
      id: 's1',
      studentNumber: 'SHS-001',
      fullName: 'Maria S. Cruz',
      classId: 'cls-a',
      createdAt: T0,
      updatedAt: T0,
    });
    const second = await build().updateStudent('s1', input({ fullName: 'Maria Cruz' }));
    assert.equal(second.createdAt, T0);
    assert.equal(studentRows()[0].full_name, 'Maria Cruz');
  });

  it('sets updated_at from the clock when something changed', async () => {
    const students = build();
    await students.addStudent({ studentNumber: 'X', fullName: 'First', classId: 'cls-a' });
    const updated = await students.updateStudent('id-1', {
      studentNumber: 'X',
      fullName: 'Second',
      classId: 'cls-a',
    });
    assert.equal(updated.createdAt, T0);
    assert.equal(updated.updatedAt, '2026-10-02T08:30:01.000Z');
  });

  it('changes the Student ID, including only its letter case', async () => {
    const students = build();
    assert.equal((await students.updateStudent('s1', input({ studentNumber: 'SHS-100' }))).studentNumber, 'SHS-100');
    assert.equal((await students.updateStudent('s1', input({ studentNumber: 'shs-100' }))).studentNumber, 'shs-100');
    assert.equal(t.get('SELECT student_number FROM students WHERE id = ?', 's1').student_number, 'shs-100');
  });

  it('moves a student to another class', async () => {
    const moved = await build().updateStudent('s1', input({ classId: 'cls-b' }));
    assert.equal(moved.classId, 'cls-b');
    assert.equal((await build().getStudent('s1')).className, 'Grade 11 STEM-A');
    assert.deepEqual((await build().listStudents({ classId: 'cls-a' })).map((s) => s.id), ['s2']);
  });

  it('does nothing when nothing changed', async () => {
    const calls = [];
    const spy = {
      ...t.db,
      runAsync: (sql, params) => {
        calls.push(sql);
        return t.db.runAsync(sql, params);
      },
    };
    const result = await build({ db: spy }).updateStudent('s1', input({ fullName: ' Maria Santos ' }));
    assert.equal(result.updatedAt, T0);
    assert.deepEqual(calls, []);
  });

  it('rejects the Student ID of another student and leaves the record unchanged', async () => {
    await assert.rejects(
      build().updateStudent('s1', input({ studentNumber: 'shs-002' })),
      DuplicateStudentIdError
    );
    assert.equal(studentRows()[0].student_number, 'SHS-001');
  });

  it('rejects invalid values, a missing class, and a missing student with typed errors', async () => {
    const students = build();
    await assert.rejects(students.updateStudent('s1', input({ fullName: ' ' })), InvalidStudentError);
    await assert.rejects(students.updateStudent('s1', input({ classId: 'missing' })), ClassNotFoundError);
    await assert.rejects(students.updateStudent('missing', input({})), (error) => {
      assert.ok(error instanceof RecordNotFoundError);
      assert.ok(!(error instanceof ClassNotFoundError));
      assert.equal(error.id, 'missing');
      return true;
    });
    assert.deepEqual(studentRows().map((row) => row.full_name), ['Maria Santos', 'Paolo Garcia']);
  });

  it('rolls back an update whose write failed and reports a typed database error', async () => {
    const students = build({ db: failingAfterWrite(t.db, /^UPDATE/) });
    await assert.rejects(students.updateStudent('s1', input({ fullName: 'Changed' })), (error) => {
      assert.ok(error instanceof DatabaseError);
      assert.ok(!error.message.includes('disk I/O'));
      return true;
    });
    assert.equal(studentRows()[0].full_name, 'Maria Santos');
  });
});

describe('students: permanent deletion', () => {
  beforeEach(async () => {
    await openMigrated();
    insertStudent('s1', 'cls-a', 'SHS-001', 'Maria Santos');
    insertStudent('s2', 'cls-a', 'SHS-002', 'Paolo Garcia');
  });

  it('physically deletes a student without results and leaves the others', async () => {
    await build().deleteStudent('s1');
    assert.deepEqual(studentRows().map((row) => row.id), ['s2']);
    assert.equal(t.get('SELECT COUNT(*) AS n FROM classes').n, 2);
  });

  it('has no column that could mark a student as deleted instead of removing it', () => {
    const columns = t.all("SELECT name FROM pragma_table_info('students')").map((c) => c.name);
    assert.deepEqual(columns, ['id', 'class_id', 'student_number', 'full_name', 'created_at', 'updated_at']);
  });

  it('lets a deleted Student ID be used again', async () => {
    await build().deleteStudent('s1');
    await build().addStudent({ studentNumber: 'shs-001', fullName: 'New', classId: 'cls-b' });
    assert.equal(studentCount(), 2);
  });

  it('refuses to delete a student who has saved results, and reports how many', async () => {
    insertResultFor('s1', 'cls-a', 'res-1');
    insertResultFor('s1', 'cls-a', 'res-2');
    insertResultFor('s2', 'cls-a', 'res-3');

    await assert.rejects(build().deleteStudent('s1'), (error) => {
      assert.ok(error instanceof StudentInUseError);
      assert.equal(error.code, 'IN_USE');
      assert.equal(error.resultCount, 2);
      return true;
    });

    // Nothing was deleted: not the student, and not any result.
    assert.equal(studentCount(), 2);
    assert.equal(t.get('SELECT COUNT(*) AS n FROM results').n, 3);
  });

  it('deletes the student once the results are gone', async () => {
    insertResultFor('s1', 'cls-a', 'res-1');
    await assert.rejects(build().deleteStudent('s1'), StudentInUseError);
    t.run('DELETE FROM results WHERE id = ?', 'res-1');
    await build().deleteStudent('s1');
    assert.equal(studentCount(), 1);
  });

  it('reports a missing student with a typed error', async () => {
    await assert.rejects(build().deleteStudent('missing'), RecordNotFoundError);
  });

  it('rolls back a delete whose write failed', async () => {
    await assert.rejects(
      build({ db: failingAfterWrite(t.db, /^DELETE/) }).deleteStudent('s1'),
      DatabaseError
    );
    assert.equal(studentCount(), 2);
  });
});

describe('CSV reader', () => {
  beforeEach(() => {
    t = openTestDatabase();
  });

  const fields = (text) => {
    const result = parseCsv(text);
    assert.equal(result.ok, true);
    return result.records.map((record) => record.fields);
  };

  it('reads plain rows with LF, CRLF, and CR line endings and no final line break', () => {
    assert.deepEqual(fields('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(fields('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(fields('a,b\r1,2'), [['a', 'b'], ['1', '2']]);
  });

  it('removes a UTF-8 byte-order mark', () => {
    assert.deepEqual(fields('﻿student_id,full_name\n1,A'), [['student_id', 'full_name'], ['1', 'A']]);
  });

  it('reads commas, line breaks, and doubled quotes inside quoted values', () => {
    assert.deepEqual(fields('1,"Santos, Maria"\n2,"Juan ""Jun"" Cruz"\n3,"Two\nLines"\n4,""'), [
      ['1', 'Santos, Maria'],
      ['2', 'Juan "Jun" Cruz'],
      ['3', 'Two\nLines'],
      ['4', ''],
    ]);
  });

  it('keeps empty values and reports the line each record starts on', () => {
    const result = parseCsv('a,b\n\n1,\n"x\ny",2\n,3');
    assert.deepEqual(
      result.records.map((record) => [record.line, record.fields]),
      [
        [1, ['a', 'b']],
        [2, ['']],
        [3, ['1', '']],
        [4, ['x\ny', '2']],
        [6, ['', '3']],
      ]
    );
  });

  it('rejects an unclosed quote and text after a closing quote, with the line', () => {
    assert.deepEqual(parseCsv('a,b\n1,"open\n2,x'), { ok: false, line: 2, reason: 'UNCLOSED_QUOTE' });
    assert.deepEqual(parseCsv('a,b\n1,2\n3,"x"y'), { ok: false, line: 3, reason: 'TEXT_AFTER_QUOTE' });
  });
});

describe('roster reader', () => {
  beforeEach(() => {
    t = openTestDatabase();
  });

  const roster = (text) => {
    const result = readRoster(text);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.roster;
  };
  const problem = (text) => {
    const result = readRoster(text);
    assert.equal(result.ok, false);
    return result.problem;
  };

  it('reads the two-column format', () => {
    const read = roster('student_id,full_name\n2026-001,Maria Santos\n2026-002,Paolo Garcia\n');
    assert.equal(read.format, 'SINGLE_CLASS');
    assert.equal(read.totalRows, 2);
    assert.deepEqual(read.rows, [
      { rowNumber: 2, studentNumber: '2026-001', fullName: 'Maria Santos', groupKey: null },
      { rowNumber: 3, studentNumber: '2026-002', fullName: 'Paolo Garcia', groupKey: null },
    ]);
    assert.deepEqual([read.invalid, read.duplicates, read.groups], [[], [], []]);
  });

  it('reads the four-column format and groups rows by grade_and_section and course', () => {
    const read = roster(
      [
        'student_id,full_name,grade_and_section,course',
        'SHS-001,Maria Santos,Grade 11 A,STEM',
        'COL-001,Paolo Garcia,1A,BSIT',
        'SHS-002,Ana Reyes,  grade 11   a ,stem',
      ].join('\n')
    );
    assert.equal(read.format, 'MULTI_CLASS');
    assert.deepEqual(read.groups, [
      { key: 'grade 11 a|stem', gradeAndSection: 'Grade 11 A', course: 'STEM', rowCount: 2 },
      { key: '1a|bsit', gradeAndSection: '1A', course: 'BSIT', rowCount: 1 },
    ]);
    assert.deepEqual(read.rows.map((row) => row.groupKey), ['grade 11 a|stem', '1a|bsit', 'grade 11 a|stem']);
  });

  it('accepts a BOM, header names in any case with spaces, columns in any order, and extra columns', () => {
    const read = roster('﻿ Full_Name , STUDENT_ID ,email\nMaria Santos,2026-001,m@example.test\n');
    assert.deepEqual(read.rows, [
      { rowNumber: 2, studentNumber: '2026-001', fullName: 'Maria Santos', groupKey: null },
    ]);
  });

  it('ignores completely blank rows and keeps the original row numbers', () => {
    const read = roster('student_id,full_name\n\n1,A\n,\n   ,  \n2,B\n\n');
    assert.equal(read.totalRows, 2);
    assert.deepEqual(read.rows.map((row) => [row.rowNumber, row.studentNumber]), [[3, '1'], [6, '2']]);
  });

  it('reads quoted names with commas and escaped quotes', () => {
    const read = roster('student_id,full_name\n1,"Santos, Maria"\n2,"Juan ""Jun"" Cruz"');
    assert.deepEqual(read.rows.map((row) => row.fullName), ['Santos, Maria', 'Juan "Jun" Cruz']);
  });

  it('rejects an empty file and a file with only blank lines', () => {
    assert.deepEqual(problem(''), { kind: 'EMPTY' });
    assert.deepEqual(problem('\n\n , \n'), { kind: 'EMPTY' });
  });

  it('rejects missing required headers and names them', () => {
    assert.deepEqual(problem('id,name\n1,A'), { kind: 'MISSING_HEADERS', missing: ['student_id', 'full_name'] });
    assert.deepEqual(problem('student_id\n1'), { kind: 'MISSING_HEADERS', missing: ['full_name'] });
    assert.deepEqual(problem('student_id,full_name,course\n1,A,STEM'), {
      kind: 'MISSING_HEADERS',
      missing: ['grade_and_section'],
    });
    assert.deepEqual(problem('student_id,full_name,grade_and_section\n1,A,11 A'), {
      kind: 'MISSING_HEADERS',
      missing: ['course'],
    });
  });

  it('rejects a repeated header and malformed CSV with the line', () => {
    assert.deepEqual(problem('student_id,full_name,Student_ID\n1,A,2'), {
      kind: 'DUPLICATE_HEADER',
      header: 'student_id',
    });
    assert.deepEqual(problem('student_id,full_name\n1,"Maria\n2,Paolo'), { kind: 'MALFORMED', line: 2 });
  });

  it('separates invalid rows, with every problem and the row number, from valid ones', () => {
    const read = roster(
      [
        'student_id,full_name,grade_and_section,course',
        'A1,Maria Santos,1A,BSIT',
        ',No Id,1A,BSIT',
        'A3,,1A,BSIT',
        `${'x'.repeat(STUDENT_ID_MAX_LENGTH + 1)},${'y'.repeat(STUDENT_NAME_MAX_LENGTH + 1)},1A,BSIT`,
        'A5,No Class,,',
        'A6,Santos, Maria,1A,BSIT',
        'A7,Short row',
        ',,1A,BSIT',
      ].join('\n')
    );
    assert.equal(read.totalRows, 8);
    assert.deepEqual(read.rows.map((row) => row.rowNumber), [2]);
    assert.deepEqual(
      read.invalid.map((row) => [row.rowNumber, row.problems]),
      [
        [3, ['MISSING_STUDENT_ID']],
        [4, ['MISSING_FULL_NAME']],
        [5, ['STUDENT_ID_TOO_LONG', 'FULL_NAME_TOO_LONG']],
        [6, ['MISSING_CLASS']],
        [7, ['TOO_MANY_VALUES']],
        [8, ['MISSING_CLASS']],
        [9, ['MISSING_STUDENT_ID', 'MISSING_FULL_NAME']],
      ]
    );
    assert.deepEqual(read.groups.map((group) => group.rowCount), [1]);
  });

  it('keeps the first row of a repeated Student ID and reports the later ones as duplicates', () => {
    const read = roster('student_id,full_name\nA1,Maria\nB2,Paolo\na1,Other\n A1 ,Third\n');
    assert.deepEqual(read.rows.map((row) => row.rowNumber), [2, 3]);
    assert.deepEqual(read.duplicates, [
      { rowNumber: 4, studentNumber: 'a1', fullName: 'Other', firstRowNumber: 2 },
      { rowNumber: 5, studentNumber: 'A1', fullName: 'Third', firstRowNumber: 2 },
    ]);
    assert.deepEqual(read.invalid, []);
  });

  it('suggests a class only for an exact, unambiguous match', () => {
    const classes = [
      { id: 'c1', name: 'BSIT 1A' },
      { id: 'c2', name: 'Grade 11 STEM-A' },
      { id: 'c3', name: 'STEM Grade 11 A' },
      { id: 'c4', name: 'BSCS-2B' },
      { id: 'c5', name: 'bscs 2b' },
    ];
    const suggest = (gradeAndSection, course) => suggestClassForGroup({ gradeAndSection, course }, classes);

    assert.deepEqual(suggest('1A', 'BSIT'), { kind: 'MATCH', classId: 'c1' });
    assert.deepEqual(suggest('1a', 'bsit'), { kind: 'MATCH', classId: 'c1' });
    assert.deepEqual(suggest('Grade 11 A', 'STEM'), { kind: 'MATCH', classId: 'c3' });
    assert.deepEqual(suggest('BSIT 1A', ''), { kind: 'MATCH', classId: 'c1' });
    // "Grade 11 STEM-A" is neither "Grade 11 A STEM" nor "STEM Grade 11 A": left to the Teacher.
    assert.deepEqual(suggestClassForGroup({ gradeAndSection: 'Grade 11 A', course: 'STEM' }, classes.slice(0, 2)), {
      kind: 'NONE',
    });
    assert.deepEqual(suggest('1B', 'BSIT'), { kind: 'NONE' });
    assert.deepEqual(suggest('2B', 'BSCS'), { kind: 'AMBIGUOUS', classIds: ['c4', 'c5'] });
  });
});

describe('roster import', () => {
  beforeEach(async () => {
    await openMigrated();
    insertStudent('s1', 'cls-a', 'OLD-1', 'Already Here');
  });

  const TWO_COLUMNS = [
    'student_id,full_name',
    '2026-001,Maria Santos',
    'old-1,Duplicate Of Stored',
    '2026-002,"Garcia, Paolo"',
    ',Missing Id',
    '2026-001,Repeated In File',
  ].join('\n');

  it('prepares a draft that separates valid, invalid, duplicate, and already stored rows', async () => {
    const draft = await build().prepareRoster('roster.csv', TWO_COLUMNS);

    assert.equal(draft.fileName, 'roster.csv');
    assert.equal(draft.format, 'SINGLE_CLASS');
    assert.equal(draft.totalRows, 5);
    assert.deepEqual(draft.rows.map((row) => row.rowNumber), [2, 4]);
    assert.deepEqual(draft.invalid.map((row) => row.rowNumber), [5]);
    assert.deepEqual(draft.duplicates.map((row) => row.rowNumber), [6]);
    assert.deepEqual(draft.existing, [{ rowNumber: 3, studentNumber: 'old-1', fullName: 'Duplicate Of Stored' }]);
    assert.deepEqual(draft.classes, [
      { id: 'cls-a', name: 'BSIT 1A' },
      { id: 'cls-b', name: 'Grade 11 STEM-A' },
    ]);
    // Preparing stores nothing.
    assert.equal(studentCount(), 1);
  });

  it('imports nothing until a destination class is chosen, then every valid row into it', async () => {
    const students = build();
    const draft = await students.prepareRoster('roster.csv', TWO_COLUMNS);
    const selection = initialRosterSelection(draft);

    assert.deepEqual(resolveRoster(draft, selection), {
      importable: [],
      unresolvedRowCount: 2,
      unresolvedGroupCount: 0,
    });

    const resolved = resolveRoster(draft, { ...selection, destinationClassId: 'cls-b' });
    assert.deepEqual(resolved.importable, [
      { studentNumber: '2026-001', fullName: 'Maria Santos', classId: 'cls-b' },
      { studentNumber: '2026-002', fullName: 'Garcia, Paolo', classId: 'cls-b' },
    ]);
    assert.equal(resolved.unresolvedRowCount, 0);

    assert.equal(await students.importStudents(resolved.importable), 2);
    assert.deepEqual(
      (await students.listStudents({ classId: 'cls-b' })).map((s) => `${s.studentNumber} ${s.fullName}`),
      ['2026-002 Garcia, Paolo', '2026-001 Maria Santos']
    );
    // The stored student was not overwritten.
    assert.equal(t.get('SELECT full_name FROM students WHERE id = ?', 's1').full_name, 'Already Here');
  });

  it('ignores a destination that is not an existing class', async () => {
    const draft = await build().prepareRoster('roster.csv', TWO_COLUMNS);
    const resolved = resolveRoster(draft, { destinationClassId: 'missing', groupClassIds: {} });
    assert.deepEqual(resolved.importable, []);
    assert.equal(resolved.unresolvedRowCount, 2);
  });

  const FOUR_COLUMNS = [
    'student_id,full_name,grade_and_section,course',
    'COL-001,Paolo Garcia,1A,BSIT',
    'COL-002,Ana Reyes,1a,bsit',
    'SHS-001,Maria Santos,Grade 11 A,STEM',
    'SHS-002,Bea Lim,Grade 12 B,ABM',
    'OLD-1,Stored Already,Grade 12 C,HUMSS',
  ].join('\n');

  it('selects a class automatically only for an exact match and requires a mapping for the rest', async () => {
    const students = build();
    const draft = await students.prepareRoster('all.csv', FOUR_COLUMNS);

    assert.equal(draft.format, 'MULTI_CLASS');
    // The group whose only row is already stored needs no mapping and is dropped.
    assert.deepEqual(
      draft.groups.map((group) => [group.gradeAndSection, group.course, group.rowCount, group.suggestedClassId, group.isAmbiguous]),
      [
        ['1A', 'BSIT', 2, 'cls-a', false],
        ['Grade 11 A', 'STEM', 1, null, false],
        ['Grade 12 B', 'ABM', 1, null, false],
      ]
    );

    const selection = initialRosterSelection(draft);
    const first = resolveRoster(draft, selection);
    assert.deepEqual(first.importable.map((row) => `${row.studentNumber}>${row.classId}`), [
      'COL-001>cls-a',
      'COL-002>cls-a',
    ]);
    assert.equal(first.unresolvedRowCount, 2);
    assert.equal(first.unresolvedGroupCount, 2);

    const mapped = resolveRoster(draft, {
      ...selection,
      groupClassIds: { ...selection.groupClassIds, 'grade 11 a|stem': 'cls-b' },
    });
    assert.deepEqual(mapped.importable.map((row) => `${row.studentNumber}>${row.classId}`), [
      'COL-001>cls-a',
      'COL-002>cls-a',
      'SHS-001>cls-b',
    ]);
    assert.equal(mapped.unresolvedRowCount, 1);
    assert.equal(mapped.unresolvedGroupCount, 1);

    assert.equal(await students.importStudents(mapped.importable), 3);
    // Only class_id is stored: no grade_and_section or course column exists.
    assert.deepEqual(
      t.all('SELECT student_number, class_id FROM students ORDER BY student_number').map((row) => ({ ...row })),
      [
        { student_number: 'COL-001', class_id: 'cls-a' },
        { student_number: 'COL-002', class_id: 'cls-a' },
        { student_number: 'OLD-1', class_id: 'cls-a' },
        { student_number: 'SHS-001', class_id: 'cls-b' },
      ]
    );
    // No class was created.
    assert.equal(t.get('SELECT COUNT(*) AS n FROM classes').n, 2);
  });

  it('leaves an ambiguous group unselected', async () => {
    insertClass('cls-c', 'bsit-1a');
    const draft = await build().prepareRoster('all.csv', FOUR_COLUMNS);
    const group = draft.groups[0];
    assert.equal(group.suggestedClassId, null);
    assert.equal(group.isAmbiguous, true);
    assert.equal(resolveRoster(draft, initialRosterSelection(draft)).importable.length, 0);
  });

  it('reports an unusable file with a typed error and stores nothing', async () => {
    const students = build();
    for (const [text, kind] of [
      ['', 'EMPTY'],
      ['name\nMaria', 'MISSING_HEADERS'],
      ['student_id,full_name\n1,"open', 'MALFORMED'],
    ]) {
      await assert.rejects(students.prepareRoster('bad.csv', text), (error) => {
        assert.ok(error instanceof RosterFileError);
        assert.equal(error.code, 'ROSTER_FILE_ERROR');
        assert.equal(error.failure.kind, kind);
        return true;
      });
    }
    assert.equal(studentCount(), 1);
  });

  it('inserts a large batch with a few statements, not one per student', async () => {
    const statements = [];
    const spy = {
      ...t.db,
      runAsync: (sql, params) => {
        statements.push({ sql, params });
        return t.db.runAsync(sql, params);
      },
      getAllAsync: (sql, params) => {
        statements.push({ sql, params });
        return t.db.getAllAsync(sql, params);
      },
    };
    const inputs = Array.from({ length: 250 }, (_, index) => ({
      studentNumber: `N-${String(index).padStart(4, '0')}`,
      fullName: `Student ${index}`,
      classId: index % 2 ? 'cls-a' : 'cls-b',
    }));

    assert.equal(await build({ db: spy }).importStudents(inputs), 250);

    assert.equal(studentCount(), 251);
    assert.equal(statements.filter(({ sql }) => sql.startsWith('INSERT')).length, 3);
    assert.equal(statements.length, 5);
    for (const { sql } of statements) assert.doesNotMatch(sql, /N-0|Student \d|cls-a/);
    assert.equal(new Set(t.all('SELECT id FROM students').map((row) => row.id)).size, 251);
  });

  it('rolls back the whole batch when a later insert fails', async () => {
    const inputs = Array.from({ length: 250 }, (_, index) => ({
      studentNumber: `N-${index}`,
      fullName: `Student ${index}`,
      classId: 'cls-a',
    }));

    await assert.rejects(
      build({ db: failingAfterWrite(t.db, /^INSERT/, 3) }).importStudents(inputs),
      (error) => {
        assert.ok(error instanceof DatabaseError);
        assert.equal(error.code, 'DATABASE_ERROR');
        return true;
      }
    );
    assert.equal(studentCount(), 1);

    // The connection still works afterwards.
    assert.equal(await build().importStudents(inputs.slice(0, 2)), 2);
  });

  it('refuses the whole batch when one Student ID is stored already or repeated in the batch', async () => {
    const students = build();
    const good = { studentNumber: 'NEW-1', fullName: 'New One', classId: 'cls-a' };

    await assert.rejects(
      students.importStudents([good, { studentNumber: 'old-1', fullName: 'Clash', classId: 'cls-b' }]),
      (error) => {
        assert.ok(error instanceof DuplicateStudentIdError);
        assert.equal(error.studentNumber, 'old-1');
        return true;
      }
    );
    await assert.rejects(
      students.importStudents([good, { ...good, studentNumber: 'new-1' }]),
      DuplicateStudentIdError
    );
    assert.equal(studentCount(), 1);
  });

  it('refuses the whole batch when a class is missing or a row is invalid', async () => {
    const students = build();
    const good = { studentNumber: 'NEW-1', fullName: 'New One', classId: 'cls-a' };

    await assert.rejects(
      students.importStudents([good, { studentNumber: 'NEW-2', fullName: 'B', classId: 'gone' }]),
      ClassNotFoundError
    );
    await assert.rejects(
      students.importStudents([good, { studentNumber: 'NEW-3', fullName: '  ', classId: 'cls-a' }]),
      InvalidStudentError
    );
    assert.equal(studentCount(), 1);
    assert.equal(await students.importStudents([]), 0);
  });
});

describe('roster file lifecycle', () => {
  beforeEach(openMigrated);

  const CACHE = 'file:///data/user/0/app/cache/DocumentPicker/';
  const COPY = `${CACHE}3f1c.csv`;
  const ORIGINAL = 'content://com.android.providers.downloads.documents/document/42';
  const CSV = 'student_id,full_name\n2026-001,Maria Santos\n';

  /** An in-memory file system that records every operation. */
  function fakeFileSystem({ picked, files = {}, failRead = false, failDelete = false } = {}) {
    const log = { read: [], deleted: [], listed: [] };
    const store = new Map(Object.entries(files));
    return {
      log,
      store,
      fileSystem: {
        importCacheDirectory: () => CACHE.slice(0, -1),
        // Like the system picker, the copy appears in the cache only when a file is picked.
        pickDocument: async () => {
          if (!picked) return null;
          const { content, ...document } = picked;
          if (content !== undefined) store.set(document.uri, content);
          return document;
        },
        readText: async (uri) => {
          log.read.push(uri);
          if (failRead) throw new Error('EACCES');
          return store.get(uri);
        },
        deleteFile: async (uri) => {
          log.deleted.push(uri);
          if (failDelete) throw new Error('EBUSY');
          store.delete(uri);
        },
        listFiles: async (directory) => {
          log.listed.push(directory);
          return [...store.keys()].filter((uri) => uri.startsWith(CACHE));
        },
      },
    };
  }

  const pickedCopy = { uri: COPY, name: 'roster.csv', size: CSV.length, content: CSV };
  const studentsWith = (fake, db) =>
    build({ db, rosterFilePicker: createRosterFilePicker(fake.fileSystem) });

  it('deletes the temporary copy after the roster was read successfully', async () => {
    const fake = fakeFileSystem({ picked: pickedCopy });

    const draft = await studentsWith(fake).pickRoster();

    assert.equal(draft.fileName, 'roster.csv');
    assert.equal(draft.rows.length, 1);
    assert.deepEqual(fake.log.read, [COPY]);
    assert.deepEqual(fake.log.deleted, [COPY]);
    assert.equal(fake.store.size, 0);
    // Reading stores nothing, and the draft carries no path to the file.
    assert.equal(studentCount(), 0);
    assert.ok(!JSON.stringify(draft).includes('DocumentPicker'));
  });

  it('leaves nothing to clean up when the import is confirmed or cancelled later', async () => {
    const fake = fakeFileSystem({ picked: pickedCopy });
    const students = studentsWith(fake);
    const draft = await students.pickRoster();
    assert.equal(fake.store.size, 0);

    // Cancelling is simply dropping the draft: no file exists any more.
    const resolved = resolveRoster(draft, { destinationClassId: 'cls-a', groupClassIds: {} });
    await students.importStudents(resolved.importable);

    assert.equal(studentCount(), 1);
    assert.deepEqual(fake.log.deleted, [COPY]);
    // Only normalized student columns reached SQLite.
    assert.deepEqual(Object.keys(studentRows()[0]), [
      'id',
      'class_id',
      'student_number',
      'full_name',
      'created_at',
      'updated_at',
    ]);
    assert.ok(!JSON.stringify(studentRows()).includes('roster.csv'));
  });

  it('does nothing when the Teacher closes the picker without choosing', async () => {
    const fake = fakeFileSystem({ picked: null });
    assert.equal(await studentsWith(fake).pickRoster(), null);
    assert.deepEqual(fake.log.read, []);
    assert.deepEqual(fake.log.deleted, []);
  });

  it('deletes the temporary copy when the file cannot be parsed', async () => {
    const fake = fakeFileSystem({ picked: { ...pickedCopy, content: 'student_id,full_name\n1,"open' } });
    await assert.rejects(studentsWith(fake).pickRoster(), RosterFileError);
    assert.deepEqual(fake.log.deleted, [COPY]);
    assert.equal(fake.store.size, 0);
  });

  it('deletes the temporary copy when the headers are wrong', async () => {
    const fake = fakeFileSystem({ picked: { ...pickedCopy, content: 'name,section\nMaria,A' } });
    await assert.rejects(studentsWith(fake).pickRoster(), (error) => {
      assert.equal(error.failure.kind, 'MISSING_HEADERS');
      return true;
    });
    assert.deepEqual(fake.log.deleted, [COPY]);
  });

  it('deletes the temporary copy when the file cannot be read', async () => {
    const fake = fakeFileSystem({ picked: pickedCopy, failRead: true });
    await assert.rejects(studentsWith(fake).pickRoster(), (error) => {
      assert.ok(error instanceof RosterFileError);
      assert.equal(error.failure.kind, 'UNREADABLE');
      return true;
    });
    assert.deepEqual(fake.log.deleted, [COPY]);
  });

  it('deletes the temporary copy without reading it when the file is too large', async () => {
    const fake = fakeFileSystem({ picked: { ...pickedCopy, size: ROSTER_FILE_MAX_BYTES + 1 } });
    await assert.rejects(studentsWith(fake).pickRoster(), (error) => {
      assert.equal(error.failure.kind, 'TOO_LARGE');
      return true;
    });
    assert.deepEqual(fake.log.read, []);
    assert.deepEqual(fake.log.deleted, [COPY]);
  });

  it('deletes the temporary copy when the database fails while checking the roster', async () => {
    const fake = fakeFileSystem({ picked: pickedCopy });
    const broken = {
      ...t.db,
      getAllAsync: async () => {
        throw new Error('database disk image is malformed');
      },
    };
    await assert.rejects(studentsWith(fake, broken).pickRoster(), DatabaseError);
    assert.deepEqual(fake.log.deleted, [COPY]);
    assert.equal(fake.store.size, 0);
  });

  it('never passes the original file to a delete operation', async () => {
    // The picker returned the provider's own URI instead of a cache copy.
    const fake = fakeFileSystem({
      picked: { uri: ORIGINAL, name: 'roster.csv', size: CSV.length },
      files: { [ORIGINAL]: CSV },
    });

    const draft = await studentsWith(fake).pickRoster();

    assert.equal(draft.rows.length, 1);
    assert.deepEqual(fake.log.read, [ORIGINAL]);
    assert.deepEqual(fake.log.deleted, []);
    assert.equal(fake.store.get(ORIGINAL), CSV);
  });

  it('does not delete a file that merely has the cache folder name as a prefix', async () => {
    const lookalike = 'file:///data/user/0/app/cache/DocumentPickerBackup/roster.csv';
    const fake = fakeFileSystem({
      picked: { uri: lookalike, name: 'roster.csv', size: CSV.length },
      files: { [lookalike]: CSV },
    });
    await studentsWith(fake).pickRoster();
    assert.deepEqual(fake.log.deleted, []);
  });

  it('removes stale copies of an interrupted session before picking, and only from the cache folder', async () => {
    const stale = `${CACHE}old-session.csv`;
    const fake = fakeFileSystem({
      picked: pickedCopy,
      files: { [stale]: 'left behind', [ORIGINAL]: CSV },
    });

    const draft = await studentsWith(fake).pickRoster();

    assert.equal(draft.rows.length, 1);
    assert.deepEqual(fake.log.listed, [CACHE.slice(0, -1)]);
    // First the leftover, then the copy of this session; never the original.
    assert.deepEqual(fake.log.deleted, [stale, COPY]);
    assert.deepEqual([...fake.store.keys()], [ORIGINAL]);
  });

  it('still returns the roster when deleting the copy fails, and releases only once', async () => {
    const fake = fakeFileSystem({ picked: pickedCopy, failDelete: true });
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      const picker = createRosterFilePicker(fake.fileSystem);
      const file = await picker.pick();
      await file.release();
      await file.release();
      assert.deepEqual(fake.log.deleted, [COPY]);

      const draft = await studentsWith(fake).pickRoster();
      assert.equal(draft.rows.length, 1);
    } finally {
      console.warn = originalWarn;
    }
  });
});
