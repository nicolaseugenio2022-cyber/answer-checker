import { useEffect, useState, useSyncExternalStore } from 'react';

import { getArtificialLoadingMs } from '@/core/presentation/lib/artificial-loading';
import { createLoadingGate, type LoadingPhase } from '@/core/presentation/lib/loading-gate';

/**
 * What to draw while something loads: nothing yet ("hidden"), the skeleton,
 * or the content. The skeleton appears only when loading takes longer than a
 * moment and then stays long enough not to flicker (see loading-gate.ts).
 *
 * Pass true only for a load that has nothing to show yet. A refresh of a
 * screen that already shows content must keep showing it; use the phase of a
 * separate `useLoadingPhase(isRefreshing)` for a small refresh indicator.
 */
export function useLoadingPhase(isLoading: boolean): LoadingPhase {
  const [gate] = useState(() =>
    createLoadingGate(isLoading, { artificialMs: getArtificialLoadingMs })
  );

  useEffect(() => {
    gate.setLoading(isLoading);
  }, [gate, isLoading]);

  useEffect(() => () => gate.dispose(), [gate]);

  return useSyncExternalStore(gate.subscribe, gate.getPhase, gate.getPhase);
}
