# Application API

Last reviewed: 2026-10-02

This document describes the application's internal contracts: the boundaries between UI, application services, OMR, camera, and local storage. The application is offline-only, so every contract here is an in-process contract on the device. There are no network routes; see [api-routes.md](./api-routes.md).

> **Status: every contract in this document is a Proposed Contract, except the [Database Bootstrap Contract](#database-bootstrap-contract), which is implemented.** No application service, repository, OMR, camera, scoring, or deletion code exists. Function names, DTO shapes, and error codes are conceptual and may change when implemented. Update this document when they do.

## API Philosophy

- "API" here does not mean HTTP. The app is offline-only, so all of its contracts are in-process TypeScript boundaries.
- The UI calls application services. Services call repositories, the OMR module, and the camera. The UI does not talk to SQLite or OpenCV directly.
- Every operation completes against local resources only: the local SQLite database, local files, the camera, and on-device OMR. No contract may use the network.
- IDs are device-generated UUIDs (or equivalent).
- Operations return typed results or typed errors from the [Error Model](#error-model); they do not fail silently.
- There is one role, Teacher. No contract takes a role or permission argument.
- Contracts follow the clean architecture layers in [source-of-truth.md](./source-of-truth.md#clean-architecture-layers): use cases and ports live in a feature's application layer, their SQLite, camera, and OpenCV implementations in its infrastructure layer.

## Application Services

Proposed Contracts.

| Area | Operations |
| --- | --- |
| Students | `createStudent()`, `updateStudent()`, `deleteStudent()` |
| Classes | `createClass()`, `updateClass()`, `deleteClass()` |
| Subjects | `createSubject()`, `updateSubject()`, `deleteSubject()` |
| Exams | `createExam()`, `updateExam()`, `deleteExam()`, `saveAnswerKey()` |
| Scanning | `captureAnswerSheet()`, `processAnswerSheet()`, `reviewDetection()` |
| Results | `calculateScore()`, `saveResult()`, `deleteResult()` |

All `delete*()` operations are permanent deletions as defined in the [Permanent Deletion Contract](#permanent-deletion-contract).

## OMR Contract

Proposed Contract.

**Input (conceptual):**

- A captured image of a standardized answer sheet.
- The sheet template for the selected exam: number of questions, choices per question, and bubble layout relative to the four alignment markers.

**Processing:** detect sheet, detect alignment markers, perspective correction, grayscale, thresholding, locate bubble regions, measure fill percentage, determine selected answers, validate. All on-device and deterministic: the same image and template produce the same output.

**Output (conceptual):**

```json
{
  "status": "success",
  "questions": [
    {
      "questionNumber": 1,
      "state": "SELECTED",
      "selectedAnswer": "B",
      "confidence": 0.97
    },
    {
      "questionNumber": 2,
      "state": "BLANK",
      "selectedAnswer": null,
      "confidence": 0.99
    }
  ]
}
```

**States:**

| State | Meaning | Scoring before review |
| --- | --- | --- |
| `SELECTED` | Exactly one bubble is clearly filled | Compared with answer key |
| `BLANK` | No bubble is filled | Flagged; incorrect unless Teacher corrects |
| `MULTIPLE` | More than one bubble is filled | Flagged; incorrect unless Teacher corrects |
| `UNCERTAIN` | Fill levels are too ambiguous to decide | Flagged; must be resolved by Teacher |

**Rules:**

- OMR never guesses silently. Ambiguity becomes `UNCERTAIN`, not a best-effort `SELECTED`.
- If the sheet or markers cannot be found, the whole call fails with `OMR_FAILED`; it does not return partial answers.
- The number of returned questions must equal the template's question count.
- No fill thresholds are defined. Values must come from calibration against real sheets, pencils and pens, lighting, cameras, and erasures. Thresholds should be configuration, not scattered constants.
- OMR does not score. It reports marks; scoring is a separate contract.
- No AI/LLM inference and no remote call.

## Camera Contract

Proposed Contract.

- `captureAnswerSheet()` returns a reference to a locally stored image (a file URI), not image data sent anywhere.
- Camera permission is requested when the Teacher first opens the scanner. Denial produces `PERMISSION_ERROR` with guidance to enable it in system settings.
- Hardware or capture failure produces `CAMERA_ERROR`.
- Captured images are temporary. They are removed after processing unless the scan image is deliberately retained with the result (open decision).
- Capture resolution should be only as high as OMR accuracy requires, to limit memory use and processing time on low-end devices.

## Database Bootstrap Contract

Implemented in `src/core/infrastructure/database/`.

- `DatabaseProvider` wraps the app in `src/app/_layout.tsx`. On native it opens `answer-checker.db` and finishes initialization before any screen renders. On web it is a pass-through and opens no database.
- Initialization sets `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`, then runs migrations.
- `runMigrations(db, migrations)` reads `PRAGMA user_version`, applies each pending migration, and returns the resulting version.
  - Migration versions must be 1, 2, 3 and so on, in order; anything else throws before the database is touched.
  - Each migration and its version bump commit in one exclusive transaction. A failed migration rolls back completely and leaves the previous version in place.
  - A database whose version is higher than the app knows is refused rather than downgraded.
- `MIGRATIONS` in `migrations.ts` is the only place schema is defined. It is currently empty.

## Local Repository Contracts

Proposed Contracts.

- Repositories describe local SQLite operations only. One repository per data area: students, classes, subjects, exams (including questions and answer keys), and results (including student answers and scan records).
- Repositories are the only code that issues SQL. Whether they use raw `expo-sqlite` or Drizzle ORM is undecided.
- Create operations generate the UUID on the device and return the created record.
- Multi-table writes run inside a single SQLite transaction. `saveResult()` writes the result, its student answers, and its scan record atomically.
- No repository touches the network.
- Foreign keys are enforced (`PRAGMA foreign_keys = ON`), and columns used for lookup are indexed.

## Result Scoring Contract

Proposed Contract.

- **Input:** the reviewed answers for one sheet and the exam's local answer key.
- **Output:** per-question correctness, total score, and total possible points.
- Scoring uses the answers **after** Teacher review. A Teacher correction overrides the detected state.
- `SELECTED` is correct when it matches the key. `BLANK` and `MULTIPLE` score as incorrect. A result must not be finalized while any question is still `UNCERTAIN`.
- Scoring is a pure, deterministic function with no I/O, so it can be unit tested without a device.
- Scoring an exam with no answer key produces `VALIDATION_ERROR`.
- Per-question points default to one; weighted questions are an open decision.

## Permanent Deletion Contract

Proposed Contract.

Permanent physical deletion removes rows from the local SQLite database. It never sets a flag, never archives, and leaves no tombstone, soft-deleted record, or synchronization instruction.

**Example: `deleteResult(resultId)`**

1. Verify the result exists. If not, return `NOT_FOUND` (callers may treat this as already deleted).
2. Read the associated local image path, if any.
3. Begin a local transaction.
4. Delete dependent student answers.
5. Delete scan metadata.
6. Delete the result.
7. Commit the transaction.
8. Delete the associated local image file, if present.

**Transaction boundaries**

- Steps 3–7 are one atomic transaction: either every row is gone, or nothing changed.
- No other table is written. Nothing records that the deleted record ever existed.

**Dependent record deletion (proposed cascades)**

| Deleting | Also deletes |
| --- | --- |
| Result | Student answers, scan record, local scan image |
| Exam | Exam questions, answer keys, and all results of that exam with their dependents |
| Student | All results of that student with their dependents |
| Class | Open decision: block while students exist, or cascade to students and their results |
| Subject | Open decision: block while exams exist, or cascade to exams and their results |

When a delete will cascade, the confirmation dialog must say what else will be removed.

**Local file cleanup**

- Files are deleted after the transaction commits, never before, so a rolled-back delete does not lose its image.
- If file deletion fails, the database delete still stands and `FILE_ERROR` is logged. A cleanup pass removes image files that no scan record references.

**Error handling**

- A failure inside the transaction rolls everything back and returns `DATABASE_ERROR`. The record remains fully intact.
- The record disappears from the UI only after commit.

**Idempotency**

- Deleting an ID that is already gone causes no harm and changes nothing.

**No recovery**

- There is no backup and no remote copy. A committed deletion cannot be undone.

## Error Model

Proposed Contract. These categories are not implemented.

| Code | Meaning |
| --- | --- |
| `VALIDATION_ERROR` | Input is missing or invalid |
| `NOT_FOUND` | The requested record does not exist |
| `CAMERA_ERROR` | Camera unavailable or capture failed |
| `OMR_FAILED` | Sheet or alignment markers could not be detected or processed |
| `OMR_UNCERTAIN` | Processing succeeded but one or more questions need Teacher review |
| `DATABASE_ERROR` | A SQLite operation failed |
| `FILE_ERROR` | A local file could not be read, written, or deleted |
| `PERMISSION_ERROR` | A required device permission was denied |

Conceptual shape:

```json
{
  "code": "OMR_FAILED",
  "message": "Could not find all four alignment markers.",
  "recoverable": true
}
```

`OMR_UNCERTAIN` is a review signal rather than a failure: the detection result is still returned and routed to the review screen.

## Versioning

Proposed.

- **Database schema:** versioned migrations applied on app start (runner implemented, see [Database Bootstrap Contract](#database-bootstrap-contract)). Migrations are forward-only and must preserve existing local data.
- **Answer sheet template:** each template carries a version so old printed sheets remain scannable after the layout changes. The planned QR code may encode the template version.
- **This document:** any change to a contract updates this file in the same change.
