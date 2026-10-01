# API Routes

Last reviewed: 2026-10-02

This document covers **network-facing routes only**. In-process application contracts (OMR, camera, repositories, scoring, deletion, sync queue) are in [api.md](./api.md).

## Current State

**No backend and no network API exist.** The repository contains no server code, no route handlers, no Supabase configuration, and no HTTP client code. There are zero implemented routes.

The application is designed so that it does not need any. Every core function — scanning, answer detection, scoring, saving, viewing, deleting — runs on the device against SQLite.

## Routes That Must Not Exist

Normal OMR must never depend on a network route. The following are prohibited as part of the core flow:

| Route | Reason |
| --- | --- |
| `POST /scan` | Scanning and answer detection run on-device |
| `POST /score` | Scoring uses the local answer key |
| Any upload required before a sheet can be checked | Core functionality must work offline |

## Remote Access Strategy

Cloud functionality is Optional/Future. Two approaches are possible. Which one is used is an open decision; Option A is the current recommendation because it avoids building and hosting a custom server.

### Option A — Direct Supabase access (recommended)

The mobile app talks to Supabase through the official client library. There are no custom routes to design or host. Supabase exposes:

- **Auth** endpoints for Teacher sign-in and session refresh
- An auto-generated **REST API over PostgreSQL tables**, protected by row-level security so a Teacher can reach only their own rows
- **Storage** endpoints, if scan images are ever backed up

In this option the sync processor pushes each queued operation as an insert/upsert, update, or delete on the matching table, and pulls rows changed since the last successful sync.

| Interaction | Purpose | Authentication | Offline behavior | Status |
| --- | --- | --- | --- | --- |
| Supabase Auth sign-in / refresh | Identify the Teacher account | Email/password or other provider (undecided) | Not available offline; existing session and all local features keep working | Optional |
| Table upsert / update | Push queued `CREATE` and `UPDATE` | Teacher session, row-level security | Operation stays in sync queue | Optional |
| Table delete by ID | Push queued `DELETE` | Teacher session, row-level security | Operation stays in sync queue; missing row counts as success | Optional |
| Table select changed rows | Pull remote changes | Teacher session, row-level security | Skipped; local data remains authoritative | Optional |
| Storage upload / delete | Back up or remove scan images | Teacher session, storage policies | Stays queued | Optional |

Only client-safe configuration (project URL and anon key) may be in the app. The service-role key never ships in the mobile client.

### Option B — Custom sync routes

If direct table access proves insufficient (for example, to enforce ordering or deleted-record protection on the server), a thin custom API could be added, for instance as Supabase Edge Functions. These routes are conceptual.

#### `POST /sync/push`

| Field | Value |
| --- | --- |
| Method | `POST` |
| Path | `/sync/push` |
| Purpose | Send a batch of queued local operations to the cloud |
| Authentication | Teacher session token |
| Request | List of operations: `operationId`, `operationType`, `entityType`, `entityId`, `payload`, `createdAt` |
| Response | Per-operation outcome: applied, already applied, or rejected with reason |
| Errors | `401` unauthenticated, `400` invalid operation, `409` conflict, `5xx` server failure |
| Offline behavior | Not called. Operations remain in the local sync queue and are retried later |
| Status | Optional |

`operationId` is the idempotency key: resending a batch must not apply an operation twice. A `DELETE` for a missing record is reported as applied.

#### `POST /sync/pull`

| Field | Value |
| --- | --- |
| Method | `POST` |
| Path | `/sync/pull` |
| Purpose | Fetch remote changes since the device's last successful sync |
| Authentication | Teacher session token |
| Request | Sync cursor or last-synced timestamp |
| Response | Changed records, IDs deleted remotely, and a new cursor |
| Errors | `401` unauthenticated, `400` invalid cursor, `5xx` server failure |
| Offline behavior | Not called. Local data remains fully usable |
| Status | Optional |

The client must skip any pulled record that has a pending local operation, and must never re-insert a record with a pending local `DELETE`.

## Possible Future Resource Areas

If a custom API or web reporting is ever built, these areas may appear: `/auth`, `/students`, `/classes`, `/subjects`, `/exams`, `/results`, `/sync`. None are designed, and none are needed for the mobile app under Option A. They are listed only so that future work uses consistent names.

| Area | Purpose | Status |
| --- | --- | --- |
| `/auth` | Teacher sign-in | Optional |
| `/students`, `/classes`, `/subjects`, `/exams`, `/results` | Remote read access for cross-device or web reporting | Optional |
| `/sync` | Push and pull of queued operations | Optional |

## Authentication

- There is one role, Teacher. No route needs role checks; a route only needs to know which Teacher account owns the data.
- No authentication is implemented, and none is required for the initial app. The first version may be a single-device standalone app with no account at all.
- If sign-in is added: the Teacher signs in while online, the session is persisted in secure device storage, and core offline functionality stays available without re-authenticating against the network.
- Session expiry policy while offline is an open decision. It must not lock a Teacher out of local data mid-exam.
