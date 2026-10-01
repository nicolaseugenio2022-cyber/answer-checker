import { useSyncExternalStore } from 'react';

export function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning, Teacher';
  if (hour < 18) return 'Good afternoon, Teacher';
  return 'Good evening, Teacher';
}

const subscribeToNothing = () => () => {};

/**
 * Greeting for the current time of day. The static web preview is rendered at
 * build time, so it starts with a time-neutral greeting and switches after hydration.
 */
export function useGreeting(): string {
  return useSyncExternalStore(
    subscribeToNothing,
    () => greetingForHour(new Date().getHours()),
    () => 'Welcome, Teacher'
  );
}
