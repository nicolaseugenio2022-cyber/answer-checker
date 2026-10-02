import { RecordNotFoundError } from '@/core/application/errors';
import { countOf, type ErrorDescription } from '@/core/presentation/lib/describe-name-error';
import { ClassNotFoundError } from '@/features/classes/application/class-repository';
import { RosterFileError, type RosterFileFailure } from '@/features/students/application/roster-import';
import {
  DuplicateStudentIdError,
  InvalidStudentError,
  StudentInUseError,
} from '@/features/students/application/student-repository';
import type { RosterRowProblem } from '@/features/students/domain/roster';
import {
  STUDENT_ID_MAX_LENGTH,
  STUDENT_NAME_MAX_LENGTH,
  type StudentProblem,
} from '@/features/students/domain/student';

export type StudentField = StudentProblem['field'];

/** Words for one validation problem, shown under its field. */
export function describeStudentProblem(problem: StudentProblem): string {
  if (problem.field === 'classId') return 'Choose a class.';
  const label = problem.field === 'studentNumber' ? 'Student ID' : 'full name';
  return problem.problem === 'EMPTY'
    ? `Enter the ${label}.`
    : `Use ${problem.maxLength} characters or fewer for the ${label}.`;
}

/** Which field a failed save belongs to, so the message can sit next to it. */
export function fieldOfStudentError(error: unknown): StudentField | null {
  if (error instanceof DuplicateStudentIdError) return 'studentNumber';
  if (error instanceof ClassNotFoundError) return 'classId';
  if (error instanceof InvalidStudentError) return error.problems[0]?.field ?? null;
  return null;
}

function describeRosterFile(failure: RosterFileFailure): string {
  switch (failure.kind) {
    case 'EMPTY':
      return 'That file has no rows. Choose a CSV file with a header row and one student per row.';
    case 'MALFORMED':
      return `That file could not be read as CSV. Check the quotation marks on row ${failure.line}.`;
    case 'MISSING_HEADERS':
      return `That file has no ${failure.missing.join(' or ')} column. The first row must name the columns: student_id, full_name.`;
    case 'DUPLICATE_HEADER':
      return `That file has the column ${failure.header} more than once.`;
    case 'TOO_LARGE':
      return 'That file is too large to be a class roster. Choose a CSV file smaller than 1 MB.';
    case 'UNREADABLE':
      return 'That file could not be opened. Choose it again, or pick another file.';
  }
}

/** What to tell the Teacher about a failed student action. Never a raw database message. */
export function describeStudentError(error: unknown): ErrorDescription {
  if (error instanceof StudentInUseError) {
    return {
      kind: 'blocked',
      message: `This student has ${countOf(error.resultCount, 'saved result')}. Delete those results permanently first; then the student can be deleted.`,
    };
  }
  if (error instanceof InvalidStudentError) {
    return {
      kind: 'invalid',
      message: error.problems.map(describeStudentProblem).join(' '),
    };
  }
  if (error instanceof DuplicateStudentIdError) {
    return {
      kind: 'invalid',
      message: `Another student already has the Student ID “${error.studentNumber}”.`,
    };
  }
  // Before RecordNotFoundError, which it extends: a missing class is correctable.
  if (error instanceof ClassNotFoundError) {
    return { kind: 'invalid', message: 'That class no longer exists. Choose another class.' };
  }
  if (error instanceof RecordNotFoundError) {
    return { kind: 'missing', message: 'That student no longer exists.' };
  }
  if (error instanceof RosterFileError) {
    return { kind: 'invalid', message: describeRosterFile(error.failure) };
  }
  return {
    kind: 'failure',
    message: 'Something went wrong on this device. Nothing was changed. Try again.',
  };
}

const ROW_PROBLEMS: Record<RosterRowProblem, string> = {
  MISSING_STUDENT_ID: 'Student ID is missing',
  STUDENT_ID_TOO_LONG: `Student ID is longer than ${STUDENT_ID_MAX_LENGTH} characters`,
  MISSING_FULL_NAME: 'full name is missing',
  FULL_NAME_TOO_LONG: `full name is longer than ${STUDENT_NAME_MAX_LENGTH} characters`,
  MISSING_CLASS: 'grade_and_section and course are both empty',
  TOO_MANY_VALUES: 'more values than columns; put a name that contains a comma in quotation marks',
};

/** "Student ID is missing; full name is missing." */
export function describeRosterRowProblems(problems: readonly RosterRowProblem[]): string {
  const text = problems.map((problem) => ROW_PROBLEMS[problem]).join('; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
