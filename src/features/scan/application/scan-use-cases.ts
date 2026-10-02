import { ApplicationError } from '../../../core/application/errors';
import type { Clock, IdGenerator } from '../../../core/application/ports';
import type {
  AnswerKeyDetails,
  AnswerKeyRepository,
} from '../../answer-keys/application/answer-key-repository';
import type { ClassSubjectRepository } from '../../class-subjects/application/class-subject-repository';
import type { StudentRepository, StudentWithClass } from '../../students/application/student-repository';
import type { SubjectRepository } from '../../subjects/application/subject-repository';
import { startReview, unresolvedCount, type ReviewItem } from '../domain/detection';
import { scoreReview, type Score } from '../domain/scoring';
import { isComplete, type CompleteSelection, type ScanSelection } from '../domain/selection';
import { buildAnswerSheetPdf } from '../domain/sheet-pdf';
import {
  MAX_SHEET_QUESTIONS,
  fitsOneSheet,
  sheetTemplate,
  type SheetTemplate,
} from '../domain/template';
import {
  AnswerKeyChangedError,
  CaptureRejectedError,
  DuplicateAttemptError,
  IncompleteReviewError,
  ScanImageError,
  ScanSelectionError,
  SheetShareError,
  type AnswerKeySnapshot,
  type PrintableSheet,
  type PreviousAttempt,
  type ResultRepository,
  type ScanImageStore,
  type SheetReader,
} from './scan-ports';

type Dependencies = {
  subjects: Pick<SubjectRepository, 'list' | 'getById'>;
  answerKeys: Pick<AnswerKeyRepository, 'list' | 'getById'>;
  classSubjects: Pick<ClassSubjectRepository, 'listClassesForSubject' | 'isAssigned'>;
  students: Pick<StudentRepository, 'list' | 'getById'>;
  results: ResultRepository;
  reader: SheetReader;
  images: ScanImageStore;
  /** Shares a generated sheet. Optional: without it, sharing reports that it is unavailable. */
  printableSheet?: PrintableSheet;
  clock: Clock;
  idGenerator: IdGenerator;
};

type Option = { id: string; name: string };

/** What the Teacher can choose from, given what is chosen so far. */
export type ScanOptions = {
  subjects: Option[];
  /** Answer keys of the chosen subject. A key too long for one sheet cannot be scanned. */
  answerKeys: (Option & { questionCount: number; fitsSheet: boolean })[];
  /** Classes the chosen subject is taught to. */
  classes: Option[];
  /**
   * Students of the chosen class. `scanCount` is how many results the student
   * already has with the chosen answer key; 0 while no key is chosen.
   */
  students: (Option & { studentNumber: string; scanCount: number })[];
  /** The most questions one sheet has room for. */
  maxSheetQuestions: number;
};

/** The records a valid selection names, as they are right now. */
export type ScanTarget = {
  selection: CompleteSelection;
  subjectName: string;
  answerKey: AnswerKeySnapshot;
  className: string;
  student: { id: string; fullName: string; studentNumber: string };
};

/**
 * A sheet that was read and waits for the Teacher's review. It lives in memory
 * and in one cache file (the preview). Nothing is in the database yet.
 */
export type ScanDraft = {
  target: ScanTarget;
  /** The sheet that was read: the one generated for the answer key's question count. */
  template: SheetTemplate;
  templateId: string;
  capturedAt: string;
  /** The flattened sheet, in the app's cache. */
  previewUri: string;
  /** One item per question of the answer key. */
  review: ReviewItem[];
};

export type SavedResult = { id: string; score: number; total: number; imagePath: string };

export type ScanUseCases = ReturnType<typeof createScanUseCases>;

