import { createContext, useContext } from 'react';

import type { DashboardUseCases } from '@/features/dashboard/application/dashboard-use-cases';

const DashboardUseCasesContext = createContext<DashboardUseCases | null>(null);

/** Filled in by the composition root. Null where there is no database (the web preview). */
export const DashboardUseCasesProvider = DashboardUseCasesContext.Provider;

export function useDashboardUseCases(): DashboardUseCases | null {
  return useContext(DashboardUseCasesContext);
}
