import type { PropsWithChildren } from 'react';

/**
 * Web is only a build-verification target, not a product platform, so no
 * database is opened there. The native provider lives in database-provider.tsx.
 */
export function DatabaseProvider({ children }: PropsWithChildren) {
  return children;
}
