import Users from 'lucide-react-native/icons/users';

import { PlannedFeature } from '@/core/presentation/components/planned-feature';
import { destinationTitle } from '@/core/presentation/navigation/destinations';

const SUMMARY = 'Keep the classes you teach, so exams and students can be grouped by class.';

const ABILITIES = [
  'Add and rename classes.',
  'See which students belong to a class.',
  'Delete a class permanently.',
] as const;

export function ClassesScreen() {
  return (
    <PlannedFeature
      title={destinationTitle('classes')}
      showBack
      icon={Users}
      summary={SUMMARY}
      abilities={ABILITIES}
    />
  );
}
