/** Who the greeting addresses when no display name is set. */
const FALLBACK_NAME = 'Teacher';

/**
 * "Good morning, Alex": the greeting for an hour of the day (0 to 23) and the
 * optional display name from Settings. Without a name it says "Teacher".
 */
export function greetingForHour(hour: number, name = ''): string {
  const who = name.trim().length > 0 ? name.trim() : FALLBACK_NAME;
  if (hour < 12) return `Good morning, ${who}`;
  if (hour < 18) return `Good afternoon, ${who}`;
  return `Good evening, ${who}`;
}

/** What the static web preview shows before it knows the time. */
export function neutralGreeting(name = ''): string {
  return `Welcome, ${name.trim().length > 0 ? name.trim() : FALLBACK_NAME}`;
}
