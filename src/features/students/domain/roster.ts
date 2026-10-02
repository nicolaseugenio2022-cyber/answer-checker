import { parseCsv } from '../../../core/domain/csv';
import { nameKey, nameLength } from '../../../core/domain/record-name';
import { STUDENT_ID_MAX_LENGTH, STUDENT_NAME_MAX_LENGTH, studentNumberKey } from './student';

/**
 * Reading a student roster from CSV text. Pure: no files, no database.
 *
 * Two layouts are accepted, told apart by the header:
 *   SINGLE_CLASS  student_id,full_name
 *                 Every row goes to one class the Teacher picks.
 *   MULTI_CLASS   student_id,full_name,grade_and_section,course
 *                 Rows are grouped by grade_and_section + course, and each
 *                 group is mapped to an existing class.
 * Header names are trimmed and compared ignoring letter case. Other columns
 * are ignored.
 */

export type RosterFormat = 'SINGLE_CLASS' | 'MULTI_CLASS';

export type RosterRowProblem =
  | 'MISSING_STUDENT_ID'
  | 'STUDENT_ID_TOO_LONG'
  | 'MISSING_FULL_NAME'
  | 'FULL_NAME_TOO_LONG'
  | 'MISSING_CLASS'
  | 'TOO_MANY_VALUES';

/** A row that can be imported once its class is known. */
export type RosterRow = {
  /** Line of the CSV file, counting the header as 1. */
  rowNumber: number;
  studentNumber: string;
  fullName: string;
  /** Key of the row's group in a MULTI_CLASS roster; null in a SINGLE_CLASS one. */
  groupKey: string | null;
};

/** A row that will not be imported, with what the file said. */
export type RosterRejectedRow = {
  rowNumber: number;
  studentNumber: string;
  fullName: string;
};

export type RosterInvalidRow = RosterRejectedRow & { problems: RosterRowProblem[] };

export type RosterDuplicateRow = RosterRejectedRow & {
  /** The earlier row of the file that has the same Student ID. */
  firstRowNumber: number;
};

/** One distinct grade_and_section + course combination of a MULTI_CLASS roster. */
export type RosterGroup = {
  key: string;
  gradeAndSection: string;
  course: string;
  /** Importable rows in the group. */
  rowCount: number;
};

export type Roster = {
  format: RosterFormat;
  /** Data rows in the file: everything except the header and blank lines. */
  totalRows: number;
  rows: RosterRow[];
  invalid: RosterInvalidRow[];
  /** Rows whose Student ID already appeared on an earlier row. The earlier row is kept. */
  duplicates: RosterDuplicateRow[];
  groups: RosterGroup[];
};

export type RosterFileProblem =
  | { kind: 'EMPTY' }
  | { kind: 'MALFORMED'; line: number }
  | { kind: 'MISSING_HEADERS'; missing: string[] }
  | { kind: 'DUPLICATE_HEADER'; header: string };

export type RosterResult = { ok: true; roster: Roster } | { ok: false; problem: RosterFileProblem };

const STUDENT_ID = 'student_id';
const FULL_NAME = 'full_name';
const GRADE_AND_SECTION = 'grade_and_section';
const COURSE = 'course';

const collapse = (text: string) => text.trim().replace(/\s+/g, ' ');
const isBlank = (fields: string[]) => fields.every((field) => field.trim().length === 0);

