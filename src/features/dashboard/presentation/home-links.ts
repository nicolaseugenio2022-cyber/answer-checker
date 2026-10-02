/**
 * Where each Home control leads. One table, so the routes and the one-time
 * intents can be checked without rendering the screen. A route is a tab or a
 * secondary screen; an intent tells that screen what to open when it appears
 * (see core/presentation/navigation/screen-intent.ts).
 */
export const HOME_LINKS = {
  scan: { route: '/scan', intent: null },
  createAnswerKey: { route: '/keys', intent: { type: 'create' } },
  addStudent: { route: '/students', intent: { type: 'add' } },
  viewResults: { route: '/results', intent: null },
  students: { route: '/students', intent: null },
  classes: { route: '/classes', intent: null },
  answerKeys: { route: '/keys', intent: null },
  results: { route: '/results', intent: null },
  subjects: { route: '/subjects', intent: null },
  settings: { route: '/settings', intent: null },
} as const;

/** The intent that opens one result from Home. */
export const openResultIntent = (resultId: string) => ({ type: 'open', resultId }) as const;

/** The intent that opens one answer key from Home. */
export const viewAnswerKeyIntent = (answerKeyId: string) => ({ type: 'view', answerKeyId }) as const;
