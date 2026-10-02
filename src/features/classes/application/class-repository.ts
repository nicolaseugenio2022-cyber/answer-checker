import { RecordInUseError, RecordNotFoundError } from '../../../core/application/errors';
import type { SchoolClass } from '../domain/school-class';

/** An operation named a class that does not exist. */
export class ClassNotFoundError extends RecordNotFoundError {
  constructor(id: string) {
    super(id);
    this.name = 'ClassNotFoundError';
  }
}

/**
 * The class cannot be deleted because students belong to it, or because saved
 * results were scanned under it (a result keeps the class of its scan even if
 * the student has moved since).
 */
export class ClassInUseError extends RecordInUseError {
  readonly studentCount: number;
  readonly resultCount: number;

  constructor(studentCount: number, resultCount = 0) {
    super('The class has students or saved results.');
    this.name = 'ClassInUseError';
    this.studentCount = studentCount;
    this.resultCount = resultCount;
  }
}

/**
 * Local storage for classes. Besides the errors named below, every method can
 * fail with an error whose code is `DATABASE_ERROR`.
 */
export type ClassRepository = {
  /** All classes, alphabetically, ignoring letter case. */
  list(): Promise<SchoolClass[]>;
  getById(id: string): Promise<SchoolClass | null>;
  /** @throws DuplicateNameError when another class has this name. */
  create(schoolClass: SchoolClass): Promise<void>;
  /**
   * Changes the name and `updatedAt`; `createdAt` is kept.
   * @throws RecordNotFoundError, DuplicateNameError
   */
  rename(id: string, name: string, updatedAt: string): Promise<SchoolClass>;
  /**
   * Permanently deletes the class. Never deletes students or results.
   * @throws RecordNotFoundError, ClassInUseError
   */
  delete(id: string): Promise<void>;
};
