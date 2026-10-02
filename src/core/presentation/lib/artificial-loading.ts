/**
 * An artificial loading time, for looking at loading skeletons in development
 * and for tests. Local reads are too fast to see a skeleton otherwise.
 *
 * It delays nothing real: no query, no file, no navigation waits for it. It
 * only tells the loading gates to stay in their loading phases that long.
 * Outside development it cannot be turned on: `setArtificialLoading` ignores
 * every call unless it is told this is a development build, so a release
 * build always reads 0.
 */
let milliseconds = 0;
const listeners = new Set<() => void>();

/** How long loading gates currently hold their skeleton, in milliseconds. 0 is off. */
export function getArtificialLoadingMs(): number {
  return milliseconds;
}

/**
 * Turns the artificial loading time on or off. `isDevelopment` must be the
 * build's own flag (`__DEV__`); when it is false the call does nothing.
 */
export function setArtificialLoading(ms: number, isDevelopment: boolean): void {
  if (!isDevelopment) return;
  const next = Number.isFinite(ms) && ms > 0 ? Math.min(ms, 10_000) : 0;
  if (next === milliseconds) return;
  milliseconds = next;
  for (const listener of listeners) listener();
}

export function subscribeToArtificialLoading(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
