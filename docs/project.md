# Answer Checker — Offline Answer Sheet Scanner

Last reviewed: 2026-10-02

"Answer Checker" is the working name, taken from the repository folder. The final product name is an open decision.

## Overview

Answer Checker is a mobile application that checks shaded multiple-choice answer sheets with the phone camera. A Teacher creates an exam and its answer key, scans each student's standardized answer sheet, reviews the detected answers, and gets a score that is saved on the device. Recognition uses on-device Optical Mark Recognition (OMR). The app is offline-first: scanning, scoring, and record keeping work without internet.

## Problem Statement

Checking multiple-choice exams by hand is slow and error-prone. Dedicated OMR scanners and machine-readable forms are expensive, and cloud-based scanning apps fail in classrooms with weak or no connectivity. Teachers need a tool that turns the phone they already own into a reliable answer sheet checker that works anywhere.

## Target User

A classroom Teacher who administers multiple-choice exams, often on a low or mid-range Android phone, often without reliable internet.

## Role Model

```text
Role: Teacher
```

There is currently only one role. Students, classes, and subjects are records the Teacher manages; none of them are user accounts. Do not introduce RBAC unless requirements change later.

## Objectives

- Check a shaded answer sheet in seconds using only the phone.
- Keep every core function available offline.
- Make uncertain detections visible so the Teacher, not the algorithm, has the final say.
- Keep student data on the device by default.
- Let the Teacher permanently remove data they no longer want.

## Core Features

### Implemented

Foundation only. No Teacher-facing feature works yet.

- Expo + TypeScript project with Expo Router
- Design system: NativeWind, React Native Reusables `Button` and `Text`, neutral theme with pink primary, light and dark tokens
- Home screen that describes the planned workflow and states that it is not built
- On-device SQLite database opened at startup, with a versioned migration runner and no tables

