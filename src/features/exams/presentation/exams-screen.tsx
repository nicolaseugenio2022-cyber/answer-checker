import FileText from 'lucide-react-native/icons/file-text';

import { PlannedFeature } from '@/core/presentation/components/planned-feature';
import { destinationTitle } from '@/core/presentation/navigation/destinations';

const SUMMARY = 'Set up each exam and the answer key its sheets are checked against.';

const ABILITIES = [
  'Create an exam for a subject and class.',
  'Set the number of questions and the correct answer for each one.',
  'Edit an answer key.',
  'Delete an exam permanently.',
] as const;

export function ExamsScreen() {
  return (
    <PlannedFeature
      title={destinationTitle('exams')}
      icon={FileText}
      summary={SUMMARY}
      abilities={ABILITIES}
    />
  );
}
