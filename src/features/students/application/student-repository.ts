import { ApplicationError, RecordInUseError } from '../../../core/application/errors';
import type { Student, StudentInput, StudentProblem } from '../domain/student';

/** A student together with the name of the class it belongs to, for lists. */
export type StudentWithClass = Student & { className: string };

/** The Student ID, full name, or class is missing or too long. */
export class InvalidStudentError extends ApplicationError {
  readonly problems: StudentProblem[];

  constructor(problems: StudentProblem[]) {
    super('VALIDATION_ERROR', 'The student is not valid.');
    this.name = 'InvalidStudentError';
    this.problems = problems;
  }
}

/** Another student already has this Student ID, ignoring letter case. */
export class DuplicateStudentIdError extends ApplicationError {
  readonly studentNumber: string;

  constructor(studentNumber: string) {
    super('DUPLICATE_STUDENT_ID', 'Another student already has this Student ID.');
    this.name = 'DuplicateStudentIdError';
    this.studentNumber = studentNumber;
  }
}

/** The student cannot be deleted because saved results belong to it. */
export class StudentInUseError extends RecordInUseError {
  readonly resultCount: number;

  constructor(resultCount: number) {
    super('The student has saved results.');
    this.name = 'StudentInUseError';
    this.resultCount = resultCount;
  }
}

/**
 * Local storage for students. Besides the errors named below, every method
 * can fail with an error whose code is `DATABASE_ERROR`.
 */
export type StudentRepository = {
  /**
   * Students of one class, or of every class when `classId` is null, ordered
   * by class name, full name (ignoring letter case), Student ID, then id.
   */
  list(classId: string | null): Promise<StudentWithClass[]>;
  getById(id: string): Promise<StudentWithClass | null>;
  /** Every stored Student ID, for checking a whole roster with one query. */
  listStudentNumbers(): Promise<string[]>;
  /** @throws ClassNotFoundError, DuplicateStudentIdError */
  create(student: Student): Promise<void>;
  /**
   * Stores all of the students or none of them.
   * @throws ClassNotFoundError, DuplicateStudentIdError
   */
  createMany(students: readonly Student[]): Promise<void>;
  /**
   * Changes the Student ID, full name, and class; `createdAt` is kept.
   * @throws RecordNotFoundError, ClassNotFoundError, DuplicateStudentIdError
   */
  update(id: string, changes: StudentInput, updatedAt: string): Promise<Student>;
  /**
   * Permanently deletes the student. Never deletes results.
   * @throws RecordNotFoundError, StudentInUseError
   */
  delete(id: string): Promise<void>;
};
