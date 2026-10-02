import { createContext, useContext } from 'react';

import type { AnswerKeyUseCases } from '@/features/answer-keys/application/answer-key-use-cases';

const AnswerKeyUseCasesContext = createContext<AnswerKeyUseCases | null>(null);

/** Filled in by the composition root. Null where there is no database (the web preview). */
export const AnswerKeyUseCasesProvider = AnswerKeyUseCasesContext.Provider;

export function useAnswerKeyUseCases(): AnswerKeyUseCases | null {
  return useContext(AnswerKeyUseCasesContext);
}
