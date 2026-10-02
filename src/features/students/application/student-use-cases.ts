import { ApplicationError, RecordNotFoundError } from '../../../core/application/errors';
import type { Clock, IdGenerator } from '../../../core/application/ports';
import type { ClassRepository } from '../../classes/application/class-repository';
import { readRoster } from '../domain/roster';
import {
  findStudentProblems,
  matchesStudentSearch,
  normalizeStudentInput,
  type Student,
  type StudentInput,
} from '../domain/student';
import {
  buildRosterDraft,
  ROSTER_FILE_MAX_BYTES,
  RosterFileError,
  type RosterDraft,
  type RosterFilePicker,
} from './roster-import';
import {
  InvalidStudentError,
  type StudentRepository,
  type StudentWithClass,
} from './student-repository';

type Dependencies = {
  repository: StudentRepository;
  /** Read only: the classes a student or a roster row can be put in. */
  classRepository: Pick<ClassRepository, 'list'>;
  rosterFilePicker: RosterFilePicker;
  clock: Clock;
  idGenerator: IdGenerator;
};

export type StudentFilter = {
  /** Only this class. Null or omitted: every class. */
  classId?: string | null;
  /** Matches the Student ID or the full name, ignoring letter case. */
  search?: string;
};

export type StudentUseCases = ReturnType<typeof createStudentUseCases>;

export function createStudentUseCases({
  repository,
  classRepository,
  rosterFilePicker,
  clock,
  idGenerator,
}: Dependencies) {
  /** Returns the input in its stored form, or throws InvalidStudentError. */
  function requireValidStudent(input: StudentInput): StudentInput {
    const normalized = normalizeStudentInput(input);
    const problems = findStudentProblems(normalized);
    if (problems.length > 0) throw new InvalidStudentError(problems);
    return normalized;
  }

  /** Reads and checks roster text against what is stored. Stores nothing. */
  async function prepareRoster(fileName: string, text: string): Promise<RosterDraft> {
    const result = readRoster(text);
    if (!result.ok) throw new RosterFileError(result.problem);
    const [storedStudentNumbers, classes] = await Promise.all([
      repository.listStudentNumbers(),
      classRepository.list(),
    ]);
    return buildRosterDraft(fileName, result.roster, storedStudentNumbers, classes);
  }

  return {
    /** Ordered by class name, full name, Student ID, then id. */
    async listStudents(filter: StudentFilter = {}): Promise<StudentWithClass[]> {
      const students = await repository.list(filter.classId ?? null);
      const search = filter.search ?? '';
      return search.trim().length === 0
        ? students
        : students.filter((student) => matchesStudentSearch(student, search));
    },

    getStudent(id: string): Promise<StudentWithClass | null> {
      return repository.getById(id);
    },

    /** @throws InvalidStudentError, ClassNotFoundError, DuplicateStudentIdError */
    async addStudent(input: StudentInput): Promise<Student> {
      const valid = requireValidStudent(input);
      const now = clock.now();
      const student: Student = { id: idGenerator.newId(), ...valid, createdAt: now, updatedAt: now };
      await repository.create(student);
      return student;
    },

    /**
     * Changes the Student ID, the full name, the class, or any of them. Saving
     * without a change does nothing, not even to `updatedAt`.
     * @throws InvalidStudentError, RecordNotFoundError, ClassNotFoundError, DuplicateStudentIdError
     */
    async updateStudent(id: string, input: StudentInput): Promise<Student> {
      const valid = requireValidStudent(input);
      const current = await repository.getById(id);
      if (!current) throw new RecordNotFoundError(id);
      if (
        current.studentNumber === valid.studentNumber &&
        current.fullName === valid.fullName &&
        current.classId === valid.classId
      ) {
        return current;
      }
      return repository.update(id, valid, clock.now());
    },

    /**
     * Permanent: the row is physically deleted and cannot be restored. Blocked
     * while saved results belong to the student; those are never deleted here.
     * @throws RecordNotFoundError, StudentInUseError
     */
    deleteStudent(id: string): Promise<void> {
      return repository.delete(id);
    },

    prepareRoster,

    /**
     * Lets the Teacher pick a roster file and returns it checked, or null when
     * the picker was closed. The file is read into memory and released before
     * this returns, whatever happens: after it, no copy of the file exists in
     * the app, and nothing of it is ever stored except the students imported
     * later.
     * @throws RosterFileError when the file is not a usable roster.
     */
    async pickRoster(): Promise<RosterDraft | null> {
      // Leftovers of a session that was killed between picking and releasing.
      await rosterFilePicker.cleanUpStale().catch(() => undefined);

      const file = await rosterFilePicker.pick();
      if (!file) return null;
      try {
        if (file.size !== null && file.size > ROSTER_FILE_MAX_BYTES) {
          throw new RosterFileError({ kind: 'TOO_LARGE', maxBytes: ROSTER_FILE_MAX_BYTES });
        }
        let text: string;
        try {
          text = await file.read();
        } catch (error) {
          if (error instanceof ApplicationError) throw error;
          throw new RosterFileError({ kind: 'UNREADABLE' });
        }
        return await prepareRoster(file.name, text);
      } finally {
        await file.release();
      }
    },

    /**
     * Stores the confirmed rows of a roster: all of them, or none. Every row
     * is validated again and checked against the stored students inside the
     * write transaction; nothing existing is overwritten.
     * @returns how many students were added.
     * @throws InvalidStudentError, ClassNotFoundError, DuplicateStudentIdError
     */
    async importStudents(inputs: readonly StudentInput[]): Promise<number> {
      const now = clock.now();
      const students = inputs.map((input) => ({
        id: idGenerator.newId(),
        ...requireValidStudent(input),
        createdAt: now,
        updatedAt: now,
      }));
      if (students.length === 0) return 0;
      await repository.createMany(students);
      return students.length;
    },
  };
}
