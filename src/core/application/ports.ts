/** Source of the current time, injected so use cases stay deterministic in tests. */
export type Clock = {
  /** The current instant as a UTC ISO-8601 string, as Date.prototype.toISOString() produces. */
  now(): string;
};

/** Source of new record ids (UUIDs on the device), injected for the same reason. */
export type IdGenerator = {
  newId(): string;
};
