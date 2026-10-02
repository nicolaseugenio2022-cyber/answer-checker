import Users from 'lucide-react-native/icons/users';
import { useMemo } from 'react';

import {
  NameListScreen,
  type NameListCopy,
  type NameListOperations,
} from '@/core/presentation/components/name-list-screen';
import {
  countOf,
  describeNameError,
  type ErrorDescription,
} from '@/core/presentation/lib/describe-name-error';
import { destinationTitle } from '@/core/presentation/navigation/destinations';
import { ClassInUseError } from '@/features/classes/application/class-repository';
import { CLASS_NAME_MAX_LENGTH } from '@/features/classes/domain/school-class';
import { useClassUseCases } from '@/features/classes/presentation/class-use-cases-context';

const COPY: NameListCopy = {
  noun: 'class',
  pluralNoun: 'classes',
  intro:
    'A class is one group of students. Put the grade or year, the course or strand, and the section in its name.',
  emptyHint: 'Add the first class you teach, such as Grade 11 STEM-A or BSIT 1A.',
  namePlaceholder: 'BSIT 1A',
};

/** "This class contains 24 students and is used by 2 exams." */
function describeClassUse({ studentCount, examCount }: ClassInUseError): string {
  const parts: string[] = [];
  if (studentCount > 0) parts.push(`contains ${countOf(studentCount, 'student')}`);
  if (examCount > 0) parts.push(`is used by ${countOf(examCount, 'exam')}`);
  return `This class ${parts.join(' and ')}.`;
}

function describeClassError(error: unknown): ErrorDescription {
  if (error instanceof ClassInUseError) {
    return {
      kind: 'blocked',
      message: `${describeClassUse(error)} A class can be deleted only when it has no students and no exams.`,
    };
  }
  return describeNameError(error, COPY.noun);
}

export function ClassesScreen() {
  const useCases = useClassUseCases();
  const operations = useMemo<NameListOperations | null>(
    () =>
      useCases && {
        list: useCases.listClasses,
        add: useCases.addClass,
        rename: useCases.renameClass,
        remove: useCases.deleteClass,
      },
    [useCases]
  );

  return (
    <NameListScreen
      title={destinationTitle('classes')}
      icon={Users}
      copy={COPY}
      maxNameLength={CLASS_NAME_MAX_LENGTH}
      operations={operations}
      describeError={describeClassError}
    />
  );
}
