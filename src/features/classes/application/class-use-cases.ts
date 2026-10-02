import { RecordNotFoundError } from '../../../core/application/errors';
import type { Clock, IdGenerator } from '../../../core/application/ports';
import { requireValidName } from '../../../core/application/require-valid-name';
import { CLASS_NAME_MAX_LENGTH, type SchoolClass } from '../domain/school-class';
import type { ClassRepository } from './class-repository';

type Dependencies = {
  repository: ClassRepository;
  clock: Clock;
  idGenerator: IdGenerator;
};

export type ClassUseCases = ReturnType<typeof createClassUseCases>;

export function createClassUseCases({ repository, clock, idGenerator }: Dependencies) {
  return {
    listClasses(): Promise<SchoolClass[]> {
      return repository.list();
    },

    /** @throws InvalidNameError, DuplicateNameError */
    async addClass(rawName: string): Promise<SchoolClass> {
      const name = requireValidName(rawName, CLASS_NAME_MAX_LENGTH);
      const now = clock.now();
      const schoolClass: SchoolClass = {
        id: idGenerator.newId(),
        name,
        createdAt: now,
        updatedAt: now,
      };
      await repository.create(schoolClass);
      return schoolClass;
    },

    /**
     * Renaming to the name the class already has changes nothing, not even
     * `updatedAt`.
     * @throws InvalidNameError, RecordNotFoundError, DuplicateNameError
     */
    async renameClass(id: string, rawName: string): Promise<SchoolClass> {
      const name = requireValidName(rawName, CLASS_NAME_MAX_LENGTH);
      const current = await repository.getById(id);
      if (!current) throw new RecordNotFoundError(id);
      if (current.name === name) return current;
      return repository.rename(id, name, clock.now());
    },

    /**
     * Permanent: the row is physically deleted and cannot be restored.
     * @throws RecordNotFoundError, ClassInUseError
     */
    deleteClass(id: string): Promise<void> {
      return repository.delete(id);
    },
  };
}
