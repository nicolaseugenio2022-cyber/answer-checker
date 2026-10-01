import GraduationCap from 'lucide-react-native/icons/graduation-cap';

import { PlannedFeature } from '@/core/presentation/components/planned-feature';
import { destinationTitle } from '@/core/presentation/navigation/destinations';

const SUMMARY = 'Keep the list of students whose answer sheets you check.';

const ABILITIES = [
  'Add students and assign them to a class.',
  'Edit a student’s details.',
  'Delete a student permanently.',
] as const;

export function StudentsScreen() {
  return (
    <PlannedFeature
      title={destinationTitle('students')}
      icon={GraduationCap}
      summary={SUMMARY}
      abilities={ABILITIES}
    />
  );
}
