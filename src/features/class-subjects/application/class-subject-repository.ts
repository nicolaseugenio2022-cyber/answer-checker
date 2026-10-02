import { RecordNotFoundError } from '../../../core/application/errors';
import type { SchoolClass } from '../../classes/domain/school-class';
import type { Subject } from '../../subjects/domain/subject';

export { ClassNotFoundError } from '../../classes/application/class-repository';

/** A subject named in an assignment operation does not exist. */
export class SubjectNotFoundError extends RecordNotFoundError {
  constructor(id: string) {
    super(id);
    this.name = 'SubjectNotFoundError';
  }
}

/**
 * Local storage for "this subject is taught to this class". Every method that
 * takes an id throws ClassNotFoundError or SubjectNotFoundError when that
 * record does not exist, and any method can fail with an error whose code is
 * `DATABASE_ERROR`.
 */
export type ClassSubjectRepository = {
  /** Alphabetically, ignoring letter case. */
  listSubjectsForClass(classId: string): Promise<Subject[]>;
  /** Alphabetically, ignoring letter case. */
  listClassesForSubject(subjectId: string): Promise<SchoolClass[]>;
  isAssigned(classId: string, subjectId: string): Promise<boolean>;
  /** Does nothing when the subject is already assigned to the class. */
  assign(classId: string, subjectId: string, createdAt: string): Promise<void>;
  /** Does nothing when the subject is not assigned to the class. */
  remove(classId: string, subjectId: string): Promise<void>;
  /**
   * Makes `subjectIds` the complete set for the class, all or nothing.
   * Assignments that stay keep their original `created_at`.
   */
  replaceSubjectsForClass(classId: string, subjectIds: string[], createdAt: string): Promise<void>;
  /** Number of assigned subjects by class id. Classes with none are absent. */
  countSubjectsByClass(): Promise<Record<string, number>>;
  /** Number of classes by subject id. Subjects with none are absent. */
  countClassesBySubject(): Promise<Record<string, number>>;
};
