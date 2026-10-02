/**
 * Timestamps of the app's start, one per milestone, for finding the step a
 * slow or stuck start is waiting on: running the JavaScript, mounting the
 * root layout, opening the database, running its migrations, building the
 * providers, mounting the first screen, applying the theme, and hiding the
 * splash screen.
 *
 * The time Metro takes to build and send the bundle comes before any of this
 * and cannot be measured from here.
 *
 * Marks cost one clock read each and are kept in memory only. In development
 * each one is also written to the console, so a start that never reaches the
 * app's own screens can still be followed in the Metro terminal. Nothing is
 * stored or sent anywhere, and nothing about students is ever in a mark.
 */
export type StartupMark = {
  name: string;
  /** Milliseconds since this module was first evaluated, which is when the bundle started running. */
  at: number;
  /** For a mark that measures a step: how long the step took. */
  duration?: number;
  /** How many times this milestone was reached. More than 1 for a step means it ran again. */
  count: number;
};

declare const __DEV__: boolean | undefined;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const origin = now();
const marks: StartupMark[] = [];
const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__ === true;

/**
 * Records that a milestone was reached now. The first time fixes its time;
 * a later call only counts, which is how a step that runs again (a database
 * opened twice) shows up.
 */
export function markStartup(name: string, duration?: number): void {
  const existing = marks.find((mark) => mark.name === name);
  if (existing) {
    existing.count++;
    if (isDevelopment) console.info(`[startup] ${name} again (${existing.count} times)`);
    return;
  }
  const mark: StartupMark = {
    name,
    at: Math.round(now() - origin),
    duration: duration === undefined ? undefined : Math.round(duration),
    count: 1,
  };
  marks.push(mark);
  if (isDevelopment) {
    console.info(
      `[startup] ${String(mark.at).padStart(6)} ms  ${name}${mark.duration === undefined ? '' : ` (took ${mark.duration} ms)`}`
    );
  }
}

export function getStartupMarks(): readonly StartupMark[] {
  return marks;
}

export function hasStartupMark(name: string): boolean {
  return marks.some((mark) => mark.name === name);
}

/** The milestone reached last: where a start that has stopped is standing. */
export function lastStartupMark(): StartupMark | null {
  return marks[marks.length - 1] ?? null;
}

/** Runs a task and returns its result with the milliseconds it took. */
export async function timed<T>(task: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = now();
  const value = await task();
  return { value, ms: now() - started };
}
