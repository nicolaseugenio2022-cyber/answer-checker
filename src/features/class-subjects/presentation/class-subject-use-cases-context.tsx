import { createContext, useContext } from 'react';

import type { ClassSubjectUseCases } from '@/features/class-subjects/application/class-subject-use-cases';

const ClassSubjectUseCasesContext = createContext<ClassSubjectUseCases | null>(null);

/** Filled in by the composition root. Null where there is no database (the web preview). */
export const ClassSubjectUseCasesProvider = ClassSubjectUseCasesContext.Provider;

export function useClassSubjectUseCases(): ClassSubjectUseCases | null {
  return useContext(ClassSubjectUseCasesContext);
}
