import ScanLine from 'lucide-react-native/icons/scan-line';

import { PlannedFeature } from '@/core/presentation/components/planned-feature';
import { destinationTitle } from '@/core/presentation/navigation/destinations';

const SUMMARY =
  'Point the camera at a shaded answer sheet and the app will read the marked bubbles on this device, without internet.';

const ABILITIES = [
  'Choose the subject, answer key, class, and student before scanning.',
  'Capture the sheet with the camera.',
  'Review answers read as blank, double-marked, or unclear, and correct them.',
  'Confirm the answers to score the sheet and save the result.',
] as const;

export function ScanScreen() {
  return (
    <PlannedFeature
      title={destinationTitle('scan')}
      icon={ScanLine}
      summary={SUMMARY}
      abilities={ABILITIES}
    />
  );
}
