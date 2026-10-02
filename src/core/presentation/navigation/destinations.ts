import type { LucideIcon } from 'lucide-react-native';
import BookOpen from 'lucide-react-native/icons/book-open';
import ClipboardCheck from 'lucide-react-native/icons/clipboard-check';
import FileText from 'lucide-react-native/icons/file-text';
import GraduationCap from 'lucide-react-native/icons/graduation-cap';
import House from 'lucide-react-native/icons/house';
import ScanLine from 'lucide-react-native/icons/scan-line';
import Settings from 'lucide-react-native/icons/settings';
import Users from 'lucide-react-native/icons/users';

export type Destination = {
  /** Expo Router route name: the file name under src/app without its extension. */
  route: string;
  /** Screen header title and accessible name. */
  title: string;
  /** Short label that fits under a bottom-tab icon. */
  tabLabel: string;
  icon: LucideIcon;
};

export const SCAN_ROUTE = 'scan';

/** The tab that stays selected while one of its secondary screens is open. */
export const HOME_ROUTE = 'index';

/** Bottom tab bar, left to right. Scan sits in the middle as the main action. */
export const TAB_DESTINATIONS: readonly Destination[] = [
  { route: HOME_ROUTE, title: 'Home', tabLabel: 'Home', icon: House },
  { route: 'exams', title: 'Exams & answer keys', tabLabel: 'Exams', icon: FileText },
  { route: SCAN_ROUTE, title: 'Scan answer sheet', tabLabel: 'Scan', icon: ScanLine },
  { route: 'students', title: 'Students', tabLabel: 'Students', icon: GraduationCap },
  { route: 'results', title: 'Results', tabLabel: 'Results', icon: ClipboardCheck },
];

/**
 * Opened from Home (More), never from the tab bar: they have no slot, icon, or
 * label there. Their screens show a back button, and Home stays the selected tab.
 */
export const SECONDARY_DESTINATIONS: readonly Destination[] = [
  { route: 'classes', title: 'Classes', tabLabel: 'Classes', icon: Users },
  { route: 'subjects', title: 'Subjects', tabLabel: 'Subjects', icon: BookOpen },
  { route: 'settings', title: 'Settings', tabLabel: 'Settings', icon: Settings },
];

/** Header title for a route, so a screen and its tab cannot drift apart. */
export function destinationTitle(route: string): string {
  const destination = [...TAB_DESTINATIONS, ...SECONDARY_DESTINATIONS].find(
    (candidate) => candidate.route === route
  );
  if (!destination) throw new Error(`Unknown destination route: ${route}`);
  return destination.title;
}
