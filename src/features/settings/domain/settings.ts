/**
 * The app's own preferences and the rules of its data-management actions.
 * Everything here is local to the device: nothing is an account, and nothing
 * is sent anywhere.
 */

/** How the app is themed. "system" follows the phone and changes with it. */
export type Appearance = 'system' | 'light' | 'dark';

export const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];

/** A fresh install follows the phone. */
export const DEFAULT_APPEARANCE: Appearance = 'system';

/** Reads a stored value; anything unknown (or nothing) is the default. */
export function parseAppearance(value: string | null | undefined): Appearance {
  return APPEARANCES.includes(value as Appearance) ? (value as Appearance) : DEFAULT_APPEARANCE;
}

/** The longest display name the greeting can show without crowding the header. */
export const TEACHER_NAME_MAX_LENGTH = 30;

/** What the greeting says when no display name is set. */
export const DEFAULT_TEACHER_NAME = 'Teacher';

export type TeacherNameProblem = 'TOO_LONG';

/**
 * The optional display name as it is stored: trimmed, with runs of whitespace
 * collapsed. An empty name is valid and means "no name". Length is counted in
 * characters, not UTF-16 units.
 */
export function normalizeTeacherName(
  input: string
): { ok: true; name: string } | { ok: false; problem: TeacherNameProblem } {
  const name = input.normalize('NFC').replace(/\s+/g, ' ').trim();
  if ([...name].length > TEACHER_NAME_MAX_LENGTH) return { ok: false, problem: 'TOO_LONG' };
  return { ok: true, name };
}

export type Preferences = {
  appearance: Appearance;
  /** Empty when no display name is set. */
  teacherName: string;
};

export const DEFAULT_PREFERENCES: Preferences = {
  appearance: DEFAULT_APPEARANCE,
  teacherName: '',
};

/** How many academic records are stored. */
export type AcademicCounts = {
  students: number;
  classes: number;
  subjects: number;
  answerKeys: number;
  results: number;
};

export type StorageSummary = {
  /** Null when the database could not be read. */
  counts: AcademicCounts | null;
  /** Bytes used by the stored scan images of saved results; null when it could not be measured. */
  scanImageBytes: number | null;
  /** Bytes used by temporary files the app can safely remove; null when it could not be measured. */
  temporaryBytes: number | null;
};

/** What must be typed, exactly, before all academic data is deleted. */
export const DELETE_ALL_PHRASE = 'DELETE ALL DATA';

/** Exact match: same letters, same case, same spaces, nothing before or after. */
export function isDeleteAllPhrase(typed: string): boolean {
  return typed === DELETE_ALL_PHRASE;
}

/** "0 B", "512 B", "1.4 MB": a size for people, not for arithmetic. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** What the operating system says about the camera, without asking for anything. */
export type CameraPermission = {
  status: 'undetermined' | 'granted' | 'denied';
  /** False when the system will not show its permission prompt again. */
  canAskAgain: boolean;
};

export type CameraPermissionState = 'NOT_REQUESTED' | 'ALLOWED' | 'DENIED' | 'DENIED_PERMANENTLY';

export function cameraPermissionState(permission: CameraPermission): CameraPermissionState {
  if (permission.status === 'granted') return 'ALLOWED';
  if (permission.status === 'undetermined') return 'NOT_REQUESTED';
  return permission.canAskAgain ? 'DENIED' : 'DENIED_PERMANENTLY';
}

/** "Version 1.0.0 (build 3)", from the app's own configuration. */
export function describeVersion(version: string | null | undefined, build?: string | number | null): string {
  const shown = version && version.trim().length > 0 ? version.trim() : 'unknown';
  const hasBuild = build !== null && build !== undefined && String(build).trim().length > 0;
  return hasBuild ? `Version ${shown} (build ${String(build).trim()})` : `Version ${shown}`;
}
