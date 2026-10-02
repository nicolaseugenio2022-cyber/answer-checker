import { createContext, useContext } from 'react';

import type { ClassUseCases } from '@/features/classes/application/class-use-cases';

const ClassUseCasesContext = createContext<ClassUseCases | null>(null);

/** Filled in by the composition root. Null where there is no database (the web preview). */
export const ClassUseCasesProvider = ClassUseCasesContext.Provider;

export function useClassUseCases(): ClassUseCases | null {
  return useContext(ClassUseCasesContext);
}
