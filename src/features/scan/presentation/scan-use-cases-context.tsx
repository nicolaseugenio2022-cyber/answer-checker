import { createContext, useContext } from 'react';

import type { ScanUseCases } from '@/features/scan/application/scan-use-cases';

const ScanUseCasesContext = createContext<ScanUseCases | null>(null);

/** Filled in by the composition root. Null where there is no database or camera (the web preview). */
export const ScanUseCasesProvider = ScanUseCasesContext.Provider;

export function useScanUseCases(): ScanUseCases | null {
  return useContext(ScanUseCasesContext);
}
