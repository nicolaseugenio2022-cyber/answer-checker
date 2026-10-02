import { RecordNotFoundError } from '../../../core/application/errors';
import type { Clock, IdGenerator } from '../../../core/application/ports';
import { requireValidName } from '../../../core/application/require-valid-name';
import { SUBJECT_NAME_MAX_LENGTH, type Subject } from '../domain/subject';
import type { SubjectRepository } from './subject-repository';

type Dependencies = {
  repository: SubjectRepository;
  clock: Clock;
  idGenerator: IdGenerator;
};

export type SubjectUseCases = ReturnType<typeof createSubjectUseCases>;

export function createSubjectUseCases({ repository, clock, idGenerator }: Dependencies) {
  return {
    listSubjects(): Promise<Subject[]> {
      return repository.list();
    },

    /** @throws InvalidNameError, DuplicateNameError */
    async addSubject(rawName: string): Promise<Subject> {
      const name = requireValidName(rawName, SUBJECT_NAME_MAX_LENGTH);
      const now = clock.now();
      const subject: Subject = { id: idGenerator.newId(), name, createdAt: now, updatedAt: now };
      await repository.create(subject);
      return subject;
    },

    /**
     * Renaming to the name the subject already has changes nothing, not even
     * `updatedAt`.
     * @throws InvalidNameError, RecordNotFoundError, DuplicateNameError
     */
    async renameSubject(id: string, rawName: string): Promise<Subject> {
      const name = requireValidName(rawName, SUBJECT_NAME_MAX_LENGTH);
      const current = await repository.getById(id);
      if (!current) throw new RecordNotFoundError(id);
      if (current.name === name) return current;
      return repository.rename(id, name, clock.now());
    },

    /**
     * Permanent: the row is physically deleted and cannot be restored.
     * @throws RecordNotFoundError, SubjectInUseError
     */
    deleteSubject(id: string): Promise<void> {
      return repository.delete(id);
    },
  };
}
