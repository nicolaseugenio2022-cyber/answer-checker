const path = require('path');

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Folders of this project that never hold code the app runs. Metro watches the
// whole project folder, so without this it also crawls and watches them:
// bundle exports and other generated output under .expo, the Node tests, the
// documentation, and the scripts. A file written there (an export, a
// generated answer sheet, a test run) then wakes the file watcher of a running
// dev server for nothing. .expo/types and .expo/web/cache are already excluded
// by Expo's own defaults.
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const outsideTheApp = [
  '.expo/android-emulator',
  '.expo/cache',
  '.expo/sheets',
  '.expo/static-tmp',
  '.expo/tmp',
  '.expo/ui-review',
  '.expo/verify-android',
  '.expo/verify-baseline',
  '.expo/verify-db',
  '.expo/verify-db-android',
  '.expo/verify-final',
  '.expo/verify-web',
  '.playwright-mcp',
  'dist',
  'docs',
  'scripts',
  'tests',
].map((folder) => {
  // Absolute, so a folder named "tests" or "docs" inside a dependency is not caught.
  const absolute = escape(path.resolve(__dirname, folder)).replace(/\\\\|\//g, '[\\\\/]');
  return new RegExp(`^${absolute}([\\\\/].*)?$`);
});

const defaults = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(defaults) ? defaults : [defaults]), ...outsideTheApp];

module.exports = withNativeWind(config, { input: './src/global.css', inlineRem: 16 });
