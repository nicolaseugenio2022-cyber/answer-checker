# Answer Checker — Offline Answer Sheet Scanner

Last reviewed: 2026-10-02

"Answer Checker" is the working name, taken from the repository folder. The final product name is an open decision.

## Overview

Answer Checker is a mobile application that checks shaded multiple-choice answer sheets with the phone camera. A Teacher creates an exam and its answer key, scans each student's standardized answer sheet, reviews the detected answers, and gets a score that is saved on the device. Recognition uses on-device Optical Mark Recognition (OMR).

The app is **offline-only**. Everything runs on the phone and is stored in a local SQLite database on the Teacher's device. There is no backend, no cloud database, no synchronization, and no account.

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
- Keep every function working with no internet, always.
- Make uncertain detections visible so the Teacher, not the algorithm, has the final say.
- Keep all data on the Teacher's device.
- Let the Teacher permanently remove data they no longer want.

## Core Features

### Implemented

Foundation only. No Teacher-facing feature works yet.

- Expo + TypeScript project with Expo Router
- Design system: NativeWind, React Native Reusables `Button` and `Text`, neutral theme with pink primary, light and dark tokens
- Navigation shell: a floating glass tab bar with five tabs (Home, Exams, Scan, Students, Results) and a raised circular indicator that slides to the current tab; Classes, Subjects, and Settings open from Home and Settings
- Home dashboard: greeting, offline note, quick actions, and empty-state Activity rows. It shows no statistics or records and states that the features are not built
- Placeholder screens for Scan answer sheet, Results, Exams & answer keys, Classes, Students, and Subjects. Each says what it will do and that it is not built; none has controls or data
- Settings screen with a working light/dark theme switch, links to Classes and Subjects, and a note that data is stored only on the device
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

### Optional/Future

- QR code on the sheet to identify the exam/template automatically
- Machine-readable student identifier on the sheet
- Batch scanning
- Result export
- Manual backup/export to a local file, and restore from one. This would not make the app cloud-dependent. Not designed or approved yet

## Technology Stack

| Area | Technology | Status |
| --- | --- | --- |
| Framework | Expo 57, React Native 0.86, React 19.2, TypeScript 6.0 | Implemented |
| Navigation | Expo Router 57 `Tabs` with a custom bottom tab bar, typed routes | Implemented |
| Icons | `lucide-react-native` with `react-native-svg`, through the Reusables `Icon` component | Implemented |
| Blur | `expo-blur` 57, tab bar only; live blur on iOS and web, opaque fallback on Android | Implemented |
| UI components | React Native Reusables (`Button`, `Text`, `Icon`, `Badge`), native `Item` list rows modeled on shadcn Item, `@rn-primitives/portal`, `@rn-primitives/slot` | Implemented |
| Styling | NativeWind 4.2, Tailwind CSS 3.4, `tailwindcss-animate`, `class-variance-authority`, `clsx`, `tailwind-merge` | Implemented |
| Local SQLite database | `expo-sqlite` 57. Required; the only application database | Implemented (bootstrap and migration runner; no tables) |
| Linting | ESLint 9 with `eslint-config-expo` | Implemented |
| Camera | Expo Camera or compatible React Native camera library | Planned, not installed |
| OMR | OpenCV, on-device | Planned, not installed |
| Query/ORM layer | Drizzle ORM | Optional, not decided, not installed |
| Backend, cloud database, synchronization, authentication | None | Excluded. Not installed |

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

