import { useSyncExternalStore } from 'react';

import { greetingForHour, neutralGreeting } from './greeting-text';

const subscribeToNothing = () => () => {};

/**
 * Greeting for the current time of day, with the optional display name from
 * Settings. The static web preview is rendered at build time, so it starts
 * with a time-neutral greeting and switches after hydration.
 */
export function useGreeting(name = ''): string {
  return useSyncExternalStore(
    subscribeToNothing,
    () => greetingForHour(new Date().getHours(), name),
    () => neutralGreeting(name)
  );
}
