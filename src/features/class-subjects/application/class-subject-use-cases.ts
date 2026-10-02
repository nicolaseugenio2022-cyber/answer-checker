import type { Clock } from '../../../core/application/ports';
import type { SchoolClass } from '../../classes/domain/school-class';
import type { Subject } from '../../subjects/domain/subject';
import type { ClassSubjectRepository } from './class-subject-repository';

type Dependencies = {
  repository: ClassSubjectRepository;
  clock: Clock;
};

export type ClassSubjectUseCases = ReturnType<typeof createClassSubjectUseCases>;

/**
 * Which subjects are taught to which classes. Unknown ids are reported with
 * ClassNotFoundError or SubjectNotFoundError.
 */
export function createClassSubjectUseCases({ repository, clock }: Dependencies) {
  return {
    listSubjectsForClass(classId: string): Promise<Subject[]> {
      return repository.listSubjectsForClass(classId);
    },

    /** What the scanning flow will call after the Teacher picks a subject. */
    listClassesForSubject(subjectId: string): Promise<SchoolClass[]> {
      return repository.listClassesForSubject(subjectId);
    },

    isSubjectAssignedToClass(classId: string, subjectId: string): Promise<boolean> {
      return repository.isAssigned(classId, subjectId);
    },

    /** Assigning a subject the class already has changes nothing. */
    assignSubjectToClass(classId: string, subjectId: string): Promise<void> {
      return repository.assign(classId, subjectId, clock.now());
    },

    /** Removing a subject the class does not have changes nothing. */
    removeSubjectFromClass(classId: string, subjectId: string): Promise<void> {
      return repository.remove(classId, subjectId);
    },

    /** Saves the complete selection for a class in one step: all of it, or none. */
    replaceSubjectsForClass(classId: string, subjectIds: readonly string[]): Promise<void> {
      return repository.replaceSubjectsForClass(classId, [...new Set(subjectIds)], clock.now());
    },

    countSubjectsByClass(): Promise<Record<string, number>> {
      return repository.countSubjectsByClass();
    },

    countClassesBySubject(): Promise<Record<string, number>> {
      return repository.countClassesBySubject();
    },
  };
}