export function readRoster(text: string): RosterResult {
  const parsed = parseCsv(text);
  if (!parsed.ok) return { ok: false, problem: { kind: 'MALFORMED', line: parsed.line } };

  const records = parsed.records.filter((record) => !isBlank(record.fields));
  if (records.length === 0) return { ok: false, problem: { kind: 'EMPTY' } };

  const headers = records[0].fields.map((header) => header.trim().toLowerCase());
  const repeated = headers.find(
    (header, index) => header.length > 0 && headers.indexOf(header) !== index
  );
  if (repeated !== undefined) {
    return { ok: false, problem: { kind: 'DUPLICATE_HEADER', header: repeated } };
  }

  const column = (name: string) => headers.indexOf(name);
  const hasClassColumns = column(GRADE_AND_SECTION) >= 0 || column(COURSE) >= 0;
  const required = hasClassColumns
    ? [STUDENT_ID, FULL_NAME, GRADE_AND_SECTION, COURSE]
    : [STUDENT_ID, FULL_NAME];
  const missing = required.filter((name) => column(name) < 0);
  if (missing.length > 0) return { ok: false, problem: { kind: 'MISSING_HEADERS', missing } };

  const format: RosterFormat = hasClassColumns ? 'MULTI_CLASS' : 'SINGLE_CLASS';
  const dataRecords = records.slice(1);

  const rows: RosterRow[] = [];
  const invalid: RosterInvalidRow[] = [];
  const duplicates: RosterDuplicateRow[] = [];
  const groups = new Map<string, RosterGroup>();
  const firstRowByKey = new Map<string, number>();

  for (const record of dataRecords) {
    const value = (name: string) => (record.fields[column(name)] ?? '').trim();
    const studentNumber = value(STUDENT_ID);
    const fullName = value(FULL_NAME);
    const gradeAndSection = collapse(value(GRADE_AND_SECTION));
    const course = collapse(value(COURSE));
    const rejected = { rowNumber: record.line, studentNumber, fullName };

    const problems: RosterRowProblem[] = [];
    // More values than headers usually means a comma inside an unquoted name.
    if (record.fields.length > headers.length) problems.push('TOO_MANY_VALUES');
    if (studentNumber.length === 0) problems.push('MISSING_STUDENT_ID');
    else if (nameLength(studentNumber) > STUDENT_ID_MAX_LENGTH) problems.push('STUDENT_ID_TOO_LONG');
    if (fullName.length === 0) problems.push('MISSING_FULL_NAME');
    else if (nameLength(fullName) > STUDENT_NAME_MAX_LENGTH) problems.push('FULL_NAME_TOO_LONG');
    if (format === 'MULTI_CLASS' && gradeAndSection.length === 0 && course.length === 0) {
      problems.push('MISSING_CLASS');
    }
    if (problems.length > 0) {
      invalid.push({ ...rejected, problems });
      continue;
    }

    const key = studentNumberKey(studentNumber);
    const firstRowNumber = firstRowByKey.get(key);
    if (firstRowNumber !== undefined) {
      duplicates.push({ ...rejected, firstRowNumber });
      continue;
    }
    firstRowByKey.set(key, record.line);

    let groupKey: string | null = null;
    if (format === 'MULTI_CLASS') {
      groupKey = `${nameKey(gradeAndSection)}|${nameKey(course)}`;
      const group = groups.get(groupKey);
      if (group) group.rowCount++;
      else groups.set(groupKey, { key: groupKey, gradeAndSection, course, rowCount: 1 });
    }
    rows.push({ rowNumber: record.line, studentNumber, fullName, groupKey });
  }

  return {
    ok: true,
    roster: {
      format,
      totalRows: dataRecords.length,
      rows,
      invalid,
      duplicates,
      groups: [...groups.values()],
    },
  };
}

/** Letters and digits only, lower case: "Grade 11 STEM-A" and "grade11 stem a" compare equal. */
function compact(text: string): string {
  return nameKey(text).replace(/[^\p{L}\p{N}]/gu, '');
}

export type ClassSuggestion =
  /** Exactly one class matches: it can be selected for the Teacher. */
  | { kind: 'MATCH'; classId: string }
  /** No class matches: the Teacher must choose. */
  | { kind: 'NONE' }
  /** More than one class matches: the Teacher must choose. */
  | { kind: 'AMBIGUOUS'; classIds: string[] };

/**
 * Finds the existing class a roster group means. A class matches only when its
 * name, reduced to letters and digits, equals the group's two values joined in
 * either order ("1A" + "BSIT" matches "BSIT 1A"). Anything looser is left to
 * the Teacher, because a wrong guess would put students in the wrong class.
 */
export function suggestClassForGroup(
  group: Pick<RosterGroup, 'gradeAndSection' | 'course'>,
  classes: readonly { id: string; name: string }[]
): ClassSuggestion {
  const wanted = new Set([
    compact(group.gradeAndSection + group.course),
    compact(group.course + group.gradeAndSection),
  ]);
  wanted.delete('');
  const matches = classes.filter((schoolClass) => wanted.has(compact(schoolClass.name)));
  if (matches.length === 1) return { kind: 'MATCH', classId: matches[0].id };
  if (matches.length === 0) return { kind: 'NONE' };
  return { kind: 'AMBIGUOUS', classIds: matches.map((match) => match.id) };
}
