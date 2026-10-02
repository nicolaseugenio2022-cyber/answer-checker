import ClipboardCheck from 'lucide-react-native/icons/clipboard-check';

import { PlannedFeature } from '@/core/presentation/components/planned-feature';
import { destinationTitle } from '@/core/presentation/navigation/destinations';

const SUMMARY = 'Look up the scores of sheets you have already checked.';

const ABILITIES = [
  'Browse saved results by answer key or by student.',
  'Open a result to see each answer and whether it was correct.',
  'Delete a result permanently, together with its answers and scan image.',
] as const;

export function ResultsScreen() {
  return (
    <PlannedFeature
      title={destinationTitle('results')}
      icon={ClipboardCheck}
      summary={SUMMARY}
      abilities={ABILITIES}
    />
  );
}
