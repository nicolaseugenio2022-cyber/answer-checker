import { createContext, useContext } from 'react';

import type { ResultsUseCases } from '@/features/results/application/results-use-cases';

const ResultsUseCasesContext = createContext<ResultsUseCases | null>(null);

/** Filled in by the composition root. Null where there is no database (the web preview). */
export const ResultsUseCasesProvider = ResultsUseCasesContext.Provider;

export function useResultsUseCases(): ResultsUseCases | null {
  return useContext(ResultsUseCasesContext);
}
