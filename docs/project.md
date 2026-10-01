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

None. The repository contains no application code. See [Current Implementation Status](#current-implementation-status).

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
- Teacher sign-in
- Cloud backup and synchronization (Supabase)
- Cross-device access and web reporting
- Batch scanning
- Result export

## Technology Stack

All entries are targets. Nothing is installed yet.

| Area | Technology | Status |
| --- | --- | --- |
| Framework | React Native, Expo, TypeScript | Planned |
| UI components | React Native Reusables | Planned |
| Styling | NativeWind | Planned |
| Camera | Expo Camera or compatible React Native camera library | Planned |
| OMR | OpenCV, on-device | Planned |
| Local database | SQLite via `expo-sqlite` | Planned |
| Query/ORM layer | Drizzle ORM | Optional, not decided |
| Cloud | Supabase: PostgreSQL, Auth, Storage | Optional/Future |

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

Compact does not mean small tap areas: visually dense controls still need touch targets that meet platform accessibility guidance.

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
   Optional sync queue
            |
Optional Supabase / PostgreSQL
```

Everything above "Optional sync queue" runs on the device and needs no network. Diagrams are in [diagrams.md](./diagrams.md). Contracts are in [api.md](./api.md).

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

Cloud is optional and secondary. If added, it supports backup, synchronization, cross-device access, centralized records, and later web reporting. It is never required for core scanning.

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
| Git repository | Initialized, no commits |
| `docs/` | Existed, empty before these documents |
| `package.json` | Absent |
| Expo configuration (`app.json` / `app.config.*`) | Absent |
| TypeScript configuration | Absent |
| Source code | Absent |
| Database schema / migrations | Absent |
| Environment examples | Absent |
| Tests | Absent |

**Nothing is implemented.** The repository is a blank slate, so there is no conflicting implementation. The only discrepancy is that the entire target architecture is unbuilt.

## Planned Features

1. Expo + TypeScript project scaffold with NativeWind and React Native Reusables
2. SQLite schema and repositories for students, classes, subjects, exams, and answer keys
3. Standardized answer sheet template
4. Camera capture and on-device OMR pipeline
5. Detection review screen
6. Scoring and result storage
7. Results history
8. Permanent deletion with dependent cleanup

## Future Features

- QR code exam/template identification
- Teacher authentication
- Supabase backup and synchronization with outbox queue
- Cross-device access
- Web reporting
- Batch scanning
- Result export
