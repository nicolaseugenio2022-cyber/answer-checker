/**
 * Decides when a loading skeleton is on screen.
 *
 * Reading the local database usually takes a few milliseconds. Drawing a
 * skeleton for that long is a flash, which is worse than drawing nothing. So:
 *
 * - While loading, nothing is shown for `delay` milliseconds ("hidden").
 * - If loading is still going on after that, the skeleton appears.
 * - Once it has appeared it stays for at least `minVisible` milliseconds, so
 *   it never blinks on and off.
 * - Then the content is shown.
 *
 * In development the artificial loading time (see artificial-loading.ts)
 * holds every gate in its loading phases for that long, so each skeleton can
 * be looked at without slowing anything real down.
 *
 * Pure: timers and the clock are passed in, so the timing can be tested.
 */
export type LoadingPhase = 'hidden' | 'skeleton' | 'content';

export type LoadingGateOptions = {
  /** Milliseconds of loading before the skeleton appears. */
  delay?: number;
  /** Milliseconds the skeleton stays once it has appeared. */
  minVisible?: number;
  /** Extra milliseconds to stay in the loading phases, read each time loading starts. */
  artificialMs?: () => number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export const SKELETON_DELAY_MS = 150;
export const SKELETON_MIN_VISIBLE_MS = 350;

export type LoadingGate = {
  getPhase(): LoadingPhase;
  /** Tells the gate whether loading is going on. */
  setLoading(isLoading: boolean): void;
  subscribe(listener: () => void): () => void;
  /** Stops every timer, for when the screen goes away. */
  dispose(): void;
};

export function createLoadingGate(isLoadingAtStart: boolean, options: LoadingGateOptions = {}): LoadingGate {
  const {
    delay = SKELETON_DELAY_MS,
    minVisible = SKELETON_MIN_VISIBLE_MS,
    artificialMs = () => 0,
    now = () => Date.now(),
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  let phase: LoadingPhase = isLoadingAtStart ? 'hidden' : 'content';
  let isLoading = false;
  let shownAt = 0;
  let holdUntil = 0;
  let showTimer: unknown = null;
  let settleTimer: unknown = null;
  const listeners = new Set<() => void>();

  const setPhase = (next: LoadingPhase) => {
    if (phase === next) return;
    phase = next;
    for (const listener of listeners) listener();
  };
  const stop = (handle: unknown) => {
    if (handle !== null) clearTimer(handle);
  };

  /** Moves to the content once loading is over and nothing asks to wait longer. */
  function settle() {
    stop(settleTimer);
    settleTimer = null;
    if (isLoading) return;
    const visibleFor = phase === 'skeleton' ? shownAt + minVisible - now() : 0;
    const wait = Math.max(holdUntil - now(), visibleFor);
    if (wait > 0) {
      settleTimer = setTimer(settle, wait);
      return;
    }
    stop(showTimer);
    showTimer = null;
    setPhase('content');
  }

  return {
    getPhase: () => phase,

    setLoading(next) {
      if (next === isLoading) return;
      isLoading = next;
      if (!next) {
        settle();
        return;
      }
      stop(settleTimer);
      settleTimer = null;
      holdUntil = now() + Math.max(0, artificialMs());
      if (phase === 'content') setPhase('hidden');
      if (phase === 'hidden' && showTimer === null) {
        showTimer = setTimer(() => {
          showTimer = null;
          shownAt = now();
          setPhase('skeleton');
        }, delay);
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      stop(showTimer);
      stop(settleTimer);
      showTimer = null;
      settleTimer = null;
      listeners.clear();
    },
  };
}
