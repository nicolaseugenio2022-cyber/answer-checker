import BookOpen from 'lucide-react-native/icons/book-open';

import { PlannedFeature } from '@/core/presentation/components/planned-feature';
import { destinationTitle } from '@/core/presentation/navigation/destinations';

const SUMMARY = 'Keep the subjects you give exams in.';

const ABILITIES = [
  'Add and rename subjects.',
  'Delete a subject permanently.',
] as const;

export function SubjectsScreen() {
  return (
    <PlannedFeature
      title={destinationTitle('subjects')}
      showBack
      icon={BookOpen}
      summary={SUMMARY}
      abilities={ABILITIES}
    />
  );
}
