import { createContext, useContext } from 'react';

import type { DemoDataUseCases } from '@/features/demo-data/application/demo-data-use-cases';

const DemoDataUseCasesContext = createContext<DemoDataUseCases | null>(null);

/** Filled in by the composition root. Null where there is no database (the web preview). */
export const DemoDataUseCasesProvider = DemoDataUseCasesContext.Provider;

export function useDemoDataUseCases(): DemoDataUseCases | null {
  return useContext(DemoDataUseCasesContext);
}