export function createScanUseCases({
  subjects,
  answerKeys,
  classSubjects,
  students,
  results,
  reader,
  images,
  printableSheet,
  clock,
  idGenerator,
}: Dependencies) {
  const snapshot = (key: AnswerKeyDetails): AnswerKeySnapshot => ({
    id: key.id,
    name: key.name,
    questionCount: key.questionCount,
    answers: [...key.answers],
  });

  /**
   * Checks the four choices against the stored records, not against what a
   * screen showed: the answer key must belong to the subject, the subject must
   * be taught to the class, and the student must be in the class.
   * @throws ScanSelectionError
   */
  async function validateSelection(selection: ScanSelection): Promise<ScanTarget> {
    if (!isComplete(selection)) throw new ScanSelectionError('INCOMPLETE');

    const subject = await subjects.getById(selection.subjectId);
    if (!subject) throw new ScanSelectionError('SUBJECT_MISSING');

    const answerKey = await answerKeys.getById(selection.answerKeyId);
    if (!answerKey) throw new ScanSelectionError('ANSWER_KEY_MISSING');
    if (answerKey.subjectId !== subject.id) throw new ScanSelectionError('ANSWER_KEY_NOT_OF_SUBJECT');
    if (!fitsOneSheet(answerKey.questionCount)) throw new ScanSelectionError('ANSWER_KEY_TOO_LONG');

    const classes = await classSubjects.listClassesForSubject(subject.id);
    const schoolClass = classes.find((candidate) => candidate.id === selection.classId);
    if (!schoolClass) {
      // Tell a class that is gone from one the subject is no longer taught to.
      let classExists = true;
      try {
        await classSubjects.isAssigned(selection.classId, subject.id);
      } catch (error) {
        if (!(error instanceof ApplicationError) || error.code !== 'NOT_FOUND') throw error;
        classExists = false;
      }
      throw new ScanSelectionError(classExists ? 'CLASS_NOT_ASSIGNED' : 'CLASS_MISSING');
    }

    const student: StudentWithClass | null = await students.getById(selection.studentId);
    if (!student) throw new ScanSelectionError('STUDENT_MISSING');
    if (student.classId !== schoolClass.id) throw new ScanSelectionError('STUDENT_NOT_IN_CLASS');

    return {
      selection,
      subjectName: subject.name,
      answerKey: snapshot(answerKey),
      className: schoolClass.name,
      student: { id: student.id, fullName: student.fullName, studentNumber: student.studentNumber },
    };
  }

  /** Runs a step that touches scan files; anything it throws becomes a typed file error. */
  async function withImages<T>(step: () => Promise<T>): Promise<T> {
    try {
      return await step();
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ScanImageError();
    }
  }

  return {
    /**
     * The lists for the four steps. Answer keys and classes are those of the
     * chosen subject; students are those of the chosen class. Before a subject
     * or class is chosen, its dependent lists are empty.
     */
    async listOptions(selection: ScanSelection): Promise<ScanOptions> {
      const [allSubjects, keys, classes, classStudents, scanCounts] = await Promise.all([
        subjects.list(),
        selection.subjectId ? answerKeys.list(selection.subjectId) : Promise.resolve([]),
        selection.subjectId
          ? classSubjects.listClassesForSubject(selection.subjectId).catch((error) => {
              // The subject was deleted elsewhere: nothing can be chosen under it.
              if (error instanceof ApplicationError && error.code === 'NOT_FOUND') return [];
              throw error;
            })
          : Promise.resolve([]),
        selection.classId ? students.list(selection.classId) : Promise.resolve([]),
        selection.answerKeyId
          ? results.countAttemptsByStudent(selection.answerKeyId)
          : Promise.resolve({} as Record<string, number>),
      ]);
      return {
        subjects: allSubjects.map(({ id, name }) => ({ id, name })),
        answerKeys: keys.map((key) => ({
          id: key.id,
          name: key.name,
          questionCount: key.questionCount,
          fitsSheet: fitsOneSheet(key.questionCount),
        })),
        classes: classes.map(({ id, name }) => ({ id, name })),
        students: classStudents.map((student) => ({
          id: student.id,
          name: student.fullName,
          studentNumber: student.studentNumber,
          scanCount: scanCounts[student.id] ?? 0,
        })),
        maxSheetQuestions: MAX_SHEET_QUESTIONS,
      };
    },

    /** The class ids a subject is taught to, for clearing a class that no longer fits. */
    async classIdsOfSubject(subjectId: string): Promise<string[]> {
      const classes = await classSubjects.listClassesForSubject(subjectId);
      return classes.map((schoolClass) => schoolClass.id);
    },

    validateSelection,

    /** Earlier results of the chosen student with the chosen answer key, newest first. */
    async previousAttempts(selection: ScanSelection): Promise<PreviousAttempt[]> {
      if (!isComplete(selection)) return [];
      return results.listAttempts(selection.answerKeyId, selection.studentId);
    },

    /**
     * Reads a captured photo as the sheet generated for the chosen answer
     * key's question count. The capture is deleted whatever happens: after a
     * good reading only the flattened preview remains, after a refused or
     * failed one nothing does.
     * @throws ScanSelectionError, CaptureRejectedError, ScanImageError
     */
    async readCapture(captureUri: string, selection: ScanSelection): Promise<ScanDraft> {
      try {
        const target = await validateSelection(selection);
        const capturedAt = clock.now();
        const image = await withImages(() => images.loadCapture(captureUri));
        // The same geometry the printable sheet for this answer key is drawn from.
        const template = sheetTemplate(target.answerKey.questionCount);
        const reading = reader.read(image, template);
        if (!reading.ok) {
          throw new CaptureRejectedError(reading.problem, {
            sheet: reading.sheetQuestionCount,
            expected: template.questionCount,
          });
        }
        // A reader that returns anything but the expected sheet is not trusted.
        if (
          reading.templateId !== template.id ||
          reading.detections.length !== template.questionCount
        ) {
          throw new CaptureRejectedError('UNSUPPORTED_TEMPLATE');
        }

        const previewUri = await withImages(() => images.writePreview(reading.rectified));
        return {
          target,
          template,
          templateId: reading.templateId,
          capturedAt,
          previewUri,
          // The sheet has exactly the questions of the answer key.
          review: startReview(reading.detections),
        };
      } finally {
        await images.discardCapture(captureUri).catch(() => undefined);
      }
    },

    /** Deletes a capture that will not be read: Retake or Cancel on the camera. */
    async discardCapture(captureUri: string): Promise<void> {
      await images.discardCapture(captureUri).catch(() => undefined);
    },

    /** Throws a draft away: Retake or Cancel on the review. Its preview is deleted. */
    async discardDraft(draft: ScanDraft): Promise<void> {
      await images.discardPreview(draft.previewUri).catch(() => undefined);
    },

    /**
     * Scores the reviewed sheet and saves the result with its answers and its
     * one image.
     *
     * Everything is checked again first, against the database as it is now:
     * the four records and their relationships, and that the answer key still
     * has the answers the sheet was reviewed against.
     *
     * A student who already has a result with this key gets a second, separate
     * one only when `confirmDuplicate` is true. The earlier result is never
     * replaced or deleted.
     *
     * Order of work: the image is moved to its permanent place, then the rows
     * are written in one transaction. If the transaction fails, the image is
     * deleted again. If the image cannot be moved, no row is written.
     *
     * @throws ScanSelectionError, AnswerKeyChangedError, IncompleteReviewError,
     *   DuplicateAttemptError, ScanImageError, and errors with the code DATABASE_ERROR
     */
    async saveResult(
      draft: ScanDraft,
      review: readonly ReviewItem[],
      options: { confirmDuplicate?: boolean } = {}
    ): Promise<SavedResult> {
      const target = await validateSelection(draft.target.selection);

      const before = draft.target.answerKey;
      const now = target.answerKey;
      const keyIsUnchanged =
        now.questionCount === before.questionCount &&
        now.answers.length === before.answers.length &&
        now.answers.every((answer, index) => answer === before.answers[index]);
      if (!keyIsUnchanged) throw new AnswerKeyChangedError();

      const waiting = unresolvedCount(review);
      if (waiting > 0) throw new IncompleteReviewError(waiting);

      const scored = scoreReview(review, now.answers);
      if (!scored.ok) {
        if (scored.problem === 'UNRESOLVED') throw new IncompleteReviewError(waiting);
        throw new AnswerKeyChangedError();
      }
      const score: Score = scored.value;
      // The stored total must be what the stored answers add up to.
      if (score.score !== score.answers.filter((answer) => answer.isCorrect).length) {
        throw new AnswerKeyChangedError();
      }

      const previous = await results.listAttempts(target.selection.answerKeyId, target.student.id);
      if (previous.length > 0 && !options.confirmDuplicate) throw new DuplicateAttemptError(previous);

      const id = idGenerator.newId();
      const imagePath = await withImages(() => images.keepPreview(draft.previewUri, id));
      try {
        await results.save({
          id,
          answerKeyId: target.selection.answerKeyId,
          studentId: target.student.id,
          classId: target.selection.classId,
          // Taken from the records as validated a moment ago, not from the draft.
          studentName: target.student.fullName,
          studentNumber: target.student.studentNumber,
          className: target.className,
          subjectName: target.subjectName,
          answerKeyName: target.answerKey.name,
          score: score.score,
          total: score.total,
          templateId: draft.templateId,
          capturedAt: draft.capturedAt,
          createdAt: clock.now(),
          answers: score.answers,
          scanRecordId: idGenerator.newId(),
          imagePath,
        });
      } catch (error) {
        // The rows were rolled back; the image must not outlive them.
        await images.deleteFinal(imagePath).catch(() => undefined);
        throw error;
      }
      return { id, score: score.score, total: score.total, imagePath };
    },

    /** Best effort, at the start of a scan session: removes leftover and orphaned scan files. */
    async cleanUpScanFiles(): Promise<void> {
      try {
        await images.cleanUp(await results.listImagePaths());
      } catch {
        // Cleanup must never block scanning; it runs again next time.
      }
    },

    /**
     * Makes the printable answer sheet for exactly this many questions and
     * opens the share sheet for it, to view, print, or send it. It is drawn
     * from the template the reader will expect for an answer key of the same
     * length.
     * @throws SheetShareError
     */
    async sharePrintableSheet(questionCount: number): Promise<void> {
      if (!fitsOneSheet(questionCount)) throw new SheetShareError('TOO_LONG');
      let shared: boolean;
      try {
        const pdf = buildAnswerSheetPdf(sheetTemplate(questionCount));
        const fileName = `Answer sheet - ${questionCount} ${questionCount === 1 ? 'question' : 'questions'}.pdf`;
        shared = printableSheet ? await printableSheet.share(pdf, fileName) : false;
      } catch {
        throw new SheetShareError('FAILED');
      }
      if (!shared) throw new SheetShareError('UNAVAILABLE');
    },

    /** Where to display a preview or a stored image from. */
    imageUri(pathOrUri: string): string {
      return images.uriOf(pathOrUri);
    },
  };
}
