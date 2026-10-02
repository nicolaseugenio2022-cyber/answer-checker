# API Routes

Last reviewed: 2026-10-02

This document covers network-facing routes. The application is offline-only, so there are none. The filename is kept because other documents link to it.

## Current State and Decision

- There is no backend.
- There are no HTTP, REST, GraphQL, WebSocket, or other network routes, implemented or planned.
- No API is required for scanning, answer detection, scoring, saving, viewing, importing, or deleting. All of it runs on the device against the local SQLite database stored on the Teacher's device.
- The application makes no network requests. A roster CSV is read from a file on the device, the answer sheet PDF is made on the device, and a photographed sheet is read on the device.

"Routes" under `src/app` are Expo Router screens inside the app. They are not network routes.

## What Exists Instead: Local Use Cases

The app's operations are in-process TypeScript use cases that call local SQLite repositories. They are documented in [api.md](./api.md). The implemented ones are listed here only so nobody looks for an endpoint.

| Area | Use cases (in-process, on the device) | Status |
| --- | --- | --- |
| Subjects | `listSubjects`, `addSubject`, `renameSubject`, `deleteSubject` | Implemented and verified on a physical Android phone |
| Classes | `listClasses`, `addClass`, `renameClass`, `deleteClass` | Implemented and verified on a physical Android phone |
| Subject-to-Class assignments | `listSubjectsForClass`, `listClassesForSubject`, `isSubjectAssignedToClass`, `assignSubjectToClass`, `removeSubjectFromClass`, `replaceSubjectsForClass`, `countSubjectsByClass`, `countClassesBySubject` | Implemented |
| Students | `listStudents`, `getStudent`, `addStudent`, `updateStudent`, `deleteStudent`, `pickRoster`, `prepareRoster`, `importStudents` | Implemented and verified on a physical Android phone |
| Answer Keys | `listAnswerKeys`, `getAnswerKey`, `createAnswerKey`, `updateAnswerKey`, `draftDuplicate`, `duplicateAnswerKey`, `hasResults`, `countResults`, `deleteAnswerKey` | Implemented and verified on a physical Android phone |
| Scan | `listOptions`, `classIdsOfSubject`, `validateSelection`, `previousAttempts`, `readCapture`, `discardCapture`, `discardDraft`, `saveResult`, `cleanUpScanFiles`, `sharePrintableSheet` | Implemented and verified on a physical Android phone |
| Results | None yet | Planned |

## App Screens

Expo Router paths inside the app. They are not network routes.

| Path | Screen | Reached from |
| --- | --- | --- |
| `/` | Home | Bottom tab 1 |
| `/keys` | Answer Keys | Bottom tab 2 (label `Keys`) |
| `/scan` | Scan | Bottom tab 3 |
| `/students` | Students | Bottom tab 4 |
| `/results` | Placeholder | Bottom tab 5 |
| `/classes` | Classes | Home → More → Classes |
| `/subjects` | Subjects | Home → More → Subjects, and the "Open Subjects" button on Answer Keys while no Subject exists |
| `/settings` | Settings | Home → More → Settings |

There is no `/exams` path.

## Not Planned for This Version

None of the following exist, and none are planned for the initial product:

- Supabase routes or any Supabase client access
- MongoDB or PostgreSQL access
- Authentication endpoints
- Storage or file-upload endpoints
- Synchronization endpoints
- A custom backend API of any kind
- Any route for scanning or scoring, such as `POST /scan` or `POST /score`

## Future Reconsideration

Network routes may be considered only after an explicit requirement change, recorded as a new architecture decision in [source-of-truth.md](./source-of-truth.md#excluded-cloud-and-synchronization). Until then, do not design, add, or document network routes here.
