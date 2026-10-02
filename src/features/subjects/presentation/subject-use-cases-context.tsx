import { createContext, useContext } from 'react';

import type { SubjectUseCases } from '@/features/subjects/application/subject-use-cases';

const SubjectUseCasesContext = createContext<SubjectUseCases | null>(null);

/** Filled in by the composition root. Null where there is no database (the web preview). */
export const SubjectUseCasesProvider = SubjectUseCasesContext.Provider;

export function useSubjectUseCases(): SubjectUseCases | null {
  return useContext(SubjectUseCasesContext);
}
