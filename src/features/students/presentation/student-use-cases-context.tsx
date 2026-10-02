import { createContext, useContext } from 'react';

import type { StudentUseCases } from '@/features/students/application/student-use-cases';

const StudentUseCasesContext = createContext<StudentUseCases | null>(null);

/** Filled in by the composition root. Null where there is no database (the web preview). */
export const StudentUseCasesProvider = StudentUseCasesContext.Provider;

export function useStudentUseCases(): StudentUseCases | null {
  return useContext(StudentUseCasesContext);
}
