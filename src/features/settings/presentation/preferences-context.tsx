import { colorScheme } from 'nativewind';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';

import type { SettingsUseCases } from '@/features/settings/application/settings-use-cases';
import {
  DEFAULT_PREFERENCES,
  type Appearance,
  type Preferences,
} from '@/features/settings/domain/settings';

type PreferencesValue = Preferences & {
  /** False until the stored preferences have been read (or could not be). */
  isLoaded: boolean;
  /** Applies the theme at once and stores the choice. */
  setAppearance: (appearance: Appearance) => void;
  /**
   * Stores the optional display name and returns it as stored.
   * @throws InvalidTeacherNameError, and errors with the code DATABASE_ERROR
   */
  setTeacherName: (name: string) => Promise<string>;
};

const PreferencesContext = createContext<PreferencesValue>({
  ...DEFAULT_PREFERENCES,
  isLoaded: true,
  setAppearance: () => undefined,
  setTeacherName: async (name) => name,
});

type PreferencesProviderProps = PropsWithChildren<{
  /** Null where there is no database (the web preview): choices then last until the page is closed. */
  settings: SettingsUseCases | null;
}>;

/**
 * The one source of the app's preferences. The appearance is stored in the
 * database and applied through NativeWind's color scheme; nothing else stores
 * or decides the theme. "system" follows the phone and changes with it.
 */
export function PreferencesProvider({ settings, children }: PreferencesProviderProps) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  // Nothing to read where there is no database.
  const [isLoaded, setIsLoaded] = useState(settings === null);

  // Read once, with an ordinary asynchronous query. The start waits for it
  // (see SplashGate) so the app opens in the stored theme; if it cannot be
  // read, the start goes on with the defaults rather than wait forever.
  useEffect(() => {
    if (!settings) return;
    let isCurrent = true;
    settings
      .getPreferences()
      .then(
        (stored) => {
          if (isCurrent) setPreferences(stored);
        },
        (error) => console.error(error)
      )
      .finally(() => {
        if (isCurrent) setIsLoaded(true);
      });
    return () => {
      isCurrent = false;
    };
  }, [settings]);

  const value: PreferencesValue = {
    ...preferences,
    isLoaded,
    setAppearance(appearance) {
      colorScheme.set(appearance);
      setPreferences((current) => ({ ...current, appearance }));
      // The theme is already applied; a failed write only means it is not remembered.
      settings?.setAppearance(appearance).catch((error) => console.error(error));
    },
    async setTeacherName(name) {
      const stored = settings ? await settings.setTeacherName(name) : name.trim();
      setPreferences((current) => ({ ...current, teacherName: stored }));
      return stored;
    },
  };

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  return useContext(PreferencesContext);
}
