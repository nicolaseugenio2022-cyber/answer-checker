import { ApplicationError } from '../../../core/application/errors';
import {
  suggestClassForGroup,
  type Roster,
  type RosterFileProblem,
  type RosterGroup,
  type RosterRejectedRow,
} from '../domain/roster';
import { studentNumberKey, type StudentInput } from '../domain/student';

/** Larger than any class roster; stops a wrong file from being read into memory. */
export const ROSTER_FILE_MAX_BYTES = 1024 * 1024;

/** A file the Teacher picked, as the app is allowed to see it. */
export type PickedRosterFile = {
  /** File name only, for display. Never stored. */
  name: string;
  /** Size in bytes, when the picker reports it. */
  size: number | null;
  read(): Promise<string>;
  /**
   * Ends the app's use of the file. Deletes the app-owned temporary copy if
   * the picker made one. Never touches the Teacher's original file.
   */
  release(): Promise<void>;
};

/** Port for choosing a roster file on the device. Implemented in infrastructure. */
export type RosterFilePicker = {
  /** Resolves to null when the Teacher closes the picker without choosing. */
  pick(): Promise<PickedRosterFile | null>;
  /** Best effort: removes temporary copies left behind by an interrupted session. */
  cleanUpStale(): Promise<void>;
};

export type RosterFileFailure =
  | RosterFileProblem
  | { kind: 'TOO_LARGE'; maxBytes: number }
  | { kind: 'UNREADABLE' };

/** The picked file cannot be used as a roster. Nothing was stored. */
export class RosterFileError extends ApplicationError {
  readonly failure: RosterFileFailure;

  constructor(failure: RosterFileFailure) {
    super('ROSTER_FILE_ERROR', 'The file cannot be used as a student roster.');
    this.name = 'RosterFileError';
    this.failure = failure;
  }
}

export type RosterDraftGroup = RosterGroup & {
  /** The one existing class that matches exactly, if there is exactly one. */
  suggestedClassId: string | null;
  /** More than one class matches, so none was selected. */
  isAmbiguous: boolean;
};

/**
 * A roster that has been read and checked but not stored: what the import
 * preview shows. It holds the rows in memory only; the file itself has
 * already been released.
 */
export type RosterDraft = Omit<Roster, 'groups'> & {
  fileName: string;
  /** Rows whose Student ID a stored student already has. They are not imported. */
  existing: RosterRejectedRow[];
  groups: RosterDraftGroup[];
  /** The classes that exist, for choosing a destination. */
  classes: { id: string; name: string }[];
};

/** Where the Teacher wants the rows to go. */
export type RosterSelection = {
  /** SINGLE_CLASS: the class for every row. */
  destinationClassId: string | null;
  /** MULTI_CLASS: the class for each group key. Missing or null means not chosen. */
  groupClassIds: Readonly<Record<string, string | null>>;
};

export type RosterResolution = {
  /** Valid, not duplicated, not already stored, and with a chosen class. */
  importable: StudentInput[];
  /** Otherwise importable rows that still have no class. */
  unresolvedRowCount: number;
  /** Groups that still have no class. */
  unresolvedGroupCount: number;
};

/** Turns a checked roster into a draft, given what is already stored. Pure. */
export function buildRosterDraft(
  fileName: string,
  roster: Roster,
  storedStudentNumbers: readonly string[],
  classes: readonly { id: string; name: string }[]
): RosterDraft {
  const stored = new Set(storedStudentNumbers.map(studentNumberKey));
  const existing: RosterRejectedRow[] = [];
  const rows = roster.rows.filter((row) => {
    if (!stored.has(studentNumberKey(row.studentNumber))) return true;
    existing.push({ rowNumber: row.rowNumber, studentNumber: row.studentNumber, fullName: row.fullName });
    return false;
  });

  const groups = roster.groups
    .map((group) => {
      const suggestion = suggestClassForGroup(group, classes);
      return {
        ...group,
        rowCount: rows.filter((row) => row.groupKey === group.key).length,
        suggestedClassId: suggestion.kind === 'MATCH' ? suggestion.classId : null,
        isAmbiguous: suggestion.kind === 'AMBIGUOUS',
      };
    })
    // A group whose rows are all already stored needs no class.
    .filter((group) => group.rowCount > 0);

  return {
    fileName,
    format: roster.format,
    totalRows: roster.totalRows,
    rows,
    invalid: roster.invalid,
    duplicates: roster.duplicates,
    existing,
    groups,
    classes: classes.map(({ id, name }) => ({ id, name })),
  };
}

/** The selection a new draft starts with: only exact, unambiguous matches are chosen. */
export function initialRosterSelection(draft: RosterDraft): RosterSelection {
  return {
    destinationClassId: null,
    groupClassIds: Object.fromEntries(
      draft.groups.map((group) => [group.key, group.suggestedClassId])
    ),
  };
}

/** Which rows would be imported with the Teacher's current choices. Pure. */
export function resolveRoster(draft: RosterDraft, selection: RosterSelection): RosterResolution {
  const knownClassIds = new Set(draft.classes.map((schoolClass) => schoolClass.id));
  const classFor = (groupKey: string | null): string | null => {
    const chosen =
      draft.format === 'SINGLE_CLASS'
        ? selection.destinationClassId
        : (selection.groupClassIds[groupKey ?? ''] ?? null);
    return chosen !== null && knownClassIds.has(chosen) ? chosen : null;
  };

  const importable: StudentInput[] = [];
  let unresolvedRowCount = 0;
  for (const row of draft.rows) {
    const classId = classFor(row.groupKey);
    if (classId === null) unresolvedRowCount++;
    else importable.push({ studentNumber: row.studentNumber, fullName: row.fullName, classId });
  }

  return {
    importable,
    unresolvedRowCount,
    unresolvedGroupCount: draft.groups.filter((group) => classFor(group.key) === null).length,
  };
}
