import { createContext, useContext } from 'react';

import type { SettingsUseCases } from '@/features/settings/application/settings-use-cases';

const SettingsUseCasesContext = createContext<SettingsUseCases | null>(null);

/** Filled in by the composition root. Null where there is no database (the web preview). */
export const SettingsUseCasesProvider = SettingsUseCasesContext.Provider;

export function useSettingsUseCases(): SettingsUseCases | null {
  return useContext(SettingsUseCasesContext);
}
