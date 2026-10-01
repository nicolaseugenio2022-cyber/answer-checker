// Lets Node load the app's TypeScript sources directly: the sources import each
// other without file extensions (as Metro and tsc expect), which Node's ESM
// resolver does not accept. This retries a failed relative import with ".ts".
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
