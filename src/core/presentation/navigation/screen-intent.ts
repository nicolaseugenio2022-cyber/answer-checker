/**
 * A one-time instruction from one screen to another: "open the create form",
 * "open this result". Home leaves an intent for a tab and navigates to it;
 * the tab takes the intent when it is shown and acts on it once.
 *
 * Screens in the tab shell stay mounted, so a route parameter would stay set
 * and act again on every later visit. An intent is taken exactly once, and
 * only the newest one for a screen is kept. It lives in memory only: nothing
 * is stored, and it is gone when the app closes.
 */
export type ScreenIntents = {
  keys: { type: 'create' } | { type: 'view'; answerKeyId: string };
  students: { type: 'add' };
  results: { type: 'open'; resultId: string };
  /** Start a scan session with these three chosen. The student is never part of it. */
  scan: { type: 'continue'; subjectId: string; answerKeyId: string; classId: string };
};

export type IntentRoute = keyof ScreenIntents;

const pending: { [Route in IntentRoute]?: ScreenIntents[Route] } = {};

/** Leaves an intent for a screen, replacing one that was not taken yet. */
export function requestIntent<Route extends IntentRoute>(
  route: Route,
  intent: ScreenIntents[Route]
): void {
  pending[route] = intent;
}

/** The intent left for a screen, or null. It is removed: a second call returns null. */
export function takeIntent<Route extends IntentRoute>(route: Route): ScreenIntents[Route] | null {
  const intent = pending[route] ?? null;
  delete pending[route];
  return intent as ScreenIntents[Route] | null;
}
