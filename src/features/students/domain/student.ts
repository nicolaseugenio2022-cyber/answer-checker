import { nameKey, nameLength } from '../../../core/domain/record-name';

/**
 * A student. Belongs to exactly one class, which carries the grade or year,
 * course or strand, and section; a student has no such fields of its own and
 * no subject. Subjects reach a student through the class.
 */
export type Student = {
  /** Internal id (UUID). Never shown to the Teacher. */
  id: string;
  /** The "Student ID" the Teacher sees. Unique in the app, ignoring letter case. */
  studentNumber: string;
  fullName: string;
  classId: string;
  /** UTC ISO-8601 instants, as Date.prototype.toISOString() produces. */
  createdAt: string;
  updatedAt: string;
};

/** What the Teacher enters, by hand or through a roster file. */
export type StudentInput = {
  studentNumber: string;
  fullName: string;
  classId: string;
};

/** Long enough for ids such as "2026-SHS-STEM-000125". */
export const STUDENT_ID_MAX_LENGTH = 32;

/** Long enough for full names with several given names and a suffix. */
export const STUDENT_NAME_MAX_LENGTH = 100;

export type StudentProblem =
  | { field: 'studentNumber'; problem: 'EMPTY' }
  | { field: 'studentNumber'; problem: 'TOO_LONG'; maxLength: number }
  | { field: 'fullName'; problem: 'EMPTY' }
  | { field: 'fullName'; problem: 'TOO_LONG'; maxLength: number }
  | { field: 'classId'; problem: 'EMPTY' };

/** The form in which a student is stored: surrounding whitespace removed. */
export function normalizeStudentInput(input: StudentInput): StudentInput {
  return {
    studentNumber: input.studentNumber.trim(),
    fullName: input.fullName.trim(),
    classId: input.classId.trim(),
  };
}

/** Everything wrong with already normalized input. Lengths count characters, not UTF-16 units. */
export function findStudentProblems(input: StudentInput): StudentProblem[] {
  const problems: StudentProblem[] = [];

  if (input.studentNumber.length === 0) {
    problems.push({ field: 'studentNumber', problem: 'EMPTY' });
  } else if (nameLength(input.studentNumber) > STUDENT_ID_MAX_LENGTH) {
    problems.push({ field: 'studentNumber', problem: 'TOO_LONG', maxLength: STUDENT_ID_MAX_LENGTH });
  }

  if (input.fullName.length === 0) {
    problems.push({ field: 'fullName', problem: 'EMPTY' });
  } else if (nameLength(input.fullName) > STUDENT_NAME_MAX_LENGTH) {
    problems.push({ field: 'fullName', problem: 'TOO_LONG', maxLength: STUDENT_NAME_MAX_LENGTH });
  }

  if (input.classId.length === 0) problems.push({ field: 'classId', problem: 'EMPTY' });

  return problems;
}

/** Two Student IDs with the same key are the same Student ID. */
export function studentNumberKey(studentNumber: string): string {
  return nameKey(studentNumber.trim());
}

/** Whether a search matches the Student ID or the full name, ignoring letter case. */
export function matchesStudentSearch(
  student: Pick<Student, 'studentNumber' | 'fullName'>,
  search: string
): boolean {
  const wanted = nameKey(search.trim());
  if (wanted.length === 0) return true;
  return nameKey(student.studentNumber).includes(wanted) || nameKey(student.fullName).includes(wanted);
}
