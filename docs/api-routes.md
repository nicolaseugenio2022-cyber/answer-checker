# API Routes

Last reviewed: 2026-10-02

This document covers network-facing routes. The application is offline-only, so there are none.

## Current State and Decision

- There is no backend.
- There are no network API routes, implemented or planned.
- No API is required for scanning, answer detection, scoring, saving, viewing, or deleting. All of it runs on the device against the local SQLite database stored on the Teacher's device.
- The application makes no network requests.

"Routes" under `src/app` are Expo Router screens inside the app. They are not network routes.

Mobile application contracts (OMR, camera, repositories, scoring, permanent deletion) are in [api.md](./api.md).

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
