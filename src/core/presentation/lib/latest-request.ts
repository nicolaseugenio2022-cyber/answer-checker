/**
 * Keeps only the answer to the newest request. A screen that reads its data
 * again each time it is shown can have two readings on their way at once; the
 * older one must not overwrite what the newer one delivered, whichever of the
 * two finishes last.
 */
export type LatestRequest = {
  /**
   * Starts a request. `onResult` is called with its outcome only if no newer
   * request was started, and `cancel` was not called, before it finished.
   */
  run<T>(task: () => Promise<T>, onResult: (result: T) => void): void;
  /** Drops whatever is on its way, for example when the screen is left. */
  cancel(): void;
};

export function createLatestRequest(): LatestRequest {
  let generation = 0;
  return {
    run(task, onResult) {
      const mine = ++generation;
      void task().then((result) => {
        if (mine === generation) onResult(result);
      });
    },
    cancel() {
      generation++;
    },
  };
}