The theme is a neutral base with pink as the identity color: deeper pink in light mode, brighter pink in dark mode. Dark mode is a plum-tinted near-black with stepped surfaces and visible borders. A soft pink backdrop glow sits behind each screen, and selected surfaces (tab bar, Home header control, quick actions, Activity panel) are translucent glass with a thin edge. Light and dark tokens are defined in `src/global.css`; the rules are in [source-of-truth.md](./source-of-truth.md#ui-truth).

## Architecture Overview

```text
React Native + Expo + TypeScript
            |
 Mobile presentation layer
            |
  Application use cases
            |
      Domain rules
            |
  Local infrastructure
(SQLite, local files, camera, on-device OMR)
            |
SQLite on the Teacher's device
```

Everything runs inside the mobile application. Nothing leaves the device. Diagrams are in [diagrams.md](./diagrams.md). Contracts are in [api.md](./api.md).

### Code structure

The code follows a feature-oriented clean architecture. The authoritative rules are in [source-of-truth.md](./source-of-truth.md#clean-architecture-layers).

```text
src/
  app/                                Expo Router routes and composition root
    _layout.tsx                       Theme, database provider, navigation shell, portal host
    <route>.tsx                       One-line re-export of a feature screen
  core/
    infrastructure/database/          SQLite provider and migration runner
    presentation/components/          Shared screen body and planned-feature placeholder
    presentation/components/ui/       React Native Reusables components
    presentation/navigation/          Bottom-tab shell and the destination list
    presentation/lib/                 Theme tokens and class-name helper
  features/
    <feature>/presentation/           One screen per destination
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
```

## Offline-Only Behavior

The app never needs the internet and never uses it. Scanning, answer detection, answer checking, scoring, viewing records, creating exams, using answer keys, and deleting records all run on the phone.

What this means for the Teacher:

- The app works the same with or without a connection, including in airplane mode.
- Data stays on the current device. Nothing is uploaded.
- Different phones do not share data. An exam created on one phone does not appear on another.
- Closing or restarting the app keeps the data.
- Clearing the app's data or uninstalling the app generally removes its database.
- Losing or replacing the phone may mean losing the data.
- Automatic cloud backup and cross-device access are not included.

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

- The only database is the local SQLite database (`expo-sqlite`), stored on the Teacher's device in the app's private storage.
- Each installation has its own independent database.
- Scan images, if kept, are local files in the app's storage.
- Proposed data areas: `teachers`, `students`, `classes`, `subjects`, `exams`, `exam_questions`, `answer_keys`, `exam_results`, `student_answers`, `scan_records`.
- IDs are UUIDs (or equivalent) generated on the device.
- The database file `answer-checker.db` is opened at app start with WAL journaling and foreign keys enabled, then migrated. The migration list is empty, so the database has no tables.
- The database is not encrypted by the app.
- No schema exists yet. The model in [diagrams.md](./diagrams.md#proposed-domain-model) is proposed.

## Permanent Deletion

"Delete Permanently" is permanent physical deletion: the record is removed from SQLite. It is not a soft delete and not an archive, and it leaves no tombstone behind.

Example confirmation:

```text
Delete this result permanently?

This will permanently remove the result and its
associated answer data.

This action cannot be undone.

[Cancel] [Delete Permanently]
```

Deleting a result also removes its student answers, scan metadata, and local scan image. Cascades are used only where documented in [api.md](./api.md#permanent-deletion-contract). Because there is no backup, a deleted record cannot be recovered.

## Excluded: Cloud and Synchronization

Supabase, MongoDB, PostgreSQL, cloud synchronization, a backend API, authentication, online accounts, and cross-device synchronization are not part of the approved architecture and are not planned for the initial product. See [source-of-truth.md](./source-of-truth.md#excluded-cloud-and-synchronization).

They may be reconsidered only after an explicit requirement change, recorded as a new architecture decision.

## Security and Privacy Considerations

- Student information is stored on the Teacher's device and nowhere else.
- Scanned answer sheets may contain identifiable information.
- Scan images should not be retained longer than necessary. Whether images are kept at all after scoring is an open decision.
- Permanent deletion removes associated stored images.
- The local SQLite database is not encrypted by the app. It is protected by the operating system's app sandbox and the device lock.
- There is no authentication: anyone who can open the phone and the app can see the data.
- The app holds no API keys, tokens, or credentials, because it connects to nothing.

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
- Any internet connection or network feature
- A backend server or API of any kind
- A cloud database (Supabase, MongoDB, PostgreSQL, or otherwise)
- Cloud synchronization, automatic cloud backup, and cross-device access
- Authentication, online accounts, and Teacher or student login
- Arbitrary answer-sheet recognition
- Multiple-role RBAC

## Current Implementation Status

Inspected 2026-10-02.

| Item | Finding |
| --- | --- |
| Expo project | Implemented. Name "Answer Checker", slug `answer-checker`, scheme `answerchecker`. Managed/CNG: no `android/` or `ios/` folders |
| Navigation | Implemented. Bottom tabs: `/`, `/exams`, `/scan`, `/students`, `/results`. Secondary screens with a back button and the tab bar still visible: `/classes`, `/subjects`, `/settings`. No drawer or sidebar |
| Design system | Implemented. NativeWind, Reusables `Button`, `Text`, `Icon`; rebuilt light and dark tokens; selective glass surfaces. Live blur is off on Android |
| Home dashboard | Implemented. Navigation shortcuts and static empty states only; it reads no data |
| Destination screens | Placeholders only, except Settings, which has a working theme switch |
| SQLite bootstrap | Implemented. Opens database, sets pragmas, runs migrations. Not yet exercised on a device or emulator |
| Database tables | None. Migration list is empty |
| Students, classes, subjects, exams, answer keys | Not implemented |
| Camera, OMR, review, scoring, results | Not implemented. Expo Camera and OpenCV not installed |
| Permanent deletion | Not implemented (nothing to delete yet) |
| Domain repositories | None |
| Backend | None. No server code, no network requests |
| Supabase, MongoDB | Not installed. Excluded from the architecture |
| Authentication, synchronization | None. Excluded from the architecture |
| Automated tests | None. No test runner installed |
| App icons and splash | Still the Expo template artwork |
| Native identifiers | `android.package` and `ios.bundleIdentifier` not set |

Verification performed: `expo-doctor`, `tsc --noEmit`, ESLint, React Native Reusables `doctor`, and JavaScript bundle exports for web and Android all pass. The tab shell and screens were checked in a browser at 360, 390, and 440 by 956 points and in landscape, in light and dark themes: every tab, the selected-tab state, the Settings button, back from secondary screens, direct links, and content clearing the tab bar. The migration runner logic was checked against Node's built-in SQLite. Nothing has been run on an Android or iOS device or emulator, so safe-area insets, the Android back button, pressed states, and SQLite startup are untested on real hardware.

Web is a preview of the phone app only. In a browser the app is held to a 480-point column; there is no desktop or tablet layout.

On web, the database provider is a pass-through: web is a build-verification target, not a product platform.

## Planned Features

1. SQLite schema and repositories for students, classes, subjects, exams, and answer keys
2. Standardized answer sheet template
3. Camera capture and on-device OMR pipeline
4. Detection review screen
5. Scoring and result storage
6. Results history
7. Permanent deletion with dependent cleanup

## Future Features

- QR code exam/template identification
- Batch scanning
- Result export
- Manual backup/export and restore using local files
