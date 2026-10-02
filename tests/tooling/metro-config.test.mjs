// Verifies that Metro is told to ignore the folders of this project that never
// hold app code, so that writing to them (a bundle export, a generated answer
// sheet, a test run) does not wake a running dev server, and that nothing the
// app needs is ignored by mistake.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '../..');
const config = require(resolve(root, 'metro.config.js'));
const isBlocked = (path) => config.resolver.blockList.some((pattern) => pattern.test(resolve(root, path)));

describe('Metro configuration', () => {
  it('ignores generated output, tests, docs, and scripts', () => {
    for (const path of [
      '.expo/verify-android/_expo/static/js/android/entry.hbc',
      '.expo/verify-web/index.html',
      '.expo/sheets/answer-sheet-10.pdf',
      '.expo/tmp/anything.mjs',
      '.expo/android-emulator/image.img',
      '.playwright-mcp/page.yml',
      'dist/index.html',
      'tests/scan/omr.test.mjs',
      'tests/scan/sheet-renderer.mjs',
      'docs/api.md',
      'scripts/generate-answer-sheet.mjs',
    ]) {
      assert.equal(isBlocked(path), true, path);
    }
  });

  it('still sees the app, its assets, and its dependencies', () => {
    for (const path of [
      'src/app/_layout.tsx',
      'src/features/scan/domain/template.ts',
      'src/features/scan/infrastructure/omr/read-sheet.ts',
      'src/global.css',
      'assets/images/icon.png',
      'assets/images/splash-icon.png',
      'app.json',
      'package.json',
      'node_modules/react/index.js',
      // A folder with one of the ignored names inside a dependency is not this project's.
      'node_modules/some-package/tests/helper.js',
      'node_modules/some-package/docs/readme.js',
      'node_modules/some-package/scripts/build.js',
      'node_modules/some-package/dist/index.js',
    ]) {
      assert.equal(isBlocked(path), false, path);
    }
  });

  it('keeps Expo\'s own exclusions', () => {
    // Expo's pattern names the folder itself.
    assert.equal(isBlocked('.expo/types'), true);
  });

  it('the app imports nothing from the ignored folders', () => {
    const { readdirSync, statSync } = require('node:fs');
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = resolve(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(resolve(root, 'src'));
    assert.ok(files.length > 100);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /from '[^']*\/(tests|scripts|docs)\/[^']*'/, file);
      assert.doesNotMatch(source, /require\([^)]*\.(pdf|test\.mjs)['"]\)/, file);
    }
  });
});

describe('start-up cannot restart itself', () => {
  const provider = readFileSync(resolve(root, 'src/core/infrastructure/database/database-provider.tsx'), 'utf8');
  const layout = readFileSync(resolve(root, 'src/app/_layout.tsx'), 'utf8');

  it('hands SQLiteProvider one initialization function for the whole life of the provider', () => {
    // SQLiteProvider reopens the database whenever onInit changes, so it must never change.
    assert.match(provider, /const initialize = useCallback\(async \(db: SQLiteDatabase\) => \{[\s\S]*?\}, \[\]\);/);
    assert.match(provider, /<SQLiteProvider databaseName=\{DATABASE_NAME\} onInit=\{initialize\}>/);
    assert.doesNotMatch(provider, /onInit=\{\s*async/);
  });

  it('reports database stages through a function defined outside every component', () => {
    assert.match(layout, /^function reportDatabaseStage\(stage: DatabaseStage, ms\?: number\) \{/m);
    assert.match(layout, /<DatabaseProvider onStage=\{reportDatabaseStage\}>/);
  });

  it('never changes the theme while the database is being prepared', () => {
    const stageHandler = layout.slice(layout.indexOf('function reportDatabaseStage'), layout.indexOf('const clock'));
    assert.doesNotMatch(stageHandler, /colorScheme|appColorScheme/);
    assert.doesNotMatch(provider, /colorScheme|nativewind/);
    // It is applied once, after the first screen is mounted.
    const gate = layout.slice(layout.indexOf('function SplashGate'), layout.indexOf('function reportDatabaseStage'));
    assert.match(gate, /if \(!isLoaded \|\| hasRun\.current\) return;/);
    assert.match(gate, /if \(appearance !== 'system'\) appColorScheme\.set\(appearance\);/);
    assert.equal(layout.match(/appColorScheme\.set\(/g).length, 1);
  });

  it('reads the database only through asynchronous calls', () => {
    const { readdirSync, statSync } = require('node:fs');
    const walk = (dir, found = []) => {
      for (const name of readdirSync(dir)) {
        const path = resolve(dir, name);
        if (statSync(path).isDirectory()) walk(path, found);
        else if (/\.(ts|tsx)$/.test(name)) found.push(path);
      }
      return found;
    };
    // A synchronous query blocks the JavaScript thread and can wait on the connection's own queue.
    for (const file of walk(resolve(root, 'src'))) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /\b(getFirstSync|getAllSync|runSync|execSync|openDatabaseSync)\b/, file);
    }
  });

  it('runs initialization in try and catch, and reports a failure before rethrowing it', () => {
    assert.match(provider, /try \{\s*await initializeDatabase\(db\);\s*\} catch \(error\) \{\s*report\('failed'[\s\S]*?throw error;/);
  });

  it('shows a recoverable screen when the start fails and when it stalls', () => {
    assert.match(layout, /<StartupErrorBoundary\s+key=\{attempt\}/);
    assert.match(layout, /\{startup === 'stalled' && \(\s*<StartupStalled/);
    assert.match(layout, /STALL_AFTER_MS = 12_000/);
    assert.match(layout, /SPLASH_LAST_RESORT_MS = 20_000/);
  });
});

describe('splash screen', () => {
  const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')).expo;
  const layout = readFileSync(resolve(root, 'src/app/_layout.tsx'), 'utf8');

  it('is branded for light and for dark', () => {
    const plugin = app.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'expo-splash-screen');
    assert.ok(plugin);
    const options = plugin[1];
    assert.equal(options.image, './assets/images/splash-icon.png');
    assert.match(options.backgroundColor, /^#[0-9A-F]{6}$/i);
    assert.match(options.dark.backgroundColor, /^#[0-9A-F]{6}$/i);
    assert.notEqual(options.backgroundColor, options.dark.backgroundColor);
    assert.equal(app.userInterfaceStyle, 'automatic');
  });

  it('stays up until the database, the theme, and the providers are ready', () => {
    // Held from the first moment, at module scope.
    assert.match(layout, /^void SplashScreen\.preventAutoHideAsync\(\)/m);
    // Hidden from inside every provider, when the start fails, and when it stalls.
    assert.match(layout, /<SplashGate onReady=\{markReady\}>\s*<AppTabs \/>\s*<\/SplashGate>/);
    assert.match(layout, /hideSplash\('start finished'\)/);
    assert.match(layout, /hideSplash\('start-up failed'\)/);
    assert.match(layout, /hideSplash\('start-up stalled'\)/);
    // And by a plain timer that does not depend on React at all.
    assert.match(layout, /lastResort = setTimeout\(\(\) => hideSplash\('last-resort timer'\), SPLASH_LAST_RESORT_MS\);/);
    // The gate sits below the database provider and the preferences provider.
    const order = ['<DatabaseProvider', '<UseCaseProviders>', '<SplashGate '].map((tag) => layout.lastIndexOf(tag));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });
});
