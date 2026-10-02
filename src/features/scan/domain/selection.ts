/**
 * What the Teacher has chosen for a scan, in the order it must be chosen:
 * subject, then an answer key of that subject and a class that takes it, then
 * a student of that class. Nothing is read from the sheet: these choices are
 * the identity the result is saved under.
 */
export type ScanSelection = {
  subjectId: string | null;
  answerKeyId: string | null;
  classId: string | null;
  studentId: string | null;
};

export const EMPTY_SELECTION: ScanSelection = {
  subjectId: null,
  answerKeyId: null,
  classId: null,
  studentId: null,
};

/**
 * Choosing another subject. The answer key always belonged to the old subject
 * and is cleared. The class is kept only if it also takes the new subject;
 * otherwise it and its student are cleared.
 */
export function selectSubject(
  selection: ScanSelection,
  subjectId: string | null,
  classIdsOfSubject: readonly string[]
): ScanSelection {
  if (subjectId === selection.subjectId) return selection;
  const keepsClass =
    subjectId !== null && selection.classId !== null && classIdsOfSubject.includes(selection.classId);
  return {
    subjectId,
    answerKeyId: null,
    classId: keepsClass ? selection.classId : null,
    studentId: keepsClass ? selection.studentId : null,
  };
}

export function selectAnswerKey(selection: ScanSelection, answerKeyId: string | null): ScanSelection {
  return { ...selection, answerKeyId };
}

/** Choosing another class clears the student, who belonged to the old one. */
export function selectClass(selection: ScanSelection, classId: string | null): ScanSelection {
  if (classId === selection.classId) return selection;
  return { ...selection, classId, studentId: null };
}

export function selectStudent(selection: ScanSelection, studentId: string | null): ScanSelection {
  return { ...selection, studentId };
}

/** A selection with all four choices made. */
export type CompleteSelection = {
  subjectId: string;
  answerKeyId: string;
  classId: string;
  studentId: string;
};

export function isComplete(selection: ScanSelection): selection is CompleteSelection {
  return (
    selection.subjectId !== null &&
    selection.answerKeyId !== null &&
    selection.classId !== null &&
    selection.studentId !== null
  );
}
