/**
 * Errors raised by the local database layer. `code` matches the error model in
 * docs/api.md so callers can branch on it without parsing messages. The
 * original failure, when there is one, is kept as `cause`.
 *
 * Fields are declared and assigned explicitly (no constructor parameter
 * properties) so this file also runs under Node's type stripping in the
 * database tests.
 */
export class DatabaseError extends Error {
  readonly code = 'DATABASE_ERROR';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DatabaseError';
  }
}

/** A migration's SQL failed. Its transaction was rolled back and the schema version is unchanged. */
export class MigrationFailedError extends DatabaseError {
  readonly version: number;

  constructor(version: number, cause: unknown) {
    super(`Migration ${version} failed and was rolled back.`, { cause });
    this.name = 'MigrationFailedError';
    this.version = version;
  }
}

/**
 * The database was written by a newer version of the app. It is refused rather
 * than opened, because running against an unknown schema could corrupt data.
 */
export class UnsupportedSchemaVersionError extends DatabaseError {
  readonly foundVersion: number;
  readonly supportedVersion: number;

  constructor(foundVersion: number, supportedVersion: number) {
    super(
      `Database schema version ${foundVersion} is newer than this app supports (${supportedVersion}).`
    );
    this.name = 'UnsupportedSchemaVersionError';
    this.foundVersion = foundVersion;
    this.supportedVersion = supportedVersion;
  }
}