See [Current Implementation Status](#current-implementation-status).

### Planned

- Manage students, classes, and subjects
- Create exams and answer keys
- Scan standardized answer sheets with the camera
- On-device OMR with `SELECTED`, `BLANK`, `MULTIPLE`, and `UNCERTAIN` states
- Review and correct detected answers
- Calculate scores against the local answer key
- Save results locally and view previous results
- Permanently delete records, including dependent data and scan images
- Printable standardized answer sheet with four alignment markers
- Online synchronization through a persistent outbox to Supabase/PostgreSQL

### Optional/Future

- QR code on the sheet to identify the exam/template automatically
- Machine-readable student identifier on the sheet
- Teacher sign-in
- Cross-device access and web reporting
- Batch scanning
- Result export

## Technology Stack

| Area | Technology | Status |
| --- | --- | --- |
| Framework | Expo 57, React Native 0.86, React 19.2, TypeScript 6.0 | Implemented |
| Navigation | Expo Router 57, typed routes | Implemented |
| UI components | React Native Reusables (`Button`, `Text`), `@rn-primitives/portal`, `@rn-primitives/slot` | Implemented |
| Styling | NativeWind 4.2, Tailwind CSS 3.4, `tailwindcss-animate`, `class-variance-authority`, `clsx`, `tailwind-merge` | Implemented |
| Local database | SQLite via `expo-sqlite` 57 | Implemented (bootstrap and migration runner; no tables) |
| Linting | ESLint 9 with `eslint-config-expo` | Implemented |
| Camera | Expo Camera or compatible React Native camera library | Planned, not installed |
| OMR | OpenCV, on-device | Planned, not installed |
| Query/ORM layer | Drizzle ORM | Optional, not decided, not installed |
| Online synchronization | Supabase: PostgreSQL, Auth, Storage | Planned, not installed |

Versions are those in `package.json` on the review date.

This is not a Next.js application and not a browser-first React application.

## UI Design System

The design language is **shadcn New York style**, implemented with **React Native Reusables** and **NativeWind**. Browser-only `shadcn/ui` components are not used, because they depend on the DOM.

New York style in this app means:

- Compact controls
- Clean typography
- Strong hierarchy
- Subtle borders
- Restrained border radius
- Dense but readable layouts
- Minimal visual noise
- Consistent spacing
- Accessible contrast
- Mobile-friendly touch targets

Compact does not mean small tap areas: visually dense controls still need touch targets that meet platform accessibility guidance. Primary actions use the 44-point `lg` button size.

The theme is neutral zinc with a restrained pink primary accent. Pink marks primary actions, focus rings, and shaded bubbles; surfaces, text, and borders stay neutral. Light and dark tokens are defined in `src/global.css`.

## Architecture Overview

```text
React Native + Expo + TypeScript
            |
shadcn New York-style mobile UI
React Native Reusables + NativeWind
            |
          Camera
            |
   On-device OpenCV OMR
            |
    Application logic
            |
          SQLite
            |
   Sync queue (planned)
            |
Supabase / PostgreSQL (planned)
```

Everything above "Sync queue (planned)" runs on the device and needs no network. Diagrams are in [diagrams.md](./diagrams.md). Contracts are in [api.md](./api.md).

### Code structure

The code follows a feature-oriented clean architecture. The authoritative rules are in [source-of-truth.md](./source-of-truth.md#clean-architecture-layers).

```text
src/
  app/                                Expo Router routes and composition root
    _layout.tsx                       Theme, database provider, portal host
    index.tsx                         Re-exports the home screen
  core/
    infrastructure/database/          SQLite provider and migration runner
    presentation/components/ui/       React Native Reusables components
    presentation/lib/                 Theme tokens and class-name helper
  features/
    dashboard/presentation/           Home screen
  global.css                          Tailwind layers and theme tokens
```

Domain and application layers are added per feature when the first business rule or use case is implemented.

## Main User Flow

```text
Teacher opens app
  -> Home
  -> Select exam
  -> Scan answer sheet
  -> Camera detects sheet
  -> On-device OMR
  -> Review detected answers
  -> Resolve BLANK / MULTIPLE / UNCERTAIN if needed
  -> Confirm
  -> Calculate score
  -> Save to SQLite
  -> View result
  -> Optional cloud synchronization later
```

## Offline-First Behavior

Internet is not required for scanning, answer detection, answer checking, scoring, viewing local records, creating exams, using local answer keys, or deleting local records.

- SQLite is read and written first, always.
- The network is used only by optional synchronization, in the background, after local work is committed.
- A sync failure never blocks the Teacher.

## OMR Overview

The app scans its own standardized answer sheet. Arbitrary third-party sheets are not supported.

Pipeline:

```text
Camera capture
  -> Detect answer sheet
  -> Detect alignment markers
  -> Perspective correction
  -> Grayscale
  -> Thresholding
  -> Locate bubble regions
  -> Measure fill percentage
  -> Determine selected answers
  -> Validate detection
  -> Review
  -> Score
```

Conceptual example of one question:

```text
Question 1
A = 10% filled
B = 82% filled
C = 11% filled
D = 9% filled
Detected answer: B
```

Each question resolves to `SELECTED`, `BLANK`, `MULTIPLE`, or `UNCERTAIN`. The numbers above are illustrative only. No production thresholds exist; they must be calibrated against real sheets, different pencils and pens, lighting, cameras, and erasures.

The sheet may contain four alignment markers, question numbers, A/B/C/D bubbles, a student identifier, an exam identifier, and an optional QR code (Planned).

## Data Storage

- Primary store: SQLite on the device (`expo-sqlite`).
- Proposed data areas: `teachers`, `students`, `classes`, `subjects`, `exams`, `exam_questions`, `answer_keys`, `exam_results`, `student_answers`, `scan_records`, `sync_queue`.
- IDs are UUIDs (or equivalent) generated on the device so records can be created offline and keep the same identity in the cloud.
- The database file `answer-checker.db` is opened at app start with WAL journaling and foreign keys enabled, then migrated. The migration list is empty, so the database has no tables.
- No schema exists yet. The model in [diagrams.md](./diagrams.md#proposed-domain-model) is proposed.

## Permanent Deletion

"Delete Permanently" physically removes the record from SQLite. It is not a soft delete and not an archive.

Example confirmation:

```text
Delete this result permanently?

This will permanently remove the result and its
associated answer data.

This action cannot be undone.

[Cancel] [Delete Permanently]
```

Deleting a result also removes its student answers, scan metadata, and local scan image. Cascades are used only where documented in [api.md](./api.md#permanent-deletion-contract).

## Optional Cloud Synchronization

Online synchronization is a planned part of the target architecture and is not implemented. Supabase is not installed or configured. When built, it supports backup, synchronization, cross-device access, centralized records, and later web reporting. It stays secondary: it is never required for core scanning, and the app must work fully with it absent or disabled.

Changes made offline are stored in a persistent sync queue and sent when connectivity returns. A record deleted offline must never reappear after reconnecting: the local record is removed immediately, a minimal remote `DELETE` instruction stays in the queue until the cloud confirms it, and pulls never re-insert a record with a pending delete.

## Security and Privacy Considerations

- Student information is stored locally on the Teacher's device.
- Scanned answer sheets may contain identifiable information.
- Scan images should not be retained longer than necessary. Whether images are kept at all after scoring is an open decision.
- Permanent deletion removes associated stored images.
- Credentials and tokens, if any, go in secure device storage.
- Secret keys are never placed in source code. The mobile client holds only client-safe public configuration.
- No encryption or authentication is implemented today.

## Constraints

- Must run acceptably on low and mid-range Android devices: camera responsiveness, image preprocessing time, and memory use matter.
- OpenCV on-device requires native code, so the app will need an Expo development build rather than Expo Go.
- Large sheets (many questions) and batch scanning increase processing time and memory pressure.
- Temporary images must be cleaned up; full-resolution images should not be stored after processing unless required.
- SQLite queries must stay fast as results accumulate (indexes on foreign keys and common filters).
- Detection accuracy depends on print quality, lighting, and how bubbles are shaded.

## Non-Goals

- Essay grading
- Handwriting recognition
- LLM-based answer recognition
- Mandatory internet connection
- Arbitrary answer-sheet recognition
- Multiple-role RBAC at this stage
- Student login
- A mandatory backend server (FastAPI, Python, or otherwise)
- Uploading every answer sheet before checking

## Current Implementation Status

Inspected 2026-10-02.

| Item | Finding |
| --- | --- |
| Expo project | Implemented. Name "Answer Checker", slug `answer-checker`, scheme `answerchecker`. Managed/CNG: no `android/` or `ios/` folders |
| Navigation | Implemented. Expo Router, one route (`/`) |
| Design system | Implemented. NativeWind, Reusables `Button` and `Text`, pink-on-neutral light and dark theme |
| Home screen | Implemented. Informational only |
| SQLite bootstrap | Implemented. Opens database, sets pragmas, runs migrations. Not yet exercised on a device or emulator |
| Database tables | None. Migration list is empty |
| Students, classes, subjects, exams, answer keys | Not implemented |
| Camera, OMR, review, scoring, results | Not implemented. Expo Camera and OpenCV not installed |
| Permanent deletion | Not implemented (nothing to delete yet) |
| Authentication | Not implemented |
| Synchronization | Not implemented. Supabase not installed |
| Automated tests | None. No test runner installed |
| App icons and splash | Still the Expo template artwork |
| Native identifiers | `android.package` and `ios.bundleIdentifier` not set |

Verification performed: `expo-doctor`, `tsc --noEmit`, ESLint, React Native Reusables `doctor`, and JavaScript bundle exports for web and Android all pass. The home screen was checked visually in a browser in light and dark themes. The migration runner logic was checked against Node's built-in SQLite. Nothing has been run on an Android or iOS device or emulator.

On web, the database provider is a pass-through: web is a build-verification target, not a product platform.

## Planned Features

1. SQLite schema and repositories for students, classes, subjects, exams, and answer keys
2. Standardized answer sheet template
3. Camera capture and on-device OMR pipeline
4. Detection review screen
5. Scoring and result storage
6. Results history
7. Permanent deletion with dependent cleanup
8. Online synchronization: outbox table written in the same transaction as each domain write, then a Supabase sync processor

## Future Features

- QR code exam/template identification
- Teacher authentication
- Cross-device access
- Web reporting
- Batch scanning
- Result export
