/**
 * The filters of the results list: subject, answer key, class, student. Each
 * is an id or null for "all". They belong to the Results screen alone and
 * have nothing to do with what is chosen on the Scan screen.
 *
 * The choices offered come from the saved results themselves: only a subject,
 * answer key, class, or student that has a result can be picked, so a filter
 * never leads to an empty list by construction.
 */
export type ResultFilter = {
  subjectId: string | null;
  answerKeyId: string | null;
  /** The class a result was scanned under. */
  classId: string | null;
  studentId: string | null;
};

export const NO_FILTER: ResultFilter = {
  subjectId: null,
  answerKeyId: null,
  classId: null,
  studentId: null,
};

export function hasActiveFilter(filter: ResultFilter): boolean {
  return (
    filter.subjectId !== null ||
    filter.answerKeyId !== null ||
    filter.classId !== null ||
    filter.studentId !== null
  );
}

/**
 * One combination that occurs among the saved results: a student scanned in a
 * class with an answer key of a subject. Names are the records' current ones.
 */
export type ResultLink = {
  subjectId: string;
  subjectName: string;
  answerKeyId: string;
  answerKeyName: string;
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
  studentNumber: string;
};

export type FilterChoice = { id: string; name: string; detail?: string };

export type FilterChoices = {
  subjects: FilterChoice[];
  answerKeys: FilterChoice[];
  classes: FilterChoice[];
  students: FilterChoice[];
};

const byName = (a: FilterChoice, b: FilterChoice) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
  (a.detail ?? '').localeCompare(b.detail ?? '') ||
  a.id.localeCompare(b.id);

function distinct(
  links: readonly ResultLink[],
  choiceOf: (link: ResultLink) => FilterChoice
): FilterChoice[] {
  const seen = new Map<string, FilterChoice>();
  for (const link of links) {
    const choice = choiceOf(link);
    if (!seen.has(choice.id)) seen.set(choice.id, choice);
  }
  return [...seen.values()].sort(byName);
}

/**
 * What each filter offers, given the filters above it:
 * - every subject;
 * - the answer keys of the chosen subject;
 * - the classes scanned with the chosen subject and answer key;
 * - the students scanned in the chosen class, with the chosen subject and key.
 */
export function filterChoices(links: readonly ResultLink[], filter: ResultFilter): FilterChoices {
  const ofSubject = links.filter(
    (link) => filter.subjectId === null || link.subjectId === filter.subjectId
  );
  const ofKey = ofSubject.filter(
    (link) => filter.answerKeyId === null || link.answerKeyId === filter.answerKeyId
  );
  const ofClass = ofKey.filter((link) => filter.classId === null || link.classId === filter.classId);

  return {
    subjects: distinct(links, (link) => ({ id: link.subjectId, name: link.subjectName })),
    answerKeys: distinct(ofSubject, (link) => ({
      id: link.answerKeyId,
      name: link.answerKeyName,
      detail: link.subjectName,
    })),
    classes: distinct(ofKey, (link) => ({ id: link.classId, name: link.className })),
    students: distinct(ofClass, (link) => ({
      id: link.studentId,
      name: link.studentName,
      detail: link.studentNumber,
    })),
  };
}

/**
 * Clears, from the top down, every filter whose value is no longer offered
 * under the filters above it. Also used after a deletion, when the last
 * result of a filtered record may be gone.
 */
export function withoutIncompatible(links: readonly ResultLink[], filter: ResultFilter): ResultFilter {
  let next = filter;
  const offered = (choices: FilterChoice[], id: string | null) =>
    id === null || choices.some((choice) => choice.id === id);

  if (!offered(filterChoices(links, next).subjects, next.subjectId)) {
    next = { ...next, subjectId: null };
  }
  if (!offered(filterChoices(links, next).answerKeys, next.answerKeyId)) {
    next = { ...next, answerKeyId: null };
  }
  if (!offered(filterChoices(links, next).classes, next.classId)) {
    next = { ...next, classId: null };
  }
  if (!offered(filterChoices(links, next).students, next.studentId)) {
    next = { ...next, studentId: null };
  }
  return next;
}

export type FilterField = keyof ResultFilter;

/**
 * Sets one filter (null is "all") and clears the filters below it that no
 * longer fit: an answer key of another subject, a class never scanned with
 * that subject or key, a student never scanned in that class.
 */
export function setFilter(
  links: readonly ResultLink[],
  filter: ResultFilter,
  field: FilterField,
  id: string | null
): ResultFilter {
  if (filter[field] === id) return filter;
  return withoutIncompatible(links, { ...filter, [field]: id });
}
